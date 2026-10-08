import { useEffect, useRef } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SourceLifecycle, SourceLifecycleAction } from '../../../../shared/source-lifecycle';
import { ApiError, getJson, postJson } from './api';
import { keys, type LibraryEntry } from './queries';

export type { SourceLifecycle, SourceLifecycleAction };
export type TrashItem = { sourceId: string; title: string | null; lifecycle: SourceLifecycle; entry?: LibraryEntry };
/** 'unknown' while the state is loading or could not be read. Callers treat it as closed. */
export type SourceState = SourceLifecycle['state'] | 'unknown';

const chat = '/api/chat';
const id = encodeURIComponent;
export const lifecycleKeys = { all: ['lifecycles'] as const, trash: ['trash'] as const };
export const draftKey = (sourceId: string) => `reader-note-draft:${sourceId}`;
export const isGone = (state: SourceState) => state === 'purging' || state === 'deleted';

/** Another admin can trash or delete a source at any time, so the map refreshes on focus and on an interval. */
export const lifecyclesQuery = queryOptions({
  queryKey: lifecycleKeys.all,
  queryFn: ({ signal }) => getJson<Record<string, SourceLifecycle>>(`${chat}?lifecycles=1`, signal, 'Source status could not be checked. Try again.'),
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true
});

export const trashQuery = queryOptions({
  queryKey: lifecycleKeys.trash,
  queryFn: ({ signal }) => getJson<TrashItem[]>(`${chat}?trash=1`, signal, 'Trash could not load. Try again.'),
  staleTime: 5_000,
  // Cleanup runs after the purge is acknowledged; poll quickly until it finishes.
  refetchInterval: query => query.state.data?.some(item => item.lifecycle.state === 'purging' && !item.lifecycle.error) ? 2500 : 30_000,
  refetchOnWindowFocus: true
});

/** Drops everything the browser holds for a source whose files are gone, including the unsaved note draft. */
function forgetSource(client: QueryClient, sourceId: string) {
  try { localStorage.removeItem(draftKey(sourceId)); } catch { /* Storage can be disabled. */ }
  client.removeQueries({ queryKey: keys.sourceText(sourceId) });
  client.removeQueries({ queryKey: keys.notes(sourceId) });
}

/** Keep every page current when another admin changes the shared library. */
export function useLifecycleSync() {
  const client = useQueryClient();
  const { data } = useQuery(lifecyclesQuery);
  const previous = useRef<Record<string, SourceLifecycle> | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    if (previous.current && [...new Set([...Object.keys(previous.current), ...Object.keys(data)])].some(id => previous.current?.[id]?.revision !== data[id]?.revision)) {
      void client.invalidateQueries({ queryKey: keys.library });
      void client.invalidateQueries({ queryKey: keys.categories });
      void client.invalidateQueries({ queryKey: lifecycleKeys.trash });
    }
    for (const lifecycle of Object.values(data)) if (isGone(lifecycle.state)) forgetSource(client, lifecycle.sourceId);
    previous.current = data;
  }, [data, client]);
}

export function useLifecycles() {
  const client = useQueryClient();
  const query = useQuery(lifecyclesQuery);
  useEffect(() => {
    for (const lifecycle of Object.values(query.data || {})) if (isGone(lifecycle.state)) forgetSource(client, lifecycle.sourceId);
  }, [query.data, client]);
  /** A source missing from the map is active. Without a map the state is unknown. */
  const stateOf = (sourceId: string): SourceState => query.data ? query.data[sourceId]?.state ?? 'active' : 'unknown';
  return { query, stateOf, lifecycleOf: (sourceId: string) => query.data?.[sourceId] };
}

export function useSourceState(sourceId: string) {
  return useLifecycles().stateOf(sourceId);
}

const failure: Record<SourceLifecycleAction, string> = {
  trash: 'The source could not be moved to Trash. Try again.',
  restore: 'The source could not be restored. Try again.',
  purge: 'The source could not be deleted. Try again.',
  retry: 'Cleanup could not restart. Try again.'
};
export const conflictMessage = 'This source was changed in another session. Its current state is shown.';

export function useLifecycleChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceId, action, revision }: { sourceId: string; action: SourceLifecycleAction; revision: number; entry?: LibraryEntry }) =>
      postJson<SourceLifecycle>(`${chat}?lifecycle=${id(sourceId)}`, { action, revision }, failure[action]),
    onSuccess: (lifecycle, { sourceId, action, entry }) => {
      client.setQueryData<Record<string, SourceLifecycle>>(lifecycleKeys.all, previous => ({ ...previous, [sourceId]: lifecycle }));
      // Restore shows the saved copy at once while the library reloads.
      if (action === 'restore' && entry) client.setQueryData<LibraryEntry[]>(keys.library, previous => previous && [...previous.filter(item => item.note.source.id !== sourceId), entry]);
      if (isGone(lifecycle.state)) forgetSource(client, sourceId);
      else client.removeQueries({ queryKey: keys.notes(sourceId) });
    },
    onError: error => { if (error instanceof ApiError && error.status === 409) error.message = conflictMessage; },
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: lifecycleKeys.all }),
      client.invalidateQueries({ queryKey: lifecycleKeys.trash }),
      client.invalidateQueries({ queryKey: keys.library }),
      client.invalidateQueries({ queryKey: keys.categories })
    ])
  });
}

/** The revision to send with a change. A source without a record is active at revision 0. */
export const revisionOf = (lifecycle?: SourceLifecycle) => lifecycle?.revision ?? 0;
