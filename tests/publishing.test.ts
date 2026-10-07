import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { applyCandidate } from '../shared/importer.js';
import { normalize, privatePublication, type Note } from '../shared/corpus.js';
import { readCorpus } from '../shared/reader.js';
import { snapshot } from './fixtures.js';
const source = normalize(snapshot)[0].source;
const note: Note = { schemaVersion: 1, generationId: 'f'.repeat(64), source, extraction: { status: 'metadata-only', method: 'none', reason: 'No text available.', truncated: false, retrievedAt: '2026-10-05T10:00:00Z', artifactHash: 'e'.repeat(64) }, analysis: null, processing: { version: '1', model: null, processedAt: '2026-10-05T10:00:00Z' }, rightsEvidence: [] };
it('public selection excludes private and stale approvals but allows an approved note with a private artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-publishing-'));
  try {
    await applyCandidate(root, note);
    expect(await readCorpus(root, 'public')).toHaveLength(0);
    const publication = path.join(root, source.id, 'publication.json');
    await writeFile(publication, JSON.stringify({ ...privatePublication, note: 'LINK_ONLY', approvedBy: 'owner', approvedFingerprint: source.fingerprint, approvedGenerationId: note.generationId }));
    const selected = await readCorpus(root, 'public');
    expect(selected).toHaveLength(1);
    expect(selected[0].publication.artifact).toBe('UNKNOWN');
    await applyCandidate(root, { ...note, generationId: 'b'.repeat(64), processing: { ...note.processing, version: '2' } });
    expect(await readCorpus(root, 'public')).toHaveLength(0);
    await writeFile(publication, JSON.stringify({ ...privatePublication, note: 'ALLOW', approvedBy: 'owner', approvedFingerprint: '0'.repeat(64) }));
    expect(await readCorpus(root, 'public')).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('human notes are rendered without executable HTML or tracking images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-publishing-'));
  try {
    await applyCandidate(root, note);
    await writeFile(path.join(root, source.id, 'notes.md'), 'Keep my note.\n<script>alert(1)</script>\n<img src="https://tracker.invalid/pixel">\n[unsafe](javascript:alert(1))');
    const [selected] = await readCorpus(root, 'private');
    expect(selected.humanHtml).toContain('Keep my note.');
    expect(selected.humanHtml).not.toMatch(/<script|<img|href=["']javascript:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('hosting serves the app shell while protecting session creation and preserving API routes', async () => {
  const config = JSON.parse(await readFile('apps/reader/staticwebapp.config.json', 'utf8'));
  const matches = (pattern: string, pathname: string) => {
    if (pattern.includes('*.{')) {
      const extensions = pattern.slice(pattern.indexOf('{') + 1, -1).split(',');
      return extensions.some(extension => pathname.endsWith('.' + extension));
    }
    return pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
  };
  const rule = (pathname: string, method = 'GET') => config.routes.find((r: { route: string; methods?: string[] }) => matches(r.route, pathname) && (!r.methods || r.methods.includes(method)));
  for (const pathname of ['/', '/sources/', '/sources/example/', '/chat/conversation/', '/categories/', '/unknown-route']) {
    expect(rule(pathname).allowedRoles).toEqual(['anonymous']);
    expect(rule(pathname).rewrite).toBe('/index.html');
  }
  for (const pathname of ['/assets/main.js', '/assets/font.woff2', '/assets/missing.svg', '/api/chat', '/api/categories', '/api/session', '/api/logout']) {
    expect(rule(pathname).allowedRoles).toEqual(['anonymous']);
    expect(rule(pathname).rewrite).toBeUndefined();
  }
  expect(rule('/api/session-start', 'POST').allowedRoles).toEqual(['library_member']);
  expect(rule('/api/session-start', 'POST').rewrite).toBeUndefined();
  expect(rule('/missing.css').allowedRoles).toEqual(['library_member']);
  expect(rule('/missing.css').rewrite).toBeUndefined();
  for (const pathname of ['/index.html', '/login.html', '/access.css', '/access.js', '/logout.html', '/logout.js', '/.auth/me', '/manifest.webmanifest', '/pwa.js', '/sw.js', '/offline.html', '/icons/shelf-192.png']) {
    expect(rule(pathname).allowedRoles).toEqual(['anonymous']);
    expect(rule(pathname).rewrite).toBeUndefined();
  }
  expect(rule('/.auth/login/aad').statusCode).toBe(404);
  // Only the session-start route trusts Azure identity. Corpus requests require
  // the proxy and worker's validated session rather than the short Azure cookie.
  expect(config.navigationFallback).toBeUndefined();
  expect(config.responseOverrides['403']).toEqual({ rewrite: '/login.html', statusCode: 403 });
  expect(config.globalHeaders['Cache-Control']).toBe('private, no-store');
  expect(rule('/assets/main.js').headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  for (const pathname of ['/api/chat', '/api/session', '/login.html', '/index.html', '/sources/', '/sw.js']) {
    expect(rule(pathname).headers?.['Cache-Control'] ?? config.globalHeaders['Cache-Control']).toBe('private, no-store');
  }
});
