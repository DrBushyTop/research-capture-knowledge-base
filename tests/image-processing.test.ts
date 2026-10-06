import { expect, it, vi } from 'vitest';
import { processJob, type Processor } from '../apps/worker/src/processing.js';
import { discover, type Job } from '../apps/worker/src/pipeline.js';
import { presetRegistry, type Template } from '../shared/categories.js';
import { type Note, hash } from '../shared/corpus.js';
import { MemoryStore, snapshot } from './fixtures.js';

it('classifies and analyzes image-only evidence without writing invented source text', async () => {
  const store = new MemoryStore();
  const image = { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), mime: 'image/png' as const };
  const classify = vi.fn(async () => ({ categoryId: 'other', reason: 'Ambiguous screenshot' }));
  const analyzeTemplate: NonNullable<Processor['analyzeTemplate']> = vi.fn(async (_text: string, template: Template) => ({
    summary: 'Visible evidence.', topics: [], sections: template.sections.map(section => ({ id: section.id, heading: section.heading, format: section.format, text: null, items: ['Visible evidence'] }))
  }));
  const processor: Processor = { version: 'image-test', model: 'vision-test',
    extract: async () => ({ text: '', images: [image], evidence: { status: 'image', method: 'image-vision', artifactHash: hash(image.bytes), artifactMime: image.mime, retrievedAt: new Date().toISOString(), reason: 'Generated visual interpretation', truncated: false } }),
    enrich: async () => { throw new Error('Use category template'); }, classify, analyzeTemplate, rights: async () => [] };
  await discover(store, structuredClone(snapshot), processor.version, undefined, presetRegistry);
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  await processJob(store, job.id, processor);
  expect(classify.mock.calls[0]?.at(-1)).toEqual([image]);
  expect(vi.mocked(analyzeTemplate).mock.calls[0]?.at(-1)).toEqual([image]);
  const note = (await store.read<Note>(`analysis/${job.id}.json`))!;
  expect(note.analysis?.summary).toBe('Visible evidence.');
  expect(note.processing.model).toBe('vision-test');
  expect(note.extraction.status).toBe('image');
  expect(await store.list('source-text/')).toEqual([]);
});
