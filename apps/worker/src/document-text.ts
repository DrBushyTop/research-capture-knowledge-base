import { canonical, hash, noteArtifacts, type Note } from '../../../shared/corpus.js';
import { documentTextChunkKey, documentTextChunkSchema, documentTextLimits, documentTextManifestKey, documentTextManifestSchema,
  type DocumentTextInput, type DocumentTextManifest, type DocumentTextRead, type DocumentTextReadOptions } from '../../../shared/document-text.js';
import type { PipelineStore } from './pipeline.js';

type PinnedNote = Pick<Note, 'source' | 'generationId' | 'extraction'>;
type DocumentStore = Pick<PipelineStore, 'read'> & Partial<Pick<PipelineStore, 'create'>>;

/** Full original text stays separate from the bounded analysis input and belongs to one generation. */
export class DocumentTexts {
  constructor(private readonly store: DocumentStore) {}

  private identity(note: PinnedNote, artifactHash: string) {
    if (!noteArtifacts(note).some(artifact => artifact.hash === artifactHash)) throw new Error('Document text does not belong to the pinned attachment set');
    return { sourceId: note.source.id, generationId: note.generationId, fingerprint: note.source.fingerprint, artifactHash };
  }

  private async manifest(note: PinnedNote, artifactHash: string) {
    const identity = this.identity(note, artifactHash);
    const raw = await this.store.read(documentTextManifestKey(note.generationId, artifactHash));
    if (raw === undefined) return undefined;
    const manifest = documentTextManifestSchema.parse(raw);
    if (Object.entries(identity).some(([key, value]) => manifest[key as keyof typeof identity] !== value)) throw new Error('Document text does not match the pinned source generation');
    const artifacts = noteArtifacts(note).filter(item => item.hash === artifactHash);
    if (!artifacts.some(artifact => !artifact.mime || manifest.mime === artifact.mime.split(';')[0].trim().toLowerCase())) throw new Error('Document text MIME does not match its retained attachment');
    if (manifest.key && !artifacts.some(artifact => artifact.key === manifest.key)) throw new Error('Document text attachment key does not match its generation');
    let offset = 0;
    for (const [index, chunk] of manifest.chunks.entries()) {
      if (chunk.index !== index || chunk.offset !== offset) throw new Error('Document text manifest has inconsistent chunk positions');
      offset += chunk.length;
    }
    if (offset !== manifest.totalLength) throw new Error('Document text manifest length is inconsistent');
    return manifest;
  }

  private async chunk(manifest: DocumentTextManifest, entry: DocumentTextManifest['chunks'][number]) {
    const value = documentTextChunkSchema.parse(await this.store.read(documentTextChunkKey(manifest.generationId, manifest.artifactHash, entry.index)));
    if (value.sourceId !== manifest.sourceId || value.generationId !== manifest.generationId || value.fingerprint !== manifest.fingerprint || value.artifactHash !== manifest.artifactHash
      || value.index !== entry.index || value.offset !== entry.offset || value.locator !== entry.locator || value.page !== entry.page || value.text.length !== entry.length
      || value.textHash !== entry.textHash || hash(value.text) !== entry.textHash) throw new Error('Document text chunk does not match its immutable manifest');
    return value;
  }

  private async chunks(manifest: DocumentTextManifest, entries: DocumentTextManifest['chunks']) {
    const values: Awaited<ReturnType<DocumentTexts['chunk']>>[] = [];
    for (let start = 0; start < entries.length; start += 16) values.push(...await Promise.all(entries.slice(start, start + 16).map(entry => this.chunk(manifest, entry))));
    return values;
  }

