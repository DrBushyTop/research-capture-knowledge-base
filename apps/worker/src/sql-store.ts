import sql from 'mssql';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { BlobStore } from './storage.js';
import { sqlPool } from './sql-connection.js';
import { hash, noteSchema, privatePublication, type Note } from '../../../shared/corpus.js';
import { chatSnapshotRevision, type ChatCorpus } from '../../../shared/chat.js';
import { buildSearchIndex } from '../../../shared/search.js';
import { matchedSourceText } from '../../../shared/source-text.js';

type Frame = { key: string; owner: string; controller: AbortController; revisions: Map<string, string | undefined>; parent?: Frame };
export class SqlStore extends BlobStore {
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
  private guards(request: sql.Request) {
    let checks = '';
    let index = 0;
    for (let frame = this.frames.getStore(); frame; frame = frame.parent) {
      frame.controller.signal.throwIfAborted();
      request.input(`lock${index}`, sql.NVarChar(200), frame.key).input(`owner${index}`, sql.UniqueIdentifier, frame.owner);
      checks += `IF NOT EXISTS (SELECT 1 FROM dbo.Leases WITH (UPDLOCK,HOLDLOCK) WHERE lease_key=@lock${index} AND owner=@owner${index} AND expires_at>SYSUTCDATETIME()) THROW 51001, 'SQL lease was lost', 1;\n`;
      index++;
    }
    return checks;
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
      ${this.guards(request)}
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
      SELECT CONVERT(varchar(30),revision) AS revision FROM dbo.Records WHERE record_key=@key;
      COMMIT;`);
    frame.revisions.set(key, result.recordset[0].revision);
  }
  override async create(key: string, value: unknown) {
    const request = await this.request(key);
    request.input('document', sql.NVarChar(sql.MAX), JSON.stringify(value));
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      ${this.guards(request)}
      IF NOT EXISTS (SELECT 1 FROM dbo.Records WITH (UPDLOCK,HOLDLOCK) WHERE record_key=@key)
        INSERT dbo.Records(record_key,document) VALUES(@key,@document);
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
    if (!key.endsWith('.json')) await this.container.getBlockBlobClient(key).deleteIfExists();
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
    const frame: Frame = { key, owner, controller, revisions: new Map(), parent: this.frames.getStore() };
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
    await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; ${this.guards(request)}
      UPDATE dbo.Sources WITH(UPDLOCK,HOLDLOCK) SET generation_id=@generation,title=@title,item_type=@type,category_id=@category,
        published_at=@published,captured_at=@captured,active=@active,note_json=@note,
        human_markdown=COALESCE(@human,human_markdown),revision=revision+1,updated_at=SYSUTCDATETIME() WHERE source_id=@id;
      IF @@ROWCOUNT=0 INSERT dbo.Sources(source_id,generation_id,title,item_type,category_id,published_at,captured_at,active,note_json,human_markdown,publication_json)
        VALUES(@id,@generation,@title,@type,@category,@published,@captured,@active,@note,COALESCE(@human,N''),@publication);
      COMMIT;`);
  }
  async sources(): Promise<ChatCorpus['sources']> {
    const result = await (await this.request()).query('SELECT note_json,human_markdown FROM dbo.Sources WHERE active=1 ORDER BY captured_at DESC,source_id');
    return result.recordset.map(row => ({ note: noteSchema.parse(JSON.parse(row.note_json)), humanMarkdown: row.human_markdown }));
  }
  private async snapshot() {
    const sources = await this.sources();
    const documents = await Promise.all(sources.map(async ({ note, humanMarkdown }) => {
      const text = await this.read(`source-text/${note.generationId}.json`);
      return { id: note.source.id, title: note.source.title, authors: note.source.authors.join(' '),
        type: note.source.itemType, category: note.schemaVersion === 2 ? note.category.id : '',
        year: note.source.publishedAt?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 'Unknown',
        topics: (note.analysis?.topics || note.source.tags).join('\n'),
        body: `${JSON.stringify(note.analysis)}\n${humanMarkdown}\n${text ? matchedSourceText(note, text) : ''}` };
    }));
    const index = JSON.parse(JSON.stringify(buildSearchIndex(documents)));
    const revision = chatSnapshotRevision(hash('sql'), sources, index);
    await this.create(`chat/corpora/${revision}.json`, { revision, sources });
    await this.create(`chat/indexes/${revision}.json`, { revision, index });
    return { revision, sources };
  }
}

export const createStore = () => {
  if (!process.env.STORAGE_ACCOUNT && !process.env.AZURITE_CONNECTION_STRING) throw new Error('Storage configuration is required');
  if (!process.env.SQL_SERVER && !process.env.SQL_CONNECTION_STRING) throw new Error('SQL configuration is required');
  return new SqlStore(process.env.STORAGE_ACCOUNT || 'devstoreaccount1');
};
