import { app } from '@azure/functions';
app.http('chat', { route: 'chat', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: async request => {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  const error = (status, message) => ({ status, jsonBody: { error: message }, headers });
  let principal;
  const encoded = request.headers.get('x-ms-client-principal');
  try { principal = JSON.parse(Buffer.from(encoded || '', 'base64').toString('utf8')); } catch { return error(403, 'Reader access required'); }
  if (!principal.userId || !Array.isArray(principal.userRoles) || !principal.userRoles.includes('reader')) return error(403, 'Reader access required');
  if (request.method === 'POST' && request.headers.get('origin') !== process.env.READER_ORIGIN) return error(403, 'Open chat from your private reader');
  if (!process.env.CHAT_BACKEND_URL || !process.env.CHAT_BACKEND_KEY) return error(503, 'Chat is not configured yet');
  const url = new URL(process.env.CHAT_BACKEND_URL);
  if (request.method === 'GET') {
    const id = request.query.get('id') || '';
    if (!/^[a-f0-9]{32}$/.test(id)) return error(404, 'Question not found');
    url.searchParams.set('id', id);
  }
  let body;
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length')) > 16_384) return error(413, 'Question is too large');
    body = await request.text(); if (Buffer.byteLength(body) > 16_384) return error(413, 'Question is too large');
  }
  try {
    const response = await fetch(url, { method: request.method, redirect: 'error', body, signal: AbortSignal.timeout(30_000),
      headers: { 'x-functions-key': process.env.CHAT_BACKEND_KEY, 'x-ms-client-principal': encoded, 'Content-Type': 'application/json' } });
    if (!response.headers.get('content-type')?.includes('application/json')) return error(503, 'Chat is temporarily unavailable');
    return { status: response.status, body: await response.text(), headers };
  } catch { return error(503, 'Chat is temporarily unavailable. Try again.'); }
} });
