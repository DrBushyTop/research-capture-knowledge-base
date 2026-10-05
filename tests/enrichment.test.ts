import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: class { async getToken() { return { token: 'synthetic-test-token' }; } } }));
import { enrich, TransientInference } from '../apps/worker/src/enrichment.js';
afterEach(() => vi.unstubAllGlobals());
it('classifies transport timeouts for bounded inference retry', async () => {
  vi.stubGlobal('fetch', async () => { throw new DOMException('timeout', 'TimeoutError'); });
  await expect(enrich('Evidence', 'https://model.invalid', 'test')).rejects.toBeInstanceOf(TransientInference);
});
