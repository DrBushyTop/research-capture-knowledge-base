import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { sqlPool, closeSql } from '../apps/worker/src/sql-connection.js';
import { SqlStore } from '../apps/worker/src/sql-store.js';
import { readCorpus } from '../shared/reader.js';

const runtime = process.env.CONTAINER_RUNTIME || 'podman';
const container = (name: string, args: string[]) => {
  try { execFileSync(runtime, ['container', 'inspect', name], { stdio: 'ignore' }); execFileSync(runtime, ['start', name], { stdio: 'ignore' }); }
  catch { execFileSync(runtime, ['run', '-d', '--name', name, ...args], { stdio: 'ignore' }); }
};
await mkdir('.local', { recursive: true });
// Use a generated account key instead of embedding credentials in a checked-in file.
let settings: Record<string, string>;
try { settings = JSON.parse(await readFile('.local/dev-settings.json', 'utf8')); }
catch { settings = { storageKey: randomBytes(64).toString('base64'), sqlPassword: 'Dev!' + randomBytes(20).toString('hex') }; }
await writeFile('.local/dev-settings.json', JSON.stringify(settings), { mode: 0o600 });
container('research-azurite-dev', ['-e', `AZURITE_ACCOUNTS=researchdev:${settings.storageKey}`, '-p', '127.0.0.1:10100:10000', '-p', '127.0.0.1:10101:10001', '-p', '127.0.0.1:10102:10002', '-v', 'research-azurite-dev:/data', 'mcr.microsoft.com/azure-storage/azurite:latest', 'azurite', '--blobHost', '0.0.0.0', '--queueHost', '0.0.0.0', '--tableHost', '0.0.0.0', '--skipApiVersionCheck']);
process.env.AZURITE_CONNECTION_STRING = `DefaultEndpointsProtocol=http;AccountName=researchdev;AccountKey=${settings.storageKey};BlobEndpoint=http://127.0.0.1:10100/researchdev;QueueEndpoint=http://127.0.0.1:10101/researchdev;TableEndpoint=http://127.0.0.1:10102/researchdev;`;
if (!process.env.SQL_SERVER && !process.env.SQL_CONNECTION_STRING) {
  if (process.arch === 'arm64') throw new Error('SQL Server Linux containers require x86-64. Set SQL_SERVER and SQL_DATABASE to a separate development database, then rerun setup. Never point local dev at production.');
  container('research-sql-dev', ['-e', 'ACCEPT_EULA=Y', '-e', 'MSSQL_PID=Developer', '-e', `MSSQL_SA_PASSWORD=${settings.sqlPassword}`, '-p', '127.0.0.1:14333:1433', '-v', 'research-sql-dev:/var/opt/mssql', 'mcr.microsoft.com/mssql/server:2022-latest']);
  process.env.SQL_CONNECTION_STRING = `Server=127.0.0.1,14333;Database=master;User Id=sa;Password=${settings.sqlPassword};Encrypt=false;TrustServerCertificate=true;`;
  await new Promise(resolve => setTimeout(resolve, 15000));
  await (await sqlPool()).request().query("IF DB_ID('research_dev') IS NULL CREATE DATABASE research_dev");
  await closeSql();
  process.env.SQL_CONNECTION_STRING = process.env.SQL_CONNECTION_STRING.replace('Database=master', 'Database=research_dev');
}
if (process.env.SQL_DATABASE === 'research') throw new Error('Local development must not use the production research database');
const blobs = BlobServiceClient.fromConnectionString(process.env.AZURITE_CONNECTION_STRING);
const queues = QueueServiceClient.fromConnectionString(process.env.AZURITE_CONNECTION_STRING);
for (const name of ['pipeline', 'raw', 'deployment']) await blobs.getContainerClient(name).createIfNotExists();
for (const name of ['processing', 'chat']) await queues.getQueueClient(name).createIfNotExists();
try {
  await (await sqlPool()).request().batch(await readFile('apps/worker/sql/001-initial.sql', 'utf8'));
  const store = new SqlStore('researchdev');
  if (!(await store.sources()).length) {
    for (const entry of await readCorpus('content/research', 'private')) {
      const human = await readFile(`content/research/${entry.note.source.id}/notes.md`, 'utf8');
      await store.withLease('seed', async () => {
        await store.publishNote(entry.note, human, entry.publication);
        await store.create(`snapshots/${entry.note.generationId}.json`, {
          source: entry.note.source,
          root: { key: entry.note.source.key, version: 1, data: { itemType: entry.note.source.itemType, title: entry.note.source.title, url: entry.note.source.url } },
          children: []
        });
        await store.write(`sources/${entry.note.source.id}.json`, { generationId: entry.note.generationId, source: entry.note.source, processingVersion: entry.note.processing.version });
        try {
          const text = JSON.parse(await readFile(`.local/search-source-text/${entry.note.generationId}.json`, 'utf8'));
          await store.create(`source-text/${entry.note.generationId}.json`, text);
        } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
      });
    }
  }
} finally { await closeSql(); }
await writeFile('.local/dev.env', Object.entries({ SQL_SERVER: process.env.SQL_SERVER || '', SQL_DATABASE: process.env.SQL_DATABASE || '', SQL_CONNECTION_STRING: process.env.SQL_CONNECTION_STRING || '', AZURITE_CONNECTION_STRING: process.env.AZURITE_CONNECTION_STRING, READER_GITHUB_USERS: 'pinaatti,DrBushyTop' }).map(([name,value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
console.log('Local database and blob emulator configured. Run npm run dev.');
