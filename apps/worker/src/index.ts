import { app, type HttpResponseInit } from '@azure/functions';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { handleReaderRequest, readerErrorResponse } from './reader-actions.js';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { processingVersion } from '../../../shared/corpus.js';
import { createStore } from './sql-store.js';
import { Zotero } from './zotero.js';
import { discover, reconcile } from './pipeline.js';
import { enrich, classifySource, enrichTemplate, licenseEvidence } from './enrichment.js';
import { categoryRegistry } from './category-registry.js';
import { dispatchBatch, recoverCategoryWork, processPreview } from './category-work.js';
import { processChatJob, reconcileChat } from './chat-service.js';
import { sandboxClient } from './chat-sandbox.js';
import { deleteExpiredWorkspaces } from './sandbox-lifecycle.js';
import { discuss } from './chat-agent.js';
import { corpusTools } from './chat-tools.js';
import { SourceLifecycleService } from './source-lifecycle.js';
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
      return await handleReaderRequest(state, owner, {
        method: request.method, query: request.query, headers: request.headers,
        body: request.body ? Readable.fromWeb(request.body as ReadableStream<Uint8Array>) : undefined
      });
    } catch (error) {
      context.error(JSON.stringify({ event: 'gateway-error', name: (error as Error).name, code: (error as { code?: string }).code, number: (error as { number?: number }).number }));
      return readerErrorResponse(error);
    }
  }
});
app.timer('recoverChats', { schedule: '30 */5 * * * *', handler: async (_timer, context) => {
  const state = store(); await reconcileChat(state, id => state.sendChat(id));
  await state.expireTemporaryRecords();
  await deleteExpiredWorkspaces(sandboxClient());
  context.log(JSON.stringify({ event: 'chat-reconciliation-complete' }));
} });
app.timer('recoverSourceDeletion', { schedule: '0 * * * * *', handler: async () => { await new SourceLifecycleService(store()).recover(); } });
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
      if (id.startsWith('d_')) { await new SourceLifecycleService(state).cleanup(id.slice(2)); return; }
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
        extract: async (snapshot, generationId) => new SourceArtifacts(state).extract(snapshot, { request: async (...args) => (await zotero()).request(...args) }, process.env.BROWSER_SANDBOX_SNAPSHOT ? () => recoverWebpage(snapshot, state, state.leaseSignal || AbortSignal.timeout(360_000)) : undefined, generationId),
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