  async retain(note: PinnedNote, documents: DocumentTextInput[]) {
    if (!this.store.create) throw new Error('Document text retention requires a writable store');
    for (const document of documents) {
      const identity = this.identity(note, document.hash);
      const references = noteArtifacts(note).filter(artifact => artifact.hash === document.hash);
      if (!references.some(artifact => (!artifact.mime || artifact.mime.split(';')[0].trim().toLowerCase() === document.mime.split(';')[0].trim().toLowerCase()) && (!document.key || artifact.key === document.key))) throw new Error('Full document text metadata does not match its retained attachment');
      const existing = await this.manifest(note, document.hash);
      // Replay uses the already committed extraction rather than creating a different text revision.
      if (existing) continue;
      const chunks: DocumentTextManifest['chunks'] = [];
      const pending: { key: string; value: ReturnType<typeof documentTextChunkSchema.parse> }[] = [];
      let offset = 0;
      let bytes = 0;
      for (const section of document.sections) {
        bytes += Buffer.byteLength(section.text);
        if (bytes > documentTextLimits.originalBytes) throw new Error('Full document text exceeds the 40 MiB extraction safeguard');
        for (let start = 0; start < section.text.length; start += documentTextLimits.chunkCharacters) {
          const text = section.text.slice(start, start + documentTextLimits.chunkCharacters);
          const index = chunks.length;
          if (index >= documentTextLimits.chunks) throw new Error('Full document text exceeds the chunk safeguard');
          const entry = { index, offset, length: text.length, locator: section.locator, ...(section.page ? { page: section.page } : {}), textHash: hash(text) };
          const { length: _length, ...fields } = entry;
          const value = documentTextChunkSchema.parse({ ...identity, ...fields, text });
          const key = documentTextChunkKey(note.generationId, document.hash, index);
          pending.push({ key, value });
          chunks.push(entry);
          offset += text.length;
        }
      }
      const manifest = documentTextManifestSchema.parse({ version: 1, ...identity, mime: document.mime.split(';')[0].trim().toLowerCase(),
        ...(document.key ? { key: document.key } : {}), ...(document.title ? { title: document.title } : {}), complete: document.complete,
        ...(document.reason ? { reason: document.reason.slice(0, 2000) } : {}), ...(document.totalPages !== undefined ? { totalPages: document.totalPages } : {}), totalLength: offset, chunks });
      for (let start = 0; start < pending.length; start += 16) {
        const results = await Promise.allSettled(pending.slice(start, start + 16).map(async ({ key, value }) => {
          await this.store.create!(key, value);
          const saved = documentTextChunkSchema.parse(await this.store.read(key));
          if (canonical(saved) !== canonical(value)) throw new Error('Retained document text differs from an interrupted extraction');
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
      // Publishing the manifest last makes an interrupted chunk upload invisible to readers.
      await this.store.create(documentTextManifestKey(note.generationId, document.hash), manifest);
      const committed = await this.manifest(note, document.hash);
      if (canonical(committed) !== canonical(manifest)) throw new Error('Retained document manifest differs from its extraction');
    }
  }

  async read(note: PinnedNote, options: DocumentTextReadOptions = {}): Promise<DocumentTextRead | undefined> {
    const artifacts = noteArtifacts(note).filter(artifact => (!options.artifactHash || artifact.hash === options.artifactHash) && (!options.attachmentKey || artifact.key === options.attachmentKey));
    if (!options.artifactHash && !options.attachmentKey) artifacts.sort((a, b) => Number(b.hash === note.extraction.artifactHash) - Number(a.hash === note.extraction.artifactHash));
    if (!artifacts.length && (options.artifactHash || options.attachmentKey)) throw new Error('Requested document is not in the pinned attachment set');
    let manifest: DocumentTextManifest | undefined;
    for (const artifact of artifacts) { manifest = await this.manifest(note, artifact.hash); if (manifest) break; }
    if (!manifest) return undefined;
    const selected = artifacts.find(artifact => artifact.hash === manifest.artifactHash)!;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? documentTextLimits.chunkCharacters;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > documentTextLimits.readCharacters) throw new Error('Invalid document text window');
    const pageRange = options.startPage !== undefined || options.endPage !== undefined;
    const startPage = options.startPage ?? 1;
    const endPage = options.endPage ?? options.startPage ?? manifest.totalPages ?? 1;
    if (pageRange && (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage)) throw new Error('Invalid document page range');
    if (pageRange && manifest.totalPages === undefined) throw new Error('The selected document has no page locators');
    if (pageRange && startPage > manifest.totalPages!) throw new Error(`Requested page ${startPage} is beyond the document's final page ${manifest.totalPages}.`);
    const finalPage = Math.min(endPage, manifest.totalPages ?? endPage);
    const entries = manifest.chunks.filter(entry => !pageRange || entry.page !== undefined && entry.page >= startPage && entry.page <= finalPage);
    const totalLength = entries.reduce((length, entry) => length + entry.length, 0);
    if (offset > totalLength) throw new Error('Document text offset exceeds the selected text length');
    const end = Math.min(totalLength, offset + limit);
    const sections: DocumentTextRead['sections'] = [];
    const selectedChunks: { entry: DocumentTextManifest['chunks'][number]; start: number; end: number }[] = [];
    let cursor = 0;
    for (const entry of entries) {
      const next = cursor + entry.length;
      if (next > offset && cursor < end) {
        const start = Math.max(0, offset - cursor);
        selectedChunks.push({ entry, start, end: Math.min(entry.length, end - cursor) });
      }
      cursor = next;
      if (cursor >= end) break;
    }
    const values = await this.chunks(manifest, selectedChunks.map(chunk => chunk.entry));
    for (const [index, value] of values.entries()) {
      const selected = selectedChunks[index];
      sections.push({ locator: value.locator, text: value.text.slice(selected.start, selected.end), ...(value.page ? { page: value.page } : {}), offset: selected.entry.offset + selected.start });
    }
    return { sourceId: manifest.sourceId, generationId: manifest.generationId, artifact: { hash: manifest.artifactHash, mime: manifest.mime,
      ...(selected.key || manifest.key ? { key: selected.key || manifest.key } : {}), ...(selected.title || manifest.title ? { title: selected.title || manifest.title } : {}) }, text: sections.map(section => section.text).join(''), sections,
      complete: manifest.complete, truncated: offset > 0 || end < totalLength, ...(manifest.reason ? { reason: manifest.reason } : {}),
      ...(manifest.totalPages !== undefined ? { totalPages: manifest.totalPages } : {}), totalLength, documentLength: manifest.totalLength, offset, nextOffset: end < totalLength ? end : null };
  }

  /** Find a context window anywhere in the retained files, without sending the whole document to chat. */
  async find(note: PinnedNote, query: string, options: Pick<DocumentTextReadOptions, 'artifactHash' | 'attachmentKey'> = {}, signal?: AbortSignal): Promise<DocumentTextRead | undefined> {
    const phrase = query.trim().toLowerCase();
    const words = [...new Set(phrase.split(/\s+/).filter(Boolean))].slice(0, 40);
    if (!words.length) return this.read(note, { ...options, limit: 16_000 });
    const artifacts = noteArtifacts(note).filter(artifact => (!options.artifactHash || artifact.hash === options.artifactHash) && (!options.attachmentKey || artifact.key === options.attachmentKey));
    if (!artifacts.length && (options.artifactHash || options.attachmentKey)) throw new Error('Requested document is not in the pinned attachment set');
    let best: { score: number; offset: number; artifact: typeof artifacts[number] } | undefined;
    const seen = new Set<string>();
    for (const artifact of artifacts) {
      if (seen.has(artifact.hash)) continue;
      seen.add(artifact.hash);
      signal?.throwIfAborted();
      const manifest = await this.manifest(note, artifact.hash);
      if (!manifest) continue;
      for (let start = 0; start < manifest.chunks.length; start += 16) {
        signal?.throwIfAborted();
        for (const chunk of await this.chunks(manifest, manifest.chunks.slice(start, start + 16))) {
          const text = chunk.text.toLowerCase();
          const exact = text.indexOf(phrase);
          const matches = words.filter(word => text.includes(word));
          const score = matches.length + (exact >= 0 ? words.length : 0);
          if (!score || best && score <= best.score) continue;
          const position = exact >= 0 ? exact : text.indexOf(matches.sort((a, b) => b.length - a.length)[0]);
          best = { score, artifact, offset: chunk.offset + Math.max(0, position - 1000) };
        }
      }
    }
    return this.read(note, { ...options, ...(best ? { artifactHash: best.artifact.hash, attachmentKey: best.artifact.key, offset: best.offset } : {}), limit: 16_000 });
  }

  /** Search can index all retained originals while analysis keeps its separate context budget. */
  async readAll(note: PinnedNote): Promise<string | undefined> {
    const documents: string[] = [];
    const seen = new Set<string>();
    for (const artifact of noteArtifacts(note)) {
      if (seen.has(artifact.hash)) continue;
      seen.add(artifact.hash);
      const manifest = await this.manifest(note, artifact.hash);
      if (!manifest) continue;
      const parts = [`Attachment ${manifest.key || manifest.artifactHash}: ${manifest.title || manifest.mime}\n`];
      let locator = '';
      for (const value of await this.chunks(manifest, manifest.chunks)) {
        if (value.locator !== locator) { parts.push(`\n\n${value.locator}\n`); locator = value.locator; }
        parts.push(value.text);
      }
      documents.push(parts.join(''));
    }
    return documents.length ? documents.join('\n\n') : undefined;
  }
}
