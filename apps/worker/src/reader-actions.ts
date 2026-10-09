import type { SqlStore } from './sql-store.js';
import type { PipelineStore } from './source-generations.js';
import type { ArtifactReaderStore } from './source-artifact-reader.js';
import { changeSourceLifecycleSchema } from '../../../shared/source-lifecycle.js';
import { SourceAccessError, SourceLifecycleService, sourceLifecycle, sourceLifecycles } from './source-lifecycle.js';
import { readLibrary, readTrash } from './library.js';
import { categoryOverview, startBatch, changeBatch, startPreview, getPreview } from './category-work.js';
import { CategoryError, saveCategory } from './category-registry.js';
import { ChatAccessError, cancelChat, chatStatus, deleteConversation, getConversation, listConversations, submitChat } from './chat-service.js';
import { readChatFile } from './chat-files.js';
import { readSourceDocument, readSourceText } from './source-reader.js';
import { chatUploadLimits, readUpload, saveUpload } from './chat-uploads.js';
import { readReaderNote, saveReaderNote } from './reader-notes.js';

export type ReaderStore = PipelineStore & ArtifactReaderStore & Pick<SqlStore, 'sources' | 'sourceInputs' | 'retainedSource' | 'createBinary' | 'readBinary' | 'container' | 'send' | 'sendChat' | 'remove'>;
export interface ReaderRequest {
  method: string;
  query: URLSearchParams;
  headers: Pick<Headers, 'get'>;
  body?: AsyncIterable<Uint8Array>;
}
export interface ReaderResponse {
  status: number;
  headers: Record<string, string>;
  jsonBody?: unknown;
  body?: Buffer;
}
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const fileHeaders = { ...privateHeaders, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
const json = (jsonBody: unknown, status = 200): ReaderResponse => ({ status, jsonBody, headers: privateHeaders });
const file = (value: { bytes: Buffer; mime: string; filename: string; disposition?: string }): ReaderResponse => ({
  status: 200, body: value.bytes,
  headers: { ...fileHeaders, 'Content-Type': value.mime, 'Content-Disposition': `${value.disposition || 'inline'}; filename="${value.filename}"` }
});

async function bodyBytes(request: ReaderRequest, limit: number, message: string) {
  if (Number(request.headers.get('content-length')) > limit) throw new ChatAccessError(413, message);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.body || []) {
    size += chunk.byteLength;
    if (size > limit) throw new ChatAccessError(413, message);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function bodyJson(request: ReaderRequest, limit: number, tooLarge: string, invalid: string): Promise<Record<string, unknown>> {
  const bytes = await bodyBytes(request, limit, tooLarge);
  try {
    const input = JSON.parse(bytes.toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch { throw new ChatAccessError(400, invalid); }
}

/** Both transports dispatch authenticated Reader requests here. Session authentication stays in the production adapter. */
export async function handleReaderRequest(store: ReaderStore, owner: string, request: ReaderRequest,
  deleteSource: (id: string) => Promise<void> = id => store.send(`d_${id}`)): Promise<ReaderResponse> {
  const { method, query } = request;
  if (!['GET', 'POST'].includes(method)) throw new ChatAccessError(405, 'Use GET or POST');
  if (method === 'GET' && query.has('lifecycles')) return json(await sourceLifecycles(store));
  if (method === 'GET' && query.has('trash')) return json(await readTrash(store));
  if (query.has('lifecycle')) {
    const id = query.get('lifecycle') || '';
    if (method === 'GET') return json(await sourceLifecycle(store, id));
    const input = await bodyJson(request, 1000, 'Action is too large', 'Invalid source action');
    const parsed = changeSourceLifecycleSchema.safeParse(input);
    if (!parsed.success) throw new SourceAccessError(400, 'Invalid source action');
    const result = await new SourceLifecycleService(store).change(id, parsed.data.action, parsed.data.revision, owner);
    if (result.state === 'purging') await deleteSource(id).catch(() => undefined);
    return json(result);
  }
  if (method === 'GET' && query.has('library')) return json(await readLibrary(store));
  if (query.has('notes')) {
    if (method === 'GET') return json(await readReaderNote(store, query.get('notes') || ''));
    const input = await bodyJson(request, 100_000, 'Notes are too large', 'Invalid notes');
    if (input.sourceId !== query.get('notes')) throw new ChatAccessError(400, 'Source does not match the notes request');
    return json(await saveReaderNote(store, owner, input));
  }
  if (query.has('admin')) {
    if (method === 'GET') return json(query.has('preview') ? await getPreview(store, owner, query.get('preview') || '') : await categoryOverview(store));
    const input = await bodyJson(request, 40_000, 'Settings are too large', 'Invalid settings');
    const send = (id: string) => store.send(id);
    if (input.action === 'save') {
      if (!Number.isInteger(input.registryRevision)) throw new CategoryError(400, 'Invalid category revision');
      return json({ registry: await saveCategory(store, input.registryRevision as number, input.template) });
    }
    if (input.action === 'update') return json(await startBatch(store, input.batch, send));
    if (input.action === 'preview') {
      if (typeof input.sourceId !== 'string') throw new CategoryError(400, 'Invalid preview source');
      return json(await startPreview(store, owner, input.sourceId, input.template, send));
    }
    if (input.action === 'cancel' || input.action === 'retry') {
      if (typeof input.id !== 'string' || input.sourceId !== undefined && typeof input.sourceId !== 'string') throw new CategoryError(400, 'Invalid category action');
      return json(await changeBatch(store, input.id, input.action, send, input.sourceId as string | undefined));
    }
    throw new CategoryError(400, 'Unknown category action');
  }
  if (method === 'GET' && query.has('source')) {
    const offset = query.get('offset');
    if (offset !== null && !/^\d{1,10}$/.test(offset)) throw new ChatAccessError(400, 'Invalid original text position');
    const attachmentKey = query.get('attachment');
    if (attachmentKey !== null && !/^[A-Z0-9]{8}$/.test(attachmentKey)) throw new ChatAccessError(400, 'Invalid original attachment');
    return json(await readSourceText(store, query.get('source') || '', { ...(offset !== null ? { offset: Number(offset) } : {}), ...(attachmentKey ? { attachmentKey } : {}) }));
  }
  if (method === 'GET' && query.has('document')) return file(await readSourceDocument(store, query.get('document') || '', query.get('attachment')));
  if (query.has('upload')) {
    if (method === 'GET') {
      const upload = await readUpload(store, owner, query.get('upload') || '');
      return file({ ...upload, filename: 'screenshot' });
    }
    const bytes = await bodyBytes(request, chatUploadLimits.bytes, 'Images must be 5 MB or smaller');
    return json(await saveUpload(store, owner, bytes, request.headers.get('content-type')), 201);
  }
  if (method === 'GET' && (query.has('asset') || query.has('file')))
    return file(await readChatFile(store, owner, query.get('id') || '', query.get('asset'), query.get('file'), query.get('evidence')));
  if (method === 'GET') return json(query.has('conversation') ? await getConversation(store, owner, query.get('conversation') || '')
    : query.has('conversations') ? await listConversations(store, owner) : await chatStatus(store, owner, query.get('id') || ''));
  const input = await bodyJson(request, 40_000, 'Message is too large', 'Invalid question');
  if (input.action === 'cancel') {
    if (typeof input.id !== 'string') throw new ChatAccessError(400, 'Invalid question');
    return json(await cancelChat(store, owner, input.id), 202);
  }
  if (input.action === 'delete') {
    if (typeof input.conversationId !== 'string') throw new ChatAccessError(400, 'Invalid conversation');
    return json(await deleteConversation(store, owner, input.conversationId), 202);
  }
  return json(await submitChat(store, owner, input, id => store.sendChat(id)), 202);
}

/** Unknown errors never expose storage or configuration details to a Reader. */
export function readerErrorResponse(error: unknown): ReaderResponse {
  const known = error instanceof ChatAccessError || error instanceof CategoryError || error instanceof SourceAccessError;
  return json({ error: known ? error.message : 'The service is temporarily unavailable. Try again.' }, known ? error.status : 503);
}
