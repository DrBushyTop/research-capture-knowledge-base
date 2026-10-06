import { createHash } from 'node:crypto';

/** Sort object keys, never arrays: message and tool order remain meaningful. */
export function stableJson(value: unknown): string {
  const sort = (input: unknown): unknown => Array.isArray(input) ? input.map(sort) : input && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : input;
  return JSON.stringify(sort(value));
}
export function promptCacheKey(kind: string, prefix: unknown, scope = '') {
  // No user text, URLs or account IDs in the provider routing key or telemetry.
  return `research:${kind}:${createHash('sha256').update(stableJson([prefix, scope])).digest('hex').slice(0, 40)}`;
}
export const cachePolicy = { mode: 'implicit', ttl: '30m' } as const;
export const cacheBreakpoint = { mode: 'explicit' } as const;
export interface ModelUsage {
  input_tokens?: number; output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens?: number; completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}
export function usageSummary(usage: ModelUsage | undefined) {
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  return {
    inputTokens: count(usage?.input_tokens ?? usage?.prompt_tokens),
    cachedInputTokens: count(usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: count(usage?.input_tokens_details?.cache_write_tokens ?? usage?.prompt_tokens_details?.cache_write_tokens),
    outputTokens: count(usage?.output_tokens ?? usage?.completion_tokens),
    reasoningTokens: count(usage?.output_tokens_details?.reasoning_tokens ?? usage?.completion_tokens_details?.reasoning_tokens)
  };
}
export function recordModelUsage(operation: string, usage: ModelUsage | undefined) {
  // Unknown usage is omitted, not counted as a zero-cost request.
  console.log(JSON.stringify({ event: 'model-usage', operation, ...usageSummary(usage) }));
}
