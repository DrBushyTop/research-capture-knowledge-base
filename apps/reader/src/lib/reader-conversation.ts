import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatActivity, ChatImage, ChatJob } from '../../../../shared/chat';
import { ApiError, postJson } from './api';
import { conversationQuery, conversationsQuery, jobQuery, keys, terminalJob, type Conversation, type HistoryItem, type SourceContext } from './queries';

export type ConversationTurn = {
  jobId: string;
  question: string;
  images?: ChatImage[];
  result?: NonNullable<ChatJob['result']>;
  failure?: string;
  activities?: ChatActivity[];
  workedMs?: number;
  draft?: string;
};
type Active = { id: string; conversationId: string; question: string; images?: ChatImage[] };
type LocalTurn = ConversationTurn & { conversationId: string };
type Submission = { question: string; images?: string[]; conversationId?: string; sourceId?: string };

/** Routing is the standalone adapter. Source panels keep their selection inside this module. */
export type ConversationLocation =
  | { kind: 'standalone'; conversationId?: string; open: (id?: string, replace?: boolean) => void; source?: SourceContext }
  | { kind: 'source'; source?: SourceContext };

/** Query policies stay shared with the reader. Tests substitute the remote transport at this seam. */
export type ConversationAdapter = {
  conversation: typeof conversationQuery;
  history: typeof conversationsQuery;
  job: typeof jobQuery;
  submit: (body: Submission) => Promise<{ id: string; conversationId: string }>;
  cancel: (id: string) => Promise<unknown>;
  delete: (id: string) => Promise<unknown>;
};
const endpoint = '/api/chat';
const fallback = 'Chat is unavailable. Try again.';
const browserAdapter: ConversationAdapter = {
  conversation: conversationQuery,
  history: conversationsQuery,
  job: jobQuery,
  submit: body => postJson(endpoint, body, fallback),
  cancel: id => postJson(endpoint, { action: 'cancel', id }, fallback),
  delete: conversationId => postJson(endpoint, { action: 'delete', conversationId }, fallback)
};
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ConversationStorage = { local?: BrowserStorage; session?: BrowserStorage };
function browserStorage(): ConversationStorage {
  const storage: ConversationStorage = {};
  try { storage.local = window.localStorage; } catch { /* Storage can be disabled. */ }
  try { storage.session = window.sessionStorage; } catch { /* Storage can be disabled. */ }
  return storage;
}
const idPattern = /^[a-f0-9]{32}$/;
const read = (storage: BrowserStorage | undefined, key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
const write = (storage: BrowserStorage | undefined, key: string, value?: string) => {
  try { if (value === undefined) storage?.removeItem(key); else storage?.setItem(key, value); } catch { /* The conversation still works in memory. */ }
};
function readActive(storage: BrowserStorage | undefined, key: string): Active | undefined {
  try {
    const value = JSON.parse(read(storage, key) || 'null');
    if (value && typeof value.id === 'string' && value.id && typeof value.conversationId === 'string' && idPattern.test(value.conversationId) && typeof value.question === 'string' &&
      (value.images === undefined || Array.isArray(value.images) && value.images.every((image: ChatImage | null) => image && typeof image.id === 'string' && typeof image.mime === 'string' && typeof image.width === 'number' && typeof image.height === 'number'))) return value;
  } catch { /* Ignore malformed recovery records. */ }
  return undefined;
}

type State = {
  scope: string;
  panelId?: string;
  local: LocalTurn[];
  active?: Active;
  stopping?: string;
  question: string;
  error: string;
  announcement: string;
};

/** Owns selection, recovery, unfinished turns, polling and mutations for both reader contexts.
 * Local storage contains only a recent ID. The unfinished question stays in session storage.
 * Saved answers come from the server conversation. Streamed drafts stay in memory. */
export function useReaderConversation(location: ConversationLocation, dependencies: { adapter?: ConversationAdapter; storage?: ConversationStorage } = {}) {
  const client = useQueryClient();
  const adapter = dependencies.adapter ?? browserAdapter;
  const storage = useRef(dependencies.storage ?? browserStorage()).current;
  const source = location.source;
  const embedded = location.kind === 'source';
  const scope = `${embedded ? 'source' : 'standalone'}:${source?.sourceId ?? ''}`;
  const recentKey = source ? `research-chat-source:${source.sourceId}` : 'research-chat';
  const activeKey = source ? `research-chat-active:${source.sourceId}` : 'research-chat-active';
  const initialState = (): State => ({ scope, panelId: embedded ? readActive(storage.session, activeKey)?.conversationId || read(storage.local, recentKey) || undefined : undefined,
    local: [], question: '', error: '', announcement: '' });
  let [state, setState] = useState(initialState);
  // A reused source panel must not carry the previous source's draft, error or running answer.
  if (state.scope !== scope) { state = initialState(); setState(state); }
  const conversationId = embedded ? state.panelId : location.conversationId;
  const validId = !conversationId || idPattern.test(conversationId);
  const selectionKey = `${scope}:${conversationId ?? ''}`;
  const selection = useRef({ key: selectionKey });
  if (selection.current.key !== selectionKey) selection.current = { key: selectionKey };
  const submitting = useRef<{ token: typeof selection.current; jobId?: string } | undefined>(undefined);
  const cancelling = useRef<string | undefined>(undefined);
  const deleting = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (token: typeof selection.current) => mounted.current && selection.current === token;
  const update = (change: Partial<State>) => setState(previous => previous.scope === scope ? { ...previous, ...change } : previous);
  const reportError = (error: string) => update({ error });
  const remember = (id: string) => write(storage.local, recentKey, id);
  const forget = () => write(storage.local, recentKey);
  const forgetActive = (id: string) => { if (readActive(storage.session, activeKey)?.id === id) write(storage.session, activeKey); };
  const patch = (jobId: string, change: Partial<ConversationTurn>) => setState(previous => previous.scope === scope ? { ...previous,
    local: previous.local.map(turn => turn.jobId === jobId ? { ...turn, ...change } : turn) } : previous);
  const finish = (id: string) => {
    forgetActive(id);
    if (submitting.current?.jobId === id) submitting.current = undefined;
    if (cancelling.current === id) cancelling.current = undefined;
    setState(previous => previous.scope === scope ? { ...previous, active: previous.active?.id === id ? undefined : previous.active,
      stopping: previous.stopping === id ? undefined : previous.stopping } : previous);
    client.removeQueries({ queryKey: keys.job(id) });
  };

  const detail = useQuery({ ...adapter.conversation(conversationId || ''), enabled: !!conversationId && validId });
  const history = useQuery({ ...adapter.history, enabled: !embedded });
  const saved = detail.data?.turns ?? [];
  const savedIds = new Set(saved.map(turn => turn.jobId));
  const active = state.active?.conversationId === conversationId ? state.active : undefined;
  const job = useQuery({ ...adapter.job(active?.id || ''), enabled: !!active && !savedIds.has(active.id) });
  const loading = !!conversationId && validId && detail.isPending;
  const unavailable = conversationId && (!validId || detail.error && !detail.data)
    ? validId ? detail.error?.message || 'This conversation could not be opened.' : 'This chat address is not valid.' : undefined;
  const context = conversationId ? detail.data?.sourceContext ?? (detail.data ? undefined : source) : source;
  const turns: ConversationTurn[] = [...saved, ...state.local.filter(turn => turn.conversationId === conversationId && !savedIds.has(turn.jobId))];

  const restored = useRef(false);
  useEffect(() => {
    if (embedded || restored.current) return;
    restored.current = true;
    if (location.conversationId) return;
    const id = readActive(storage.session, activeKey)?.conversationId || read(storage.local, recentKey);
    if (id && idPattern.test(id)) location.open(id, true);
  }, [scope, conversationId]);
  useEffect(() => {
    if (!conversationId) return;
    if (detail.data) remember(conversationId);
    else if (detail.error || !validId) { if (read(storage.local, recentKey) === conversationId) forget(); }
  }, [scope, conversationId, detail.data, detail.error]);
  useEffect(() => {
    const pending = readActive(storage.session, activeKey);
    if (pending && pending.conversationId === conversationId) {
      setState(previous => previous.scope === scope ? { ...previous, active: pending,
        local: previous.local.some(turn => turn.jobId === pending.id) ? previous.local : [...previous.local, { conversationId: pending.conversationId, jobId: pending.id, question: pending.question, images: pending.images }] } : previous);
    } else if (state.active && state.active.conversationId !== conversationId) update({ active: undefined });
    update({ error: '', announcement: '' });
  }, [scope, conversationId]);

  useEffect(() => {
    if (!active) return;
    if (savedIds.has(active.id)) { finish(active.id); update({ announcement: 'Answer ready' }); return; }
    // A failed refetch retains previous data. Handle its error before considering that cached draft.
    if (job.error) {
      reportError(job.error.message);
      if (job.error instanceof ApiError && [400, 401, 403, 404, 410].includes(job.error.status)) {
        patch(active.id, { failure: job.error.message }); finish(active.id); update({ announcement: 'Answer unavailable' });
      }
      return;
    }
    const value = job.data;
    if (!value) return;
    patch(active.id, { result: value.result, activities: value.activities, draft: value.draft,
      failure: value.status === 'failed' ? value.error || 'No answer returned. Try again.' : value.status === 'cancelled' ? 'Stopped' : undefined });
    if (terminalJob(value.status)) {
      finish(active.id);
      update({ announcement: value.status === 'complete' ? 'Answer ready' : value.status === 'cancelled' ? 'Stopped' : 'Answer failed',
        error: value.status === 'failed' ? value.error || 'No answer returned. Try again.' : '' });
      void client.invalidateQueries({ queryKey: keys.conversation(active.conversationId) });
      void client.invalidateQueries({ queryKey: keys.conversations });
    } else reportError('');
  }, [scope, conversationId, active?.id, detail.data, job.data, job.error, job.errorUpdatedAt]);

  const ask = useMutation({ mutationFn: adapter.submit });
  const stop = useMutation({ mutationFn: adapter.cancel });
  const remove = useMutation({ mutationFn: adapter.delete });
  const busy = !!active || ask.isPending || loading;
  const send = async (question: string, images: ChatImage[], preserveDraft: boolean) => {
    const submitted = question.trim();
    if (busy || submitting.current?.token === selection.current || unavailable || (!submitted && !images.length)) return false;
    const token = selection.current;
    const submission = { token, jobId: undefined as string | undefined };
    submitting.current = submission;
    reportError('');
    try {
      const created = await ask.mutateAsync({ question: submitted, ...(images.length ? { images: images.map(image => image.id) } : {}),
        ...(conversationId ? { conversationId } : source ? { sourceId: source.sourceId } : {}) });
      const next = { ...created, question: submitted, images };
      // An accepted job keeps running after navigation. Keep its original recovery keys even if the view moved.
      // postJson has already rejected responses from an expired authentication session.
      write(storage.session, activeKey, JSON.stringify(next));
      remember(created.conversationId);
      if (!mounted.current || selection.current.key !== token.key) return false;
      submission.jobId = created.id;
      setState(previous => ({ ...previous, active: next, announcement: 'Answering',
        question: !preserveDraft && previous.question === question ? '' : previous.question,
        local: [...previous.local, { conversationId: created.conversationId, jobId: created.id, question: submitted, images }] }));
      if (!conversationId) {
        client.setQueryData<Conversation>(keys.conversation(created.conversationId), previous => previous ?? { id: created.conversationId, owner: '', createdAt: '', updatedAt: '', turns: [], ...(source ? { sourceContext: source } : {}) });
        if (embedded) update({ panelId: created.conversationId });
        else location.open(created.conversationId);
      }
      return true;
    } catch (failure) {
      if (current(token)) reportError((failure as Error).message);
      return false;
    } finally { if (!submission.jobId && submitting.current === submission) submitting.current = undefined; }
  };
  const cancel = async () => {
    if (!active || cancelling.current === active.id || state.stopping === active.id) return;
    const token = selection.current;
    cancelling.current = active.id;
    update({ stopping: active.id });
    try { await stop.mutateAsync(active.id); } catch (failure) {
      if (cancelling.current === active.id) {
        cancelling.current = undefined;
        setState(previous => previous.scope === scope && previous.stopping === active.id ? { ...previous, stopping: undefined,
          ...(current(token) ? { error: (failure as Error).message } : {}) } : previous);
      }
    }
    // Keep Stop disabled until polling confirms a terminal state.
  };
  const newConversation = () => {
    if (busy && !unavailable) return false;
    update({ question: '', error: '', announcement: '', panelId: undefined }); forget();
    if (!embedded) location.open();
    return true;
  };
  const deleteConversation = async (id: string) => {
    if (deleting.current) return;
    deleting.current = id;
    const token = selection.current;
    reportError('');
    try {
      await remove.mutateAsync(id);
      if (!mounted.current) return;
      client.setQueryData<HistoryItem[]>(keys.conversations, previous => previous?.filter(item => item.id !== id));
      client.removeQueries({ queryKey: keys.conversation(id) });
      const pending = readActive(storage.session, activeKey);
      if (pending?.conversationId === id) finish(pending.id);
      setState(previous => previous.scope === scope ? { ...previous, local: previous.local.filter(turn => turn.conversationId !== id) } : previous);
      if (read(storage.local, recentKey) === id) forget();
      if (current(token)) {
        if (id === conversationId) {
          if (embedded) update({ panelId: undefined }); else location.open(undefined, true);
        }
        update({ announcement: 'Chat deleted' });
      }
    } catch (failure) { if (current(token)) reportError((failure as Error).message); }
    finally { if (deleting.current === id) deleting.current = undefined; }
  };

  return {
    conversationId, context, turns, loading, unavailable, busy,
    activeJobId: active?.id, stopping: !!active && state.stopping === active.id,
    question: state.question, setQuestion: (question: string) => update({ question }),
    error: state.error, announcement: state.announcement, reportError,
    history: { items: history.data ?? [], loading: history.isPending, error: history.error?.message, refresh: () => history.refetch() },
    deleting: remove.isPending ? remove.variables : undefined,
    submit: (images: ChatImage[] = [], suggestion?: string) => send(suggestion ?? state.question, suggestion ? [] : images, suggestion !== undefined),
    retry: (turn: ConversationTurn) => send(turn.question, turn.images ?? [], true),
    cancel, newConversation, deleteConversation
  };
}
