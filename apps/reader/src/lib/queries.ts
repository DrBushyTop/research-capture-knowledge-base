import { queryOptions } from '@tanstack/react-query';
import type { Note } from '../../../../shared/corpus';
import type { ReaderNote } from '../../../../shared/reader-notes';
import type { Registry, TemplateAnalysis } from '../../../../shared/categories';
import type { ChatActivity, ChatConversation, ChatJob } from '../../../../shared/chat';
import { getJson } from './api';

export type LibraryEntry = { note: Note; humanHtml: string; searchText: string };
export type SourceContext = { sourceId: string; title: string };
export type HistoryItem = { id: string; title: string; updatedAt: string; sourceContext?: SourceContext };
export type Conversation = ChatConversation & { sourceContext?: SourceContext };
export type JobStatus = { status: ChatJob['status']; result?: NonNullable<ChatJob['result']>; activities?: ChatActivity[]; draft?: string; error?: string };
export type CategorySource = { id: string; title: string; category: { id: string; name: string; templateRevision: number; assignment?: string } | null; assignment?: { categoryId: string; method: string }; needsUpdate: boolean; status: string };
export type Batch = { id: string; createdAt: string; cancelled: boolean; entries: { sourceId: string; status: string; error?: string }[] };
export type Overview = { registry: Registry; sources: CategorySource[]; batches: Batch[] };
export type Preview = { status: 'pending' | 'complete' | 'failed'; result?: TemplateAnalysis; error?: string };

const chat = '/api/chat';
const id = encodeURIComponent;
export const terminalJob = (status?: string) => status === 'complete' || status === 'failed' || status === 'cancelled';
export const activeBatchStates = ['pending', 'processing', 'updating-reader'];

export const keys = {
  library: ['library'] as const,
  sourceText: (sourceId: string) => ['source-text', sourceId] as const,
  notes: (sourceId: string) => ['notes', sourceId] as const,
  categories: ['categories'] as const,
  preview: (previewId: string) => ['category-preview', previewId] as const,
  conversations: ['conversations'] as const,
  conversation: (conversationId: string) => ['conversation', conversationId] as const,
  job: (jobId: string) => ['chat-job', jobId] as const
};

export const libraryQuery = queryOptions({
  queryKey: keys.library,
  queryFn: ({ signal }) => getJson<LibraryEntry[]>(`${chat}?library=1`, signal, 'Sources could not load. Try again.')
});

export const sourceTextQuery = (sourceId: string) => queryOptions({
  queryKey: keys.sourceText(sourceId),
  queryFn: ({ signal }) => getJson<{ text?: string }>(`${chat}?source=${id(sourceId)}`, signal, 'Original text could not be loaded.'),
  staleTime: Infinity
});

export const notesQuery = (sourceId: string) => queryOptions({
  queryKey: keys.notes(sourceId),
  queryFn: ({ signal }) => getJson<ReaderNote>(`${chat}?notes=${id(sourceId)}`, signal, 'Notes could not load. Try again.')
});

export const categoriesQuery = queryOptions({
  queryKey: keys.categories,
  queryFn: ({ signal }) => getJson<Overview>('/api/categories', signal),
  // Batch progress refreshes only while a batch has queued or running documents.
  refetchInterval: query => query.state.data?.batches.some(batch => batch.entries.some(entry => activeBatchStates.includes(entry.status))) ? 8000 : false
});

export const previewQuery = (previewId: string) => queryOptions({
  queryKey: keys.preview(previewId),
  queryFn: ({ signal }) => getJson<Preview>(`/api/categories?preview=${id(previewId)}`, signal, 'The preview failed. Try again.'),
  // A preview result is final; poll only while it is pending. 503 means the worker is busy and the next poll tries again.
  refetchInterval: query => query.state.data?.status === 'pending' || (query.state.error as { status?: number } | null)?.status === 503 ? 2500 : false,
  retry: (count, error) => count < 3 && (error as { status?: number }).status === 503,
  staleTime: Infinity,
  gcTime: 60_000
});

export const conversationsQuery = queryOptions({
  queryKey: keys.conversations,
  queryFn: ({ signal }) => getJson<HistoryItem[]>(`${chat}?conversations=1`, signal, 'Chat history could not load.')
});

export const conversationQuery = (conversationId: string) => queryOptions({
  queryKey: keys.conversation(conversationId),
  queryFn: ({ signal }) => getJson<Conversation>(`${chat}?conversation=${id(conversationId)}`, signal, 'This conversation could not be opened.')
});

const finalJobError = (error: unknown) => [400, 401, 403, 404, 410].includes((error as { status?: number } | null)?.status ?? 0);
export const jobQuery = (jobId: string) => queryOptions({
  queryKey: keys.job(jobId),
  queryFn: ({ signal }) => getJson<JobStatus>(`${chat}?id=${id(jobId)}`, signal, 'Chat is unavailable. Try again.'),
  // Poll every second while the answer runs so new steps and finished paragraphs appear promptly; back off to 5 s after a temporary failure.
  refetchInterval: query => terminalJob(query.state.data?.status) || finalJobError(query.state.error) ? false : query.state.error ? 5000 : 1000,
  refetchIntervalInBackground: true,
  retry: false,
  staleTime: 0,
  gcTime: 60_000
});
