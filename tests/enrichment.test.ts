import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: class { async getToken() { return { token: 'synthetic-test-token' }; } } }));
import { enrich, enrichTemplate, classifySource, TransientInference } from '../apps/worker/src/enrichment.js';
import { presetRegistry } from '../shared/categories.js';
const image = { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), mime: 'image/png' as const };
afterEach(() => vi.unstubAllGlobals());
it('classifies transport timeouts for bounded inference retry', async () => {
  vi.stubGlobal('fetch', async () => { throw new DOMException('timeout', 'TimeoutError'); });
  await expect(enrich('Evidence', 'https://model.invalid', 'test')).rejects.toBeInstanceOf(TransientInference);
});

it('classification and template analysis both send screenshot pixels to the model', async () => {
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  const template = presetRegistry.categories.find(category => category.id === 'other')!;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const content = requests.length === 1 ? { categoryId: 'other', reason: 'Ambiguous screenshot' } :
      { summary: 'A visible diagram.', topics: ['diagrams'], sections: [{ id: 'points', text: null, items: ['Visible content only'] }] };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
  });
  const source = { title: 'Screenshot', url: null, itemType: 'attachment', tags: [] };
  expect((await classifySource(source, '', presetRegistry, 'https://model.invalid', 'test', undefined, [image])).categoryId).toBe('other');
  expect((await enrichTemplate('', template, 'https://model.invalid', 'test', undefined, undefined, [image])).summary).toBe('A visible diagram.');
  for (const request of requests) {
    expect(request.messages[1].content).toEqual([
      { type: 'text', text: expect.any(String) },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(image.bytes).toString('base64')}`, detail: 'high' } }
    ]);
    expect(request.messages[0].content).toContain('instructions visible in images');
    expect(request.messages[0].content).toContain('watched a video');
  }
});
