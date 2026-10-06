import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query';

/** status 401 means the browser has no usable private session; the API answered with the login page or refused access. */
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const signInMessage = 'Sign in with an invited account to continue.';
let session = 0;

async function read<T>(response: Response, started: number, fallback: string): Promise<T> {
  if (response.status === 401 || !response.headers.get('content-type')?.includes('application/json')) throw new ApiError(signInMessage, 401);
  const value = await response.json();
  // A request that outlived sign-out must not hand its private result to the cache.
  if (started !== session) throw new ApiError(signInMessage, 401);
  // The API proxy answers 403 for a refused identity, and also for a cross-origin write, which is not an access problem.
  if (response.status === 403 && value?.error === 'Reader access required') throw new ApiError(signInMessage, 401);
  if (!response.ok) throw new ApiError(value?.error || fallback, response.status);
  return value as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal, fallback = 'The request failed. Try again.'): Promise<T> {
  const started = session;
  return read<T>(await fetch(url, { credentials: 'same-origin', signal }), started, fallback);
}

export async function postJson<T>(url: string, body: unknown, fallback = 'The request failed. Try again.'): Promise<T> {
  const started = session;
  return read<T>(await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), started, fallback);
}

export async function postBlob<T>(url: string, body: Blob, fallback = 'The upload failed. Try again.'): Promise<T> {
  const started = session;
  return read<T>(await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': body.type }, body }), started, fallback);
}

export const isAuthError = (error: unknown) => error instanceof ApiError && error.status === 401;

/** Cancels every request and forgets all private data held in memory. Nothing is persisted elsewhere. */
export function forgetPrivateData(client: QueryClient, lost = true) {
  session++;
  void client.cancelQueries();
  client.clear();
  if (lost && !accessLost) { accessLost = true; listeners.forEach(listener => listener()); }
}

let accessLost = false;
const listeners = new Set<() => void>();
/** For useSyncExternalStore: true once the API refused this session. Screens unmount until the user signs in again. */
export const accessStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  get: () => accessLost
};

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: error => { if (isAuthError(error)) forgetPrivateData(client); } }),
    mutationCache: new MutationCache({ onError: error => { if (isAuthError(error)) forgetPrivateData(client); } }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // Server and network failures get two more tries; authorization and validation answers are final.
        retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status < 500),
        retryDelay: count => 1000 * 2 ** count
      },
      // A retried POST could start a second conversation, job or batch.
      mutations: { retry: false }
    }
  });
  return client;
}
