import { app, type HttpResponseInit } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { processingVersion } from '../../../shared/corpus.js';
import { createStore } from './sql-store.js';
import { Zotero } from './zotero.js';
import { discover, reconcile } from './pipeline.js';
import { enrich, classifySource, enrichTemplate, licenseEvidence } from './enrichment.js';
import { categoryRegistry, CategoryError, saveCategory } from './category-registry.js';
import { categoryOverview, startBatch, dispatchBatch, changeBatch, recoverCategoryWork, startPreview, getPreview, processPreview } from './category-work.js';
import { ChatAccessError, cancelChat, chatStatus, deleteConversation, getConversation, listConversations, processChatJob, readerIdentity, reconcileChat, submitChat } from './chat-service.js';
import { sandboxClient } from './chat-sandbox.js';
import { deleteExpiredWorkspaces } from './sandbox-lifecycle.js';
import { discuss } from './chat-agent.js';
import { corpusTools } from './chat-tools.js';
import { readChatFile } from './chat-files.js';
import { readSourceDocument, readSourceText } from './source-reader.js';
import { chatUploadLimits, readUpload, saveUpload } from './chat-uploads.js';
import { readReaderNote, saveReaderNote } from './reader-notes.js';
import { readLibrary } from './library.js';
import { readerSessionResponse, sessionReaderIdentity } from './reader-session.js';
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing configuration: ${name}`); return value; };
const store = createStore;
let zoteroPromise: Promise<Zotero> | undefined;
async function zotero() {
  return zoteroPromise ??= (async () => {
    const secrets = new SecretClient(required('KEY_VAULT_URI'), new DefaultAzureCredential());
    const [id, key] = await Promise.all([secrets.getSecret('zotero-account-id'), secrets.getSecret('zotero-api-key')]);
    if (!id.value || !key.value) throw new Error('Zotero read credentials are missing');
    return new Zotero(id.value, key.value);
  })().catch(error => { zoteroPromise = undefined; throw error; });
}
app.timer('discoverCaptures', {
  schedule: '0 */5 * * * *', runOnStartup: false,
  handler: async (_timer, context) => {
    const state = store();
    const version = process.env.PROCESSING_VERSION || processingVersion;
    const checkpoint = await state.read<{ libraryVersion: number; processingVersion: string }>('checkpoint.json');
    const library = await (await zotero()).snapshot(checkpoint?.processingVersion === version ? checkpoint.libraryVersion : undefined);
    if (library) await discover(state, library, version, process.env.ZOTERO_COLLECTION, await categoryRegistry(state));
    await recoverCategoryWork(state, id => state.send(id));
    await reconcile(state, id => state.send(id));
    context.log(JSON.stringify({ event: 'discovery-complete', libraryVersion: library?.version ?? checkpoint?.libraryVersion }));
  }
});
app.http('chatGateway', {
  route: 'chat', methods: ['GET', 'POST'], authLevel: 'function',
  handler: async (request, context): Promise<HttpResponseInit> => {
    try {
      const state = store();
      const encoded = request.headers.get('x-ms-client-principal');
      const token = request.headers.get('x-reader-session');
      if (request.query.has('session')) return await readerSessionResponse(state, { encoded, token, renew: request.method === 'POST', logout: request.method === 'POST' && request.query.has('logout'), start: request.query.get('session') === 'start' });
      const owner = await sessionReaderIdentity(state, encoded, token);
      if (request.method === 'GET' && request.query.has('library')) return { status: 200, jsonBody: await readLibrary(state), headers: { 'Cache-Control': 'private, no-store' } };
      if (request.query.has('notes')) {
        const headers = { 'Cache-Control': 'private, no-store' };
        if (request.method === 'GET') return { status: 200, jsonBody: await readReaderNote(state, request.query.get('notes') || ''), headers };
        const text = await request.text();
        if (Buffer.byteLength(text) > 100_000) throw new ChatAccessError(413, 'Notes are too large');
        let input: unknown; try { input = JSON.parse(text); } catch { throw new ChatAccessError(400, 'Invalid notes'); }
        if ((input as { sourceId?: unknown })?.sourceId !== request.query.get('notes')) throw new ChatAccessError(400, 'Source does not match the notes request');
        return { status: 200, jsonBody: await saveReaderNote(state, owner, input), headers };
      }
      if (request.query.has('admin')) {
        const headers = { 'Cache-Control': 'private, no-store' };
        if (request.method === 'GET') return { status: 200, jsonBody: request.query.has('preview') ? await getPreview(state, owner, request.query.get('preview') || '') : await categoryOverview(state), headers };
        const text = await request.text();
        if (Buffer.byteLength(text) > 40_000) throw new CategoryError(413, 'Settings are too large');
        let input: any; try { input = JSON.parse(text); } catch { throw new CategoryError(400, 'Invalid settings'); }
        const send = (id: string) => state.send(id);
        const result = input?.action === 'save' ? { registry: await saveCategory(state, input.registryRevision, input.template) }
          : input?.action === 'update' ? await startBatch(state, input.batch, send)
          : input?.action === 'preview' ? await startPreview(state, owner, input.sourceId, input.template, send)
          : ['cancel', 'retry'].includes(input?.action) ? await changeBatch(state, input.id, input.action, send, input.sourceId)
          : (() => { throw new CategoryError(400, 'Unknown category action'); })();
        return { status: 200, jsonBody: result, headers };
      }
      const fileHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
      if (request.method === 'GET' && request.query.has('source')) return { status: 200, jsonBody: await readSourceText(state, request.query.get('source') || ''), headers: { 'Cache-Control': 'private, no-store' } };
      if (request.method === 'GET' && request.query.has('document')) {
        const file = await readSourceDocument(state, request.query.get('document') || '');
        return { status: 200, body: file.bytes, headers: { ...fileHeaders, 'Content-Type': file.mime, 'Content-Disposition': `inline; filename="${file.filename}"` } };
      }
      if (request.method === 'GET' && request.query.has('upload')) {
        const upload = await readUpload(state, owner, request.query.get('upload') || '');
        return { status: 200, body: upload.bytes, headers: { ...fileHeaders, 'Content-Type': upload.mime, 'Content-Disposition': 'inline; filename="screenshot"' } };
      }
      if (request.method === 'POST' && request.query.has('upload')) {
        if (Number(request.headers.get('content-length')) > chatUploadLimits.bytes) throw new ChatAccessError(413, 'Images must be 5 MB or smaller');
        const bytes = Buffer.from(await request.arrayBuffer());
        return { status: 201, jsonBody: await saveUpload(state, owner, bytes, request.headers.get('content-type')), headers: { 'Cache-Control': 'private, no-store' } };
      }
      if (request.method === 'GET' && (request.query.has('asset') || request.query.has('file'))) {
        const file = await readChatFile(state, owner, request.query.get('id') || '', request.query.get('asset'), request.query.get('file'), request.query.get('evidence'));
        return { status: 200, body: file.bytes, headers: { 'Content-Type': file.mime, 'Content-Disposition': `inline; filename="${file.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } };
      }
      const result = request.method === 'GET' ? request.query.has('conversation') ? await getConversation(state, owner, request.query.get('conversation') || '') : request.query.has('conversations') ? await listConversations(state, owner) : await chatStatus(state, owner, request.query.get('id') || '') : await (async () => {
        const text = await request.text();
        if (Buffer.byteLength(text) > 40_000) throw new ChatAccessError(413, 'Message is too large');
        let input: unknown; try { input = JSON.parse(text); } catch { throw new ChatAccessError(400, 'Invalid question'); }
        if ((input as { action?: string })?.action === 'cancel') return cancelChat(state, owner, (input as { id: string }).id);
        if ((input as { action?: string })?.action === 'delete') return deleteConversation(state, owner, String((input as { conversationId?: unknown }).conversationId));
        return submitChat(state, owner, input, id => state.sendChat(id));
      })();
      return { status: request.method === 'POST' ? 202 : 200, jsonBody: result, headers: { 'Cache-Control': 'private, no-store' } };
    } catch (error) {
      context.error(JSON.stringify({ event: 'gateway-error', name: (error as Error).name, code: (error as { code?: string }).code, number: (error as { number?: number }).number }));
      return { status: error instanceof ChatAccessError || error instanceof CategoryError ? error.status : 503, jsonBody: { error: error instanceof ChatAccessError || error instanceof CategoryError ? error.message : 'The service is temporarily unavailable. Try again.' }, headers: { 'Cache-Control': 'private, no-store' } };
    }
  }
});
app.timer('recoverChats', { schedule: '30 */5 * * * *', handler: async (_timer, context) => {
  const state = store(); await reconcileChat(state, id => state.sendChat(id));
  await state.expireTemporaryRecords();
  await deleteExpiredWorkspaces(sandboxClient());
  context.log(JSON.stringify({ event: 'chat-reconciliation-complete' }));
} });
app.storageQueue('answerChat', { queueName: 'chat', connection: 'AzureWebJobsStorage', handler: async (message: unknown, context) => {
  const payload = typeof message === 'string' ? JSON.parse(message) : message;
  const id = (payload as { jobId: string }).jobId;
  const state = store();
  await processChatJob(state, id, async (corpus, job, record, conversation, progress, signal, draft) => {
    return discuss(job, conversation, { ...await corpusTools(state, corpus, job, record, progress, signal), draft }, signal);
  });
  context.log(JSON.stringify({ event: 'chat-processing-complete', jobId: /^[a-f0-9]{32}$/.test(id) ? id : 'invalid' }));
} });
app.storageQueue('processCapture', {
  queueName: 'processing', connection: 'AzureWebJobsStorage',
  handler: async (message: unknown, context) => {
    const payload = typeof message === 'string' ? JSON.parse(message) : message;
    const id = (payload as { jobId: string }).jobId;
    try {
      const state = store();
      const analyzeTemplate = (text: string, template: import('../../../shared/categories.js').Template, signal?: AbortSignal, source?: import('../../../shared/corpus.js').Note['source'], images?: import('./image-input.js').SourceImage[]) => enrichTemplate(text, template, required('FOUNDRY_ENDPOINT'), required('FOUNDRY_DEPLOYMENT'), signal, source, images);
      if (id.startsWith('b_')) { await dispatchBatch(state, id, next => state.send(next)); return; }
      if (id.startsWith('p_')) {
        const { SourceArtifacts } = await import('./source-artifacts.js');
        await processPreview(state, id, analyzeTemplate, new SourceArtifacts(state)); return;
      }
      // Parsing and browser capture are processing-only dependencies, not part of reader API startup.
      const [{ SourceArtifacts }, { recoverWebpage }, { processJob }] = await Promise.all([
        import('./source-artifacts.js'), import('./browser-sandbox.js'), import('./processing.js')
      ]);
      await processJob(state, id, { version: process.env.PROCESSING_VERSION || processingVersion, model: required('FOUNDRY_DEPLOYMENT'),
        extract: async snapshot => new SourceArtifacts(state).extract(snapshot, { request: async (...args) => (await zotero()).request(...args) }, process.env.BROWSER_SANDBOX_SNAPSHOT ? () => recoverWebpage(snapshot, state, state.leaseSignal || AbortSignal.timeout(180_000)) : undefined),
        enrich: (text, signal, images) => enrich(text, required('FOUNDRY_ENDPOINT'), required('FOUNDRY_DEPLOYMENT'), signal, images),
        classify: (source, text, registry, signal, images) => classifySource(source, text, registry, required('FOUNDRY_ENDPOINT'), required('FOUNDRY_DEPLOYMENT'), signal, images),
        analyzeTemplate, rights: licenseEvidence });
      context.log(JSON.stringify({ event: 'processing-complete', jobId: id }));
    } catch {
      context.error(JSON.stringify({ event: 'processing-retry', jobId: /^[a-f0-9]{64}$/.test(id) ? id : 'invalid' }));
      throw new Error('Capture processing failed; durable job is recoverable');
    }
  }
});
