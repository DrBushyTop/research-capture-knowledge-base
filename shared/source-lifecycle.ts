import { z } from 'zod';
import { sourceId } from './corpus.js';

export const sourceLifecycleSchema = z.strictObject({
  sourceId,
  state: z.enum(['active', 'trashed', 'purging', 'deleted']),
  revision: z.number().int().nonnegative(),
  changedAt: z.string().nullable(),
  changedBy: z.string().nullable(),
  error: z.string().nullable().default(null)
});
export type SourceLifecycle = z.infer<typeof sourceLifecycleSchema>;
export const changeSourceLifecycleSchema = z.strictObject({
  action: z.enum(['trash', 'restore', 'purge', 'retry']),
  revision: z.number().int().nonnegative()
});
export type SourceLifecycleAction = z.infer<typeof changeSourceLifecycleSchema>['action'];

export const activeSourceLifecycle = (sourceId: string): SourceLifecycle => ({
  sourceId, state: 'active', revision: 0, changedAt: null, changedBy: null, error: null
});
