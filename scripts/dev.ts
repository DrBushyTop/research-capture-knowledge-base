import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { createStore } from '../apps/worker/src/sql-store.js';
import { readLibrary } from '../apps/worker/src/library.js';
import { categoryOverview, startBatch, startPreview, getPreview, changeBatch } from '../apps/worker/src/category-work.js';
import { saveCategory } from '../apps/worker/src/category-registry.js';
import { readReaderNote, saveReaderNote } from '../apps/worker/src/reader-notes.js';
import { readSourceText, readSourceDocument } from '../apps/worker/src/source-reader.js';
import { listConversations, getConversation, submitChat, chatStatus, cancelChat, deleteConversation } from '../apps/worker/src/chat-service.js';
import { closeSql } from '../apps/worker/src/sql-connection.js';

for (const line of (await readFile('.local/dev.env', 'utf8')).split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = JSON.parse(match[2]);
}
if (process.env.SQL_DATABASE === 'research') throw new Error('Do not connect local dev to production SQL');
const store = createStore();
const api = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
  const url = new URL(request.url!, 'http://localhost');
  const owner = 'local-developer';
  try {
    let body: any;
    if (request.method === 'POST') { const chunks = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 100000) throw new Error('Request too large'); chunks.push(chunk); } body = JSON.parse(Buffer.concat(chunks).toString()); }
    let result: unknown;
    if (url.searchParams.has('library')) result = await readLibrary(store);
    else if (url.searchParams.has('notes')) result = body ? await saveReaderNote(store, owner, body) : await readReaderNote(store, url.searchParams.get('notes')!);
    else if (url.searchParams.has('source')) result = await readSourceText(store, url.searchParams.get('source')!);
    else if (url.searchParams.has('document')) { const file = await readSourceDocument(store, url.searchParams.get('document')!); response.setHeader('Content-Type', file.mime); response.end(file.bytes); return; }
    else if (url.pathname === '/api/categories') {
      result = !body ? url.searchParams.has('preview') ? await getPreview(store, owner, url.searchParams.get('preview')!) : await categoryOverview(store)
        : body.action === 'save' ? { registry: await saveCategory(store, body.registryRevision, body.template) }
        : body.action === 'update' ? await startBatch(store, body.batch, id => store.send(id))
        : body.action === 'preview' ? await startPreview(store, owner, body.sourceId, body.template, id => store.send(id))
        : await changeBatch(store, body.id, body.action, id => store.send(id), body.sourceId);
    } else if (!body) result = url.searchParams.has('conversations') ? await listConversations(store, owner)
      : url.searchParams.has('conversation') ? await getConversation(store, owner, url.searchParams.get('conversation')!)
      : await chatStatus(store, owner, url.searchParams.get('id') || '');
    else result = body.action === 'cancel' ? await cancelChat(store, owner, body.id)
      : body.action === 'delete' ? await deleteConversation(store, owner, body.conversationId)
      : await submitChat(store, owner, body, id => store.sendChat(id));
    response.end(JSON.stringify(result));
  } catch (error) { response.statusCode = (error as { status?: number }).status || 503; response.end(JSON.stringify({ error: (error as Error).message })); }
});
api.listen(7072, '127.0.0.1');
const vite = await createVite({ configFile: 'apps/reader/vite.config.ts', server: { host: '0.0.0.0', port: 4360, strictPort: true, allowedHosts: ['m1.saiga-bleak.ts.net'], proxy: { '/api': 'http://127.0.0.1:7072' } } });
await vite.listen();
console.log('Local reader ready. Notes, categories and source reading use the development SQL database. Model work requires npm run dev:worker with Foundry settings.');
process.on('SIGINT', () => { void vite.close().then(closeSql).finally(() => { api.close(); process.exit(); }); });
await new Promise(() => {});
