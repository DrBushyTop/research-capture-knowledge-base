import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: class { async getToken() { return { token: 'synthetic-token' }; } } }));
import { readWorkspaceFile } from '../apps/worker/src/sandbox-lifecycle.js';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function config() {
  for (const [name, value] of Object.entries({ AZURE_SUBSCRIPTION_ID: 'synthetic-subscription', AZURE_RESOURCE_GROUP: 'synthetic-group', SANDBOX_GROUP: 'synthetic-sandboxes', SANDBOX_REGION: 'swedencentral' })) vi.stubEnv(name, value);
}
it('reads JSON files as exact bytes regardless of the server content type', async () => {
  config(); const text = JSON.stringify([{ pages: [{ locator: 'PDF page 2', text: 'Synthetic evidence.' }] }]);
  const fetch = vi.fn().mockResolvedValue(new Response(text, { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
  const bytes = await readWorkspaceFile('synthetic-id', '/workspace/evidence.json', 1000, AbortSignal.timeout(1000));
  expect(bytes.toString('utf8')).toBe(text);
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it('rejects a file exceeding the evidence download limit', async () => {
  config(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Too much evidence.', { headers: { 'content-length': '18' } })));
  await expect(readWorkspaceFile('synthetic-id', '/workspace/evidence.json', 8, AbortSignal.timeout(1000))).rejects.toThrow('too large');
});
