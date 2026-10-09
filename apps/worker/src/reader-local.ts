import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleReaderRequest, readerErrorResponse, type ReaderStore } from './reader-actions.js';
import { SourceLifecycleService } from './source-lifecycle.js';

/** Localhost supplies a development identity. This adapter must never authenticate production requests. */
export function localReaderHandler(store: ReaderStore) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/api/categories') url.searchParams.set('admin', '1');
    let result;
    try {
      result = await handleReaderRequest(store, 'local-developer', {
        method: request.method || 'GET', query: url.searchParams,
        headers: { get: name => { const value = request.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(',') : value ?? null; } },
        body: request.iterator({ destroyOnReturn: false })
      }, async id => { void new SourceLifecycleService(store).cleanup(id).catch(() => undefined); });
    } catch (error) {
      result = readerErrorResponse(error);
      if (result.status === 503) console.error(JSON.stringify({ event: 'local-reader-error', name: error instanceof Error ? error.name : 'Error',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500) }));
    }
    response.writeHead(result.status, { ...result.headers, ...(!result.body ? { 'Content-Type': 'application/json' } : {}) });
    response.end(result.body ?? JSON.stringify(result.jsonBody));
    // Drain a rejected body without destroying the socket before its error response is sent.
    request.resume();
  };
}
