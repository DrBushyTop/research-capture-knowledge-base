import { app } from '@azure/functions';
const handler = admin => async request => {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  const error = (status, message) => ({ status, jsonBody: { error: message }, headers });
  let principal;
  const encoded = request.headers.get('x-ms-client-principal');
  try { principal = JSON.parse(Buffer.from(encoded || '', 'base64').toString('utf8')); } catch { return error(403, 'Reader access required'); }
  const allowed = (process.env.READER_GITHUB_USERS || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean);
  if (principal?.identityProvider !== 'github' || !principal.userId || typeof principal.userDetails !== 'string' || !allowed.includes(principal.userDetails.toLowerCase())
    || !Array.isArray(principal.userRoles) || !principal.userRoles.includes('reader')) return error(403, 'Reader access required');
  if (request.method === 'POST' && request.headers.get('origin') !== process.env.READER_ORIGIN) return error(403, 'Open the app to make changes');
  if (!process.env.CHAT_BACKEND_URL || !process.env.CHAT_BACKEND_KEY) return error(503, 'The service is temporarily unavailable');
  const url = new URL(process.env.CHAT_BACKEND_URL);
  if (admin) url.searchParams.set('admin', '1');
  const uploading = !admin && request.method === 'POST' && request.query.has('upload');
  const notes = !admin && request.query.has('notes');
  if (notes) {
    const id = request.query.get('notes') || '';
    if (!/^zotero-(users|groups)-[0-9]+-[A-Z0-9]{8}$/.test(id)) return error(404, 'Source not found');
    url.searchParams.set('notes', id);
  }
  if (uploading) url.searchParams.set('upload', '1');
  if (admin && request.query.has('preview')) url.searchParams.set('preview', request.query.get('preview'));
  if (!admin && !notes && request.method === 'GET') {
    if (request.query.has('library')) url.searchParams.set('library', '1');
    else if (request.query.has('source') || request.query.has('document')) {
      const field = request.query.has('source') ? 'source' : 'document';
      const id = request.query.get(field) || '';
      if (!/^zotero-(users|groups)-[0-9]+-[A-Z0-9]{8}$/.test(id)) return error(404, 'Document not found');
      url.searchParams.set(field, id);
    } else if (request.query.has('upload')) {
      const id = request.query.get('upload') || '';
      if (!/^u_[a-f0-9]{32}$/.test(id)) return error(404, 'Image not found');
      url.searchParams.set('upload', id);
    } else if (request.query.has('conversations')) url.searchParams.set('conversations', 'true');
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
  // Screenshot uploads are raw image bytes. The backend checks format, dimensions and ownership.
  if (uploading) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(request.headers.get('content-type') || '')) return error(415, 'Attach a PNG, JPEG or WebP image');
    if (Number(request.headers.get('content-length')) > 5 * 1024 * 1024) return error(413, 'Images must be 5 MB or smaller');
    body = Buffer.from(await request.arrayBuffer()); if (body.length > 5 * 1024 * 1024) return error(413, 'Images must be 5 MB or smaller');
  } else if (request.method === 'POST') {
    const limit = notes ? 100_000 : 40_000;
    if (Number(request.headers.get('content-length')) > limit) return error(413, 'Message is too large');
    body = await request.text(); if (Buffer.byteLength(body) > limit) return error(413, 'Message is too large');
  }
  try {
    const response = await fetch(url, { method: request.method, redirect: 'error', body, signal: AbortSignal.timeout(30_000),
      headers: { 'x-functions-key': process.env.CHAT_BACKEND_KEY, 'x-ms-client-principal': encoded, 'Content-Type': uploading ? request.headers.get('content-type') : 'application/json' } });
    const mime = response.headers.get('content-type') || '';
    if (['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(mime) && request.method === 'GET') {
      if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) return error(503, 'File is too large');
      const parts = []; let bytes = 0;
      for await (const part of response.body) { bytes += part.length; if (bytes > 20 * 1024 * 1024) throw new Error('File too large'); parts.push(part); }
      return { status: response.status, body: Buffer.concat(parts), headers: { ...headers, 'Content-Type': mime, 'Content-Disposition': response.headers.get('content-disposition') || 'inline', 'X-Content-Type-Options': 'nosniff', ...(mime.startsWith('image/') ? { 'Content-Security-Policy': "default-src 'none'; sandbox" } : {}) } };
    }
    if (!mime.includes('application/json')) return error(503, 'The service is temporarily unavailable');
    return { status: response.status, body: await response.text(), headers };
  } catch { return error(503, 'The service is temporarily unavailable. Try again.'); }
};
app.http('chat', { route: 'chat', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: handler(false) });
app.http('categories', { route: 'categories', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: handler(true) });
