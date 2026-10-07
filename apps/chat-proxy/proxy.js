const origins = () => (process.env.READER_ORIGINS || process.env.READER_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
const sessionToken = request => {
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith('__Host-ShelfSession='));
  const token = values.length === 1 ? values[0].slice('__Host-ShelfSession='.length) : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
};
const backendHeaders = (request, fresh = false) => ({
  'x-functions-key': process.env.CHAT_BACKEND_KEY,
  ...(fresh && request.headers.get('x-ms-client-principal') ? { 'x-ms-client-principal': request.headers.get('x-ms-client-principal') } : {}),
  ...(sessionToken(request) ? { 'x-reader-session': sessionToken(request) } : {})
});

export const sessionHandler = (logout, start = false) => async request => {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  const error = (status, message) => ({ status, jsonBody: { error: message }, headers });
  if (request.method === 'POST' && !origins().includes(request.headers.get('origin'))) return error(403, 'Open the app to make changes');
  if (!process.env.CHAT_BACKEND_URL || !process.env.CHAT_BACKEND_KEY) return error(503, 'The service is temporarily unavailable');
  const url = new URL(process.env.CHAT_BACKEND_URL);
  url.searchParams.set('session', start ? 'start' : 'resume');
  if (logout) url.searchParams.set('logout', '1');
  try {
    const response = await fetch(url, { method: request.method, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: backendHeaders(request, start) });
    if (!response.headers.get('content-type')?.includes('application/json')) return error(503, 'The service is temporarily unavailable');
    if (response.headers.get('set-cookie')) headers['Set-Cookie'] = response.headers.get('set-cookie');
    if (logout && response.ok) {
      const requested = request.query.get('returnTo') || '/login.html';
      // Logout always returns to the public access page on the current host.
      const target = requested === '/login.html' || requested.startsWith('/login.html?') ? requested : '/login.html';
      headers.Location = '/.auth/logout?post_logout_redirect_uri=' + encodeURIComponent(target);
      return { status: 303, headers };
    }
    return { status: response.status, body: await response.text(), headers };
  } catch { return error(503, 'The service is temporarily unavailable. Try again.'); }
};

export const handler = admin => async request => {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  const error = (status, message) => ({ status, jsonBody: { error: message }, headers });
  // Identity headers never grant access here. The worker validates the opaque
  // session against SQL; only the Azure-authenticated start endpoint can mint one.
  if (!sessionToken(request)) return error(403, 'Reader access required');
  if (request.method === 'POST' && !origins().includes(request.headers.get('origin'))) return error(403, 'Open the app to make changes');
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
      headers: { ...backendHeaders(request), 'Content-Type': uploading ? request.headers.get('content-type') : 'application/json' } });
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
