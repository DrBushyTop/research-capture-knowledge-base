import { expect, it } from 'vitest';
import { promptCacheKey, stableJson, usageSummary } from '../apps/worker/src/model-cache.js';
it('canonicalizes object keys without reordering message arrays', () => {
 expect(stableJson({ b: 2, a: ['first', 'second'] })).toBe(stableJson({ a: ['first', 'second'], b: 2 }));
 expect(stableJson(['first', 'second'])).not.toBe(stableJson(['second', 'first']));
});
it('partitions reusable prefixes with opaque stable routing keys', () => {
 expect(promptCacheKey('chat', { a: 1, b: 2 }, 'owner')).toBe(promptCacheKey('chat', { b: 2, a: 1 }, 'owner'));
 expect(promptCacheKey('chat', 'instructions', 'owner')).not.toBe(promptCacheKey('chat', 'changed', 'owner'));
 expect(promptCacheKey('chat', 'instructions', 'private-owner')).not.toContain('private-owner');
});
it('preserves cache read/write and reasoning usage without inventing missing zeroes', () => {
 expect(usageSummary({ input_tokens: 2000, input_tokens_details: { cached_tokens: 1500, cache_write_tokens: 500 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 60 } })).toEqual({ inputTokens: 2000, cachedInputTokens: 1500, cacheWriteTokens: 500, outputTokens: 80, reasoningTokens: 60 });
 expect(usageSummary(undefined).cachedInputTokens).toBeUndefined();
});
