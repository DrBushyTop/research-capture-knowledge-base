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
it('the private hosting rules protect arbitrary search and asset paths', async () => {
  const config = JSON.parse(await readFile('apps/reader/staticwebapp.config.json', 'utf8'));
  const allowed = (pathname: string) => config.routes.find((r: {route: string}) => r.route.endsWith('*') ? pathname.startsWith(r.route.slice(0,-1)) : pathname === r.route).allowedRoles;
  expect(allowed('/pagefind/pagefind.js')).toEqual(['reader']);
  expect(allowed('/research/saved-note/')).toEqual(['reader']);
  expect(allowed('/_astro/font.woff2')).toEqual(['reader']);
  expect(allowed('/login.html')).toEqual(['anonymous']);
  expect(config.navigationFallback).toBeUndefined();
});
