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
  const requests: { messages: { role: string; content: any }[] }[] = [];
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
    expect(request.messages[0].content[0].text).toContain('instructions visible in images');
    expect(request.messages[0].content[0].text).toContain('watched a video');
  }
});
it('keeps browser planning append-only and cache key stable across changing observations', async () => {
  const { infer } = await import('../apps/worker/src/enrichment.js');
  const { z } = await import('zod');
  const requests: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ usage: { prompt_tokens: 1500, prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 500 }, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: '{"value":"done"}' } }] }));
  });
  const session = { key: 'capture-scope', messages: [] as { role: string; content: unknown }[] };
  const schema = z.object({ value: z.string() });
  await infer({ view: 'first' }, 'Stable instructions', schema, 'https://model.invalid', 'test', undefined, undefined, session);
  await infer({ view: 'second' }, 'Stable instructions', schema, 'https://model.invalid', 'test', undefined, undefined, session);
  expect(requests[1].messages.slice(0, 2)).toEqual(requests[0].messages);
  expect(requests[1].messages[2]).toEqual({ role: 'assistant', content: '{"value":"done"}' });
  expect(requests[1].messages[3].content).toBe('{"view":"second"}');
  expect(requests[1].prompt_cache_key).toBe(requests[0].prompt_cache_key);
  expect(requests[0].messages[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
});
it('does not append failed inference to browser session history', async () => {
  const { infer } = await import('../apps/worker/src/enrichment.js');
  const { z } = await import('zod');
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
  const session = { key: 'scope', messages: [{ role: 'system', content: 'Stable' }] };
  await expect(infer({ view: 'failed' }, 'Stable', z.object({ value: z.string() }), 'https://model.invalid', 'test', undefined, undefined, session)).rejects.toThrow();
  expect(session.messages).toEqual([{ role: 'system', content: 'Stable' }]);
});
