import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { gatherEvidence } from '../apps/worker/src/chat-sandbox.js';
import type { BlobStore } from '../apps/worker/src/storage.js';
import type { ChatCorpus, ChatJob } from '../shared/chat.js';
import { readerStore } from './reader-actions-fixture.js';

const sandbox = vi.hoisted(() => ({ exec: vi.fn(), read: vi.fn(), deleted: vi.fn() }));
vi.mock('@azure/containerapps-sandbox', () => ({ endpointForRegion: () => 'https://sandbox.test', SandboxGroupClient: class { sandboxes = { exec: sandbox.exec }; } }));
vi.mock('../apps/worker/src/sandbox-lifecycle.js', () => ({
  createWorkspace: async (_client: unknown, _signal: AbortSignal, record: (id: string) => Promise<void>) => { await record('workspace'); },
  denyWorkspaceEgress: async () => {}, writeWorkspaceFile: async () => {}, readWorkspaceFile: sandbox.read, deleteWorkspace: sandbox.deleted
}));

beforeEach(() => {
  for (const name of ['SANDBOX_REGION', 'AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'SANDBOX_GROUP']) vi.stubEnv(name, 'fixture');
  sandbox.exec.mockReset().mockResolvedValue({ exitCode: 0 });
  sandbox.read.mockReset();
  sandbox.deleted.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

it.each(['during download', 'during extraction'] as const)('revokes page-range evidence when permanent deletion starts %s and deletes the workspace', async transition => {
  const { store, note, revision } = await readerStore();
  const purge = () => store.write(`source-lifecycle/${note.source.id}.json`, { sourceId: note.source.id, state: 'purging', revision: 1, changedAt: new Date().toISOString(), changedBy: 'admin' });
  if (transition === 'during download') {
    const read = store.readArtifact.bind(store);
    vi.spyOn(store, 'readArtifact').mockImplementation(async id => { const value = await read(id); await purge(); return value; });
  } else sandbox.exec.mockImplementation(async () => { await purge(); return { exitCode: 0 }; });
  sandbox.read.mockResolvedValue(Buffer.from(JSON.stringify([{ sourceId: note.source.id, hash: note.extraction.artifactHash, pageCount: 1, pages: [{ locator: 'PDF page 1', text: 'Original source text', page: 1 }] }])));
  const corpus: ChatCorpus = { revision, sources: [{ note, humanMarkdown: '' }] };
  const job: ChatJob = { id: 'a'.repeat(32), owner: 'owner', createdAt: new Date().toISOString(), corpusRevision: revision, request: { question: 'Read page 1', history: [], sourceId: note.source.id }, status: 'running', attempts: 1 };
  await expect(gatherEvidence(store as unknown as BlobStore, corpus, job, async () => {}, { sourceId: note.source.id, pages: { start: 1, end: 1 } })).rejects.toMatchObject({ status: 410 });
  expect(sandbox.deleted).toHaveBeenCalledExactlyOnceWith('workspace');
});

it('uses the verified PDF MIME for legacy page-range originals', async () => {
  const { store, note, revision } = await readerStore();
  const legacy = { ...note, extraction: { ...note.extraction, artifactMime: 'application/x-pdf' } };
  sandbox.read.mockResolvedValue(Buffer.from(JSON.stringify([{ sourceId: note.source.id, hash: note.extraction.artifactHash, pageCount: 1, pages: [{ locator: 'PDF page 1', text: 'Original source text', page: 1 }] }])));
  const job: ChatJob = { id: 'a'.repeat(32), owner: 'owner', createdAt: new Date().toISOString(), corpusRevision: revision, request: { question: 'Read page 1', history: [], sourceId: note.source.id }, status: 'running', attempts: 1 };
  const result = await gatherEvidence(store as unknown as BlobStore, { revision, sources: [{ note: legacy, humanMarkdown: '' }] }, job, async () => {}, { sourceId: note.source.id, pages: { start: 1, end: 1 } });
  expect(result.evidence).toMatchObject([{ text: 'Original source text', pdf: true }]);
  expect(result.coverage).toMatchObject({ returnedPages: [1], truncated: false });
  expect(sandbox.deleted).toHaveBeenCalledExactlyOnceWith('workspace');
});
