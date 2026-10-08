import sql from 'mssql';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { BlobStore } from './storage.js';
import { sqlPool } from './sql-connection.js';
import { hash, noteSchema, privatePublication, type Note } from '../../../shared/corpus.js';
import { chatSnapshotRevision, type ChatCorpus } from '../../../shared/chat.js';
import { buildSearchIndex } from '../../../shared/search.js';
import { matchedSourceText } from '../../../shared/source-text.js';
import { sourceLifecycle, requireSourceState } from './source-lifecycle.js';
import { purgeSourceContent } from './source-purge.js';
import { DocumentTexts } from './document-text.js';

type Frame = { key: string; owner: string; controller: AbortController; revisions: Map<string, string | undefined>; source?: { id: string; revision: number }; parent?: Frame };
const snapshots = new Map<string, { signature: string; promise: Promise<{ revision: string; sources: ChatCorpus['sources'] }> }>();
export class SqlStore extends BlobStore {
  private readonly access = new AsyncLocalStorage<{ id: string; revision: number }[]>();
  private readonly frames = new AsyncLocalStorage<Frame>();
  override get leaseSignal(): AbortSignal | undefined {
    const signals: AbortSignal[] = [];
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) signals.push(frame.controller.signal);
    return signals.length ? AbortSignal.any(signals) : undefined;
  }
  private async request(key?: string) {
    if (key && key.length > 450) throw new Error('Record key is too long');
    const request = (await sqlPool()).request();
    if (key) request.input('key', sql.NVarChar(450), key);
    return request;
  }
  private sourceGuard(request: sql.Request, id: string, revision?: number, suffix = 'content', retained = false) {
    request.input(`source_${suffix}`, sql.NVarChar(450), `source-lifecycle/${id}.json`);
    if (revision !== undefined) request.input(`source_revision_${suffix}`, sql.Int, revision);
    return `IF EXISTS (SELECT 1 FROM dbo.Records WITH (UPDLOCK,HOLDLOCK) WHERE record_key=@source_${suffix} AND
      (JSON_VALUE(document,'$.state') NOT IN (${retained ? "N'active',N'trashed'" : "N'active'"}) ${revision !== undefined ? `OR TRY_CONVERT(int,JSON_VALUE(document,'$.revision'))<>@source_revision_${suffix}` : ''}))
      THROW 51004, 'Source lifecycle changed', 1;\n`;
  }
  private contentGuards(request: sql.Request, key: string, value: unknown) {
    if (key.startsWith('source-lifecycle/') || key.startsWith('source-purges/')) return '';
    const content = value as { sourceId?: string; source?: { id?: string } };
    if (key.startsWith('sources/') && this.frames.getStore()?.key === `lifecycle-${content?.source?.id}`) return '';
    const ids = new Set<string>();
    if (key.startsWith('chat/corpora/') && !this.frames.getStore()?.key.startsWith('corpus-')) for (const source of (value as ChatCorpus).sources || []) ids.add(source.note.source.id);
    if (content?.sourceId) ids.add(content.sourceId);
    if (content?.source?.id) ids.add(content.source.id);
    if (key.startsWith('chat/indexes/')) for (const id of (value as { sourceIds?: string[] }).sourceIds || []) ids.add(id);
    const batches = key.startsWith('categories/batches/') && !this.cleaningSourceContent() ? (value as { entries?: { sourceId: string }[] }).entries || [] : [];
    const batchGuards = batches.map((entry, i) => this.sourceGuard(request, entry.sourceId, undefined, `batch${i}`, true)).join('');
    return batchGuards + [...ids].map((id, i) => this.sourceGuard(request, id, undefined, `content${i}`)).join('');
  }
  private guards(request: sql.Request) {
    let checks = '';
    let index = 0;
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) {
      frame.controller.signal.throwIfAborted();
      request.input(`lock${index}`, sql.NVarChar(200), frame.key).input(`owner${index}`, sql.UniqueIdentifier, frame.owner);
      checks += `IF NOT EXISTS (SELECT 1 FROM dbo.Leases WITH (UPDLOCK,HOLDLOCK) WHERE lease_key=@lock${index} AND owner=@owner${index} AND expires_at>SYSUTCDATETIME()) THROW 51001, 'SQL lease was lost', 1;\n`;
      if (frame.source && !this.purging(frame.source.id)) checks += this.sourceGuard(request, frame.source.id, frame.source.revision, String(index));
      index++;
    }
    for (const [i, source] of (this.access.getStore() || []).entries()) checks += this.sourceGuard(request, source.id, source.revision, `access${i}`);
    return checks;
  }
  async withSourceAccess<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
    const sources = await Promise.all([...new Set(ids)].map(async id => ({ id, revision: (await requireSourceState(this, id)).revision })));
    return this.access.run(sources, async () => { const result = await fn(); await this.verifyLease(); return result; });
  }
  private cleaningSourceContent() {
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) if (frame.key.startsWith('purge-')) return true;
    return false;
  }
  private purging(id: string) {
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) if (frame.key === `purge-${id}`) return true;
    return false;
  }
  private ownership(request: sql.Request, key: string, value: unknown) {
    if (key.startsWith('source-records/') || key.startsWith('source-lifecycle/') || key.startsWith('source-purges/') || key.startsWith('chat/conversations/') || key.startsWith('chat/jobs/')) return '';
    const content = value as { sourceId?: string; source?: { id?: string } };
    let id = content?.sourceId || content?.source?.id;
    for (let frame = this.frames.getStore(); !id && frame; frame = frame.parent) id = frame.source?.id;
    if (!id || this.purging(id)) return '';
    request.input('ownershipKey', sql.NVarChar(450), `source-records/${id}/${hash(key)}.json`)
      .input('ownership', sql.NVarChar(sql.MAX), JSON.stringify({ key }));
    return 'IF NOT EXISTS(SELECT 1 FROM dbo.Records WITH(UPDLOCK,HOLDLOCK) WHERE record_key=@ownershipKey) INSERT dbo.Records(record_key,document) VALUES(@ownershipKey,@ownership);';
  }
  override async verifyLease() {
    const request = await this.request();
    const guards = this.guards(request);
    if (guards) await request.query(guards);
  }
  override async read<T>(key: string): Promise<T | undefined> {
    if (key === 'chat/current.json') {
      const snapshot = await this.snapshot();
      return { revision: snapshot.revision } as T;
    }
    const result = await (await this.request(key)).query('SELECT document, CONVERT(varchar(30),revision) AS revision FROM dbo.Records WHERE record_key=@key');
    const row = result.recordset[0];
    this.frames.getStore()?.revisions.set(key, row?.revision);
    return row ? JSON.parse(row.document) as T : undefined;
  }
  override async write(key: string, value: unknown) {
    const frame = this.frames.getStore();
    if (!frame) throw new Error('Mutable SQL writes require a lease');
    if (!frame.revisions.has(key)) await this.read(key);
    const request = await this.request(key);
    request.input('document', sql.NVarChar(sql.MAX), JSON.stringify(value));
    request.input('expected', sql.BigInt, frame.revisions.get(key) ?? null);
    const result = await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      ${this.guards(request)} ${this.contentGuards(request, key, value)}
      IF @expected IS NULL
      BEGIN
        IF EXISTS (SELECT 1 FROM dbo.Records WITH (UPDLOCK,HOLDLOCK) WHERE record_key=@key) THROW 51002, 'Stale SQL revision', 1;
        INSERT dbo.Records(record_key,document) VALUES(@key,@document);
      END
      ELSE
      BEGIN
        UPDATE dbo.Records SET document=@document,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE record_key=@key AND revision=@expected;
        IF @@ROWCOUNT=0 THROW 51002, 'Stale SQL revision', 1;
      END;
      ${this.ownership(request, key, value)}
      SELECT CONVERT(varchar(30),revision) AS revision FROM dbo.Records WHERE record_key=@key;
      COMMIT;`);
    frame.revisions.set(key, result.recordset[0].revision);
  }
  override async create(key: string, value: unknown) {
    const request = await this.request(key);
    request.input('document', sql.NVarChar(sql.MAX), JSON.stringify(value));
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      ${this.guards(request)} ${this.contentGuards(request, key, value)}
      IF NOT EXISTS (SELECT 1 FROM dbo.Records WITH (UPDLOCK,HOLDLOCK) WHERE record_key=@key)
        INSERT dbo.Records(record_key,document) VALUES(@key,@document);
      ${this.ownership(request, key, value)}
      COMMIT;`);
  }
  override async list(prefix: string) {
    const escaped = prefix.replace(/[\\%_\[]/g, value => '\\' + value) + '%';
    const result = await (await this.request()).input('prefix', sql.NVarChar(451), escaped)
      .query("SELECT record_key FROM dbo.Records WHERE record_key LIKE @prefix ESCAPE '\\' ORDER BY record_key");
    return result.recordset.map(row => row.record_key as string);
  }
  override async remove(key: string) {
    const request = await this.request(key);
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; ${this.guards(request)} DELETE dbo.Records WHERE record_key=@key; COMMIT;`);
    // Binary assets deliberately remain blobs.
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }
  override async withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (key.length > 200) throw new Error('Lease key is too long');
    const owner = randomUUID();
    const request = await this.request();
    request.input('lock', sql.NVarChar(200), key).input('owner', sql.UniqueIdentifier, owner);
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      IF EXISTS(SELECT 1 FROM dbo.Leases WITH(UPDLOCK,HOLDLOCK) WHERE lease_key=@lock AND expires_at>SYSUTCDATETIME())
        THROW 51003,'SQL lease is busy',1;
      UPDATE dbo.Leases SET owner=@owner,expires_at=DATEADD(second,60,SYSUTCDATETIME()) WHERE lease_key=@lock;
      IF @@ROWCOUNT=0 INSERT dbo.Leases VALUES(@lock,@owner,DATEADD(second,60,SYSUTCDATETIME()));
      COMMIT;`);
    const controller = new AbortController();
    const source = key.startsWith('source-') ? { id: key.slice(7), revision: (await sourceLifecycle(this, key.slice(7))).revision } : undefined;
    const frame: Frame = { key, owner, controller, revisions: new Map(), parent: this.frames.getStore(), source };
    let renewing = false;
    const renew = setInterval(() => {
      if (renewing || controller.signal.aborted) return;
      renewing = true;
      void this.request().then(r => r.input('lock', sql.NVarChar(200), key).input('owner', sql.UniqueIdentifier, owner)
        .query(`UPDATE dbo.Leases SET expires_at=DATEADD(second,60,SYSUTCDATETIME()) WHERE lease_key=@lock AND owner=@owner AND expires_at>SYSUTCDATETIME();
          IF @@ROWCOUNT=0 THROW 51001,'SQL lease was lost',1;`))
        .catch(() => controller.abort(new Error('SQL lease was lost'))).finally(() => { renewing = false; });
    }, 20000);
    try {
      return await this.frames.run(frame, async () => { const result = await fn(); await this.verifyLease(); return result; });
    } finally {
      clearInterval(renew);
      controller.abort();
      await (await this.request()).input('lock', sql.NVarChar(200), key).input('owner', sql.UniqueIdentifier, owner)
        .query('DELETE dbo.Leases WHERE lease_key=@lock AND owner=@owner').catch(() => {});
    }
  }
  async publishNote(input: Note, humanMarkdown?: string, publication = privatePublication) {
    const note = noteSchema.parse(input);
    const request = await this.request();
    request.input('id', sql.NVarChar(100), note.source.id)
      .input('generation', sql.Char(64), note.generationId).input('title', sql.NVarChar(2000), note.source.title)
      .input('type', sql.NVarChar(100), note.source.itemType).input('category', sql.NVarChar(48), note.schemaVersion === 2 ? note.category.id : null)
      .input('published', sql.NVarChar(200), note.source.publishedAt).input('captured', sql.DateTime2, new Date(note.source.capturedAt))
      .input('active', sql.Bit, note.source.active).input('note', sql.NVarChar(sql.MAX), JSON.stringify(note))
      .input('human', sql.NVarChar(sql.MAX), humanMarkdown ?? null).input('publication', sql.NVarChar(sql.MAX), JSON.stringify(publication));
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; ${this.guards(request)} ${this.sourceGuard(request, note.source.id)}
      UPDATE dbo.Sources WITH(UPDLOCK,HOLDLOCK) SET generation_id=@generation,title=@title,item_type=@type,category_id=@category,
        published_at=@published,captured_at=@captured,active=@active,note_json=@note,
        human_markdown=COALESCE(@human,human_markdown),revision=revision+1,updated_at=SYSUTCDATETIME() WHERE source_id=@id;
      IF @@ROWCOUNT=0 INSERT dbo.Sources(source_id,generation_id,title,item_type,category_id,published_at,captured_at,active,note_json,human_markdown,publication_json)
        VALUES(@id,@generation,@title,@type,@category,@published,@captured,@active,@note,COALESCE(@human,N''),@publication);
      COMMIT;`);
  }
  async sources(): Promise<ChatCorpus['sources']> {
    const result = await (await this.request()).query(`SELECT note_json,human_markdown FROM dbo.Sources WHERE active=1 AND NOT EXISTS(SELECT 1 FROM dbo.Records r WHERE r.record_key=N'source-lifecycle/'+source_id+N'.json' AND JSON_VALUE(r.document,'$.state')<>N'active') ORDER BY captured_at DESC,source_id`);
    return result.recordset.map(row => ({ note: noteSchema.parse(JSON.parse(row.note_json)), humanMarkdown: row.human_markdown }));
  }
  async source(id: string): Promise<ChatCorpus['sources'][number] | undefined> {
    const result = await (await this.request()).input('id', sql.NVarChar(100), id)
      .query(`SELECT note_json,human_markdown FROM dbo.Sources WHERE source_id=@id AND active=1 AND NOT EXISTS(SELECT 1 FROM dbo.Records r WHERE r.record_key=N'source-lifecycle/'+source_id+N'.json' AND JSON_VALUE(r.document,'$.state')<>N'active')`);
    const row = result.recordset[0];
    return row ? { note: noteSchema.parse(JSON.parse(row.note_json)), humanMarkdown: row.human_markdown } : undefined;
  }
  async retainedSource(id: string): Promise<ChatCorpus['sources'][number] | undefined> {
    const result = await (await this.request()).input('id', sql.NVarChar(100), id)
      .query('SELECT note_json,human_markdown FROM dbo.Sources WHERE source_id=@id');
    const row = result.recordset[0];
    return row ? { note: noteSchema.parse(JSON.parse(row.note_json)), humanMarkdown: row.human_markdown } : undefined;
  }
  async removeSource(id: string) {
    const request = (await this.request()).input('id', sql.NVarChar(100), id);
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; ${this.guards(request)} DELETE dbo.Sources WHERE source_id=@id; COMMIT;`);
  }
  override async createBinary(key: string, data: Uint8Array, mime: string) {
    const request = await this.request();
    const ownership = this.ownership(request, key, {});
    if (ownership) await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; ${this.guards(request)} ${ownership} COMMIT;`);
    await super.createBinary(key, data, mime);
  }
  async removeLegacy(key: string) { await this.verifyLease(); await this.container.getBlockBlobClient(key).deleteIfExists(); }
  async legacyKeys() {
    const keys: string[] = [];
    for await (const blob of this.container.listBlobsFlat()) if (!blob.name.startsWith('locks/')) keys.push(blob.name);
    return keys;
  }
  async legacyRead<T>(key: string): Promise<T | undefined> { return super.read<T>(key); }
  async purgeSourceContent(id: string) { await purgeSourceContent(this, id); }
  override async retain(artifact: string, data: Uint8Array, mime: string) {
    let id: string | undefined;
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) if (frame.source) { id = frame.source.id; break; }
    if (!id) throw new Error('Retaining an original requires a source lease');
    const source = id;
    await this.withLease(`artifact-${artifact}`, async () => {
      await requireSourceState(this, source);
      // Register before uploading. Cleanup holds this same hash lease before removing a blob.
      await this.create(`artifact-references/${artifact}/${source}.json`, { sourceId: source, hash: artifact });
      await super.retain(artifact, data, mime);
    });
  }
  async artifactReferenced(artifact: string) {
    const result = await (await this.request()).input('artifact', sql.VarChar(64), artifact).query(`
      SELECT TOP(1) source_id FROM dbo.Sources WHERE CHARINDEX(@artifact,note_json)>0;
      SELECT TOP(1) record_key FROM dbo.Records WHERE
        (record_key LIKE N'artifacts/%' OR record_key LIKE N'artifact-inputs/%' OR record_key LIKE N'artifact-selections/%'
          OR record_key LIKE N'artifact-sets/%' OR record_key LIKE N'analysis/%' OR record_key LIKE N'staged/%' OR record_key LIKE N'browser-captures/%')
        AND CHARINDEX(@artifact,document)>0;`);
    return (result.recordsets as sql.IRecordSet<unknown>[]).some(rows => rows.length > 0);
  }
  async removeArtifact(artifact: string) { await this.verifyLease(); await this.raw.getBlockBlobClient(artifact).deleteIfExists(); }
  async sourceInputs() {
    const result = await (await this.request()).query(`SELECT s.source_id,s.generation_id,s.note_json,t.document AS source_text,n.document AS reader_note
      FROM dbo.Sources s
      LEFT JOIN dbo.Records t ON t.record_key=(N'source-text/'+s.generation_id+N'.json') COLLATE Latin1_General_100_BIN2
      LEFT JOIN dbo.Records n ON n.record_key=N'reader-notes/'+s.source_id+N'.json'
      WHERE s.active=1 AND NOT EXISTS(SELECT 1 FROM dbo.Records l WHERE l.record_key=N'source-lifecycle/'+s.source_id+N'.json' AND JSON_VALUE(l.document,'$.state')<>N'active');
      SELECT r.record_key,r.document FROM dbo.Records r
      INNER JOIN dbo.Sources s ON s.active=1 AND r.record_key LIKE (N'document-text/'+s.generation_id+N'/%') COLLATE Latin1_General_100_BIN2
      WHERE r.kind=N'document-text';`);
    const [sourceRows, documentRows] = result.recordsets as sql.IRecordSet<Record<string, string>>[];
    const records = new Map<string, unknown>(documentRows.map(row => [row.record_key, JSON.parse(row.document)]));
    const documents = new DocumentTexts({ read: async <T>(key: string) => records.get(key) as T | undefined });
    const inputs = new Map<string, { generationId: string; text?: unknown; fullText?: string; readerNote?: { markdown: string } }>();
    for (const row of sourceRows) {
      const note = noteSchema.parse(JSON.parse(row.note_json));
      inputs.set(row.source_id, { generationId: row.generation_id, text: row.source_text ? JSON.parse(row.source_text) : undefined,
        fullText: await documents.readAll(note), readerNote: row.reader_note ? JSON.parse(row.reader_note) : undefined });
    }
    return inputs;
  }
  async expireTemporaryRecords() {
    // Conversations, templates and reader notes are durable. Only transient chat records expire.
    await (await this.request()).query(`DELETE TOP (500) FROM dbo.Records
      WHERE updated_at < DATEADD(day,-1,SYSUTCDATETIME())
      AND (record_key LIKE 'chat/jobs/%' OR record_key LIKE 'chat/users/%'
        OR record_key LIKE 'chat/assets/%' OR record_key LIKE 'chat/cancellations/%');`);
    await (await this.request()).query(`DELETE TOP (500) FROM dbo.Records
      WHERE record_key LIKE 'reader-sessions/%'
      AND TRY_CONVERT(datetime2,JSON_VALUE(document,'$.expiresAt'),127) <= SYSUTCDATETIME();`);
  }
  private async snapshot() {
    const signatureRows = await (await this.request()).query(`SELECT source_id,generation_id,revision FROM dbo.Sources WHERE active=1 ORDER BY source_id;
      SELECT record_key,revision FROM dbo.Records WHERE kind IN (N'source-text',N'document-text',N'reader-notes',N'source-lifecycle') ORDER BY record_key;`);
    const signature = hash(JSON.stringify(signatureRows.recordsets));
    const key = `${process.env.SQL_SERVER}/${process.env.SQL_DATABASE}/${process.env.SQL_CONNECTION_STRING ? 'local' : 'entra'}`;
    const previous = snapshots.get(key);
    if (previous?.signature === signature) return previous.promise;
    const promise = this.buildSnapshot();
    snapshots.set(key, { signature, promise });
    promise.catch(() => { if (snapshots.get(key)?.promise === promise) snapshots.delete(key); });
    return promise;
  }
  private async buildSnapshot() {
    const sources = await this.sources();
    const inputs = await this.sourceInputs();
    const documents = sources.map(({ note, humanMarkdown }) => {
      const input = inputs.get(note.source.id);
      const text = input?.text;
      if (input?.fullText !== undefined && input.generationId !== note.generationId) throw new Error('Full search text does not match the published generation');
      return { id: note.source.id, title: note.source.title, authors: note.source.authors.join(' '),
        type: note.source.itemType, category: note.schemaVersion === 2 ? note.category.id : '',
        year: note.source.publishedAt?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 'Unknown',
        topics: (note.analysis?.topics || note.source.tags).join('\n'),
        body: `${JSON.stringify(note.analysis)}\n${humanMarkdown}\n${input?.readerNote?.markdown || ''}\n${input?.fullText || ''}\n${text ? matchedSourceText(note, text) : ''}` };
    });
    const index = JSON.parse(JSON.stringify(buildSearchIndex(documents)));
    const revision = chatSnapshotRevision(hash('sql'), sources, index);
    await this.create(`chat/corpora/${revision}.json`, { revision, sources });
    await this.create(`chat/indexes/${revision}.json`, { revision, index, sourceIds: sources.map(source => source.note.source.id) });
    return { revision, sources };
  }
}

export const createStore = () => {
  if (!process.env.STORAGE_ACCOUNT && !process.env.AZURITE_CONNECTION_STRING) throw new Error('Storage configuration is required');
  if (!process.env.SQL_SERVER && !process.env.SQL_CONNECTION_STRING) throw new Error('SQL configuration is required');
  return new SqlStore(process.env.STORAGE_ACCOUNT || 'devstoreaccount1');
};
