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
    if (request.query.has('conversations')) url.searchParams.set('conversations', 'true');
    else if (request.query.has('conversation')) {
      const id = request.query.get('conversation') || '';
      if (!/^[a-f0-9]{32}$/.test(id)) return error(404, 'Conversation not found');
      url.searchParams.set('conversation', id);
    } else {
      const id = request.query.get('id') || '';
      if (!/^[a-f0-9]{32}$/.test(id)) return error(404, 'Message not found');
      url.searchParams.set('id', id);
      for (const field of ['asset', 'file', 'evidence']) if (request.query.has(field)) url.searchParams.set(field, request.query.get(field));
    }
  }
  let body;
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length')) > 40_000) return error(413, 'Message is too large');
    body = await request.text(); if (Buffer.byteLength(body) > 40_000) return error(413, 'Message is too large');
  }
  try {
    const response = await fetch(url, { method: request.method, redirect: 'error', body, signal: AbortSignal.timeout(30_000),
      headers: { 'x-functions-key': process.env.CHAT_BACKEND_KEY, 'x-ms-client-principal': encoded, 'Content-Type': 'application/json' } });
    const mime = response.headers.get('content-type') || '';
    if (['application/pdf', 'image/png'].includes(mime) && request.method === 'GET') {
      if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) return error(503, 'File is too large');
      const parts = []; let bytes = 0;
      for await (const part of response.body) { bytes += part.length; if (bytes > 20 * 1024 * 1024) throw new Error('File too large'); parts.push(part); }
      return { status: response.status, body: Buffer.concat(parts), headers: { ...headers, 'Content-Type': mime, 'Content-Disposition': response.headers.get('content-disposition') || 'inline', 'X-Content-Type-Options': 'nosniff' } };
    }
    if (!mime.includes('application/json')) return error(503, 'Chat is temporarily unavailable');
    return { status: response.status, body: await response.text(), headers };
  } catch { return error(503, 'Chat is temporarily unavailable. Try again.'); }
} });
