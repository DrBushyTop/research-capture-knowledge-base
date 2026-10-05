import { app } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { processingVersion } from '../../../shared/corpus.js';
import { BlobStore } from './storage.js';
import { Zotero } from './zotero.js';
import { discover, reconcile } from './pipeline.js';
import { extract } from './extraction.js';
import { enrich, licenseEvidence } from './enrichment.js';
import { processJob } from './processing.js';
import { ChatAccessError, chatStatus, processChatJob, readerIdentity, reconcileChat, submitChat } from './chat-service.js';
import { gatherEvidence, sandboxClient } from './chat-sandbox.js';
import { deleteExpiredWorkspaces } from './sandbox-lifecycle.js';
import { answerQuestion } from './chat-model.js';
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing configuration: ${name}`); return value; };
const store = () => new BlobStore(required('STORAGE_ACCOUNT'));
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
    if (library) await discover(state, library, version, process.env.ZOTERO_COLLECTION);
    await reconcile(state, id => state.send(id));
    context.log(JSON.stringify({ event: 'discovery-complete', libraryVersion: library?.version ?? checkpoint?.libraryVersion }));
  }
});
app.http('chatGateway', {
  route: 'chat', methods: ['GET', 'POST'], authLevel: 'function',
  handler: async request => {
    try {
      const owner = readerIdentity(request.headers.get('x-ms-client-principal'));
      const state = store();
      const result = request.method === 'GET' ? await chatStatus(state, owner, request.query.get('id') || '') : await (async () => {
        const text = await request.text();
        if (Buffer.byteLength(text) > 16_384) throw new ChatAccessError(413, 'Question is too large');
        let input: unknown; try { input = JSON.parse(text); } catch { throw new ChatAccessError(400, 'Invalid question'); }
        return submitChat(state, owner, input, id => state.sendChat(id));
      })();
      return { status: request.method === 'POST' ? 202 : 200, jsonBody: result, headers: { 'Cache-Control': 'private, no-store' } };
    } catch (error) {
      return { status: error instanceof ChatAccessError ? error.status : 503, jsonBody: { error: error instanceof ChatAccessError ? error.message : 'Chat is temporarily unavailable. Try again.' }, headers: { 'Cache-Control': 'private, no-store' } };
    }
  }
});
app.timer('recoverChats', { schedule: '30 */5 * * * *', handler: async (_timer, context) => {
  const state = store(); await reconcileChat(state, id => state.sendChat(id));
  await deleteExpiredWorkspaces(sandboxClient());
  context.log(JSON.stringify({ event: 'chat-reconciliation-complete' }));
} });
app.storageQueue('answerChat', { queueName: 'chat', connection: 'AzureWebJobsStorage', handler: async (message: unknown, context) => {
  const payload = typeof message === 'string' ? JSON.parse(message) : message;
  const id = (payload as { jobId: string }).jobId;
  const state = store();
  await processChatJob(state, id, async (corpus, job, record) => {
    const { evidence, image } = await gatherEvidence(state, corpus, job, record);
    context.log(JSON.stringify({ event: 'chat-evidence-ready', jobId: id, passages: evidence.length, visual: Boolean(image) }));
    return { answer: await answerQuestion(job.request, evidence, image?.dataUrl, state.leaseSignal), evidence };
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
      await processJob(state, id, { version: process.env.PROCESSING_VERSION || processingVersion, model: required('FOUNDRY_DEPLOYMENT'),
        extract: async snapshot => extract(snapshot, await zotero(), (hash, bytes, mime) => state.retainSource(snapshot.source.fingerprint, hash, bytes, mime), () => state.restoreSource(snapshot.source.fingerprint)),
        enrich: (text, signal) => enrich(text, required('FOUNDRY_ENDPOINT'), required('FOUNDRY_DEPLOYMENT'), signal), rights: licenseEvidence });
      context.log(JSON.stringify({ event: 'processing-complete', jobId: id }));
    } catch {
      context.error(JSON.stringify({ event: 'processing-retry', jobId: /^[a-f0-9]{64}$/.test(id) ? id : 'invalid' }));
      throw new Error('Capture processing failed; durable job is recoverable');
    }
  }
});
