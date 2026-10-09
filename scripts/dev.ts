import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { createStore } from '../apps/worker/src/sql-store.js';
import { localReaderHandler } from '../apps/worker/src/reader-local.js';
import { closeSql } from '../apps/worker/src/sql-connection.js';

for (const line of (await readFile('.local/dev.env', 'utf8')).split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = JSON.parse(match[2]);
}
if (process.env.SQL_DATABASE === 'research') throw new Error('Do not connect local dev to production SQL');
const store = createStore();
const api = createServer(localReaderHandler(store));
api.listen(7072, '127.0.0.1');
const vite = await createVite({ configFile: 'apps/reader/vite.config.ts', server: { host: '0.0.0.0', port: 4360, strictPort: true, allowedHosts: ['m1.saiga-bleak.ts.net'], proxy: { '/api': 'http://127.0.0.1:7072' } } });
await vite.listen();
console.log('Local reader ready. Notes, categories and source reading use the development SQL database. Model work requires npm run dev:worker with Foundry settings.');
process.on('SIGINT', () => { void vite.close().then(closeSql).finally(() => { api.close(); process.exit(); }); });
await new Promise(() => {});
