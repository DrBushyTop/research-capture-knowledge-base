import { expect, it, vi } from 'vitest';
import { normalize, type LibrarySnapshot, type Analysis, type Note } from '../shared/corpus.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { MemorySourceArtifactStore, screenshot } from './source-artifacts-fixture.js';
import { snapshot } from './fixtures.js';
import { downloadAttachment, MissingArtifact } from '../apps/worker/src/extraction.js';
import { discover, type Job } from '../apps/worker/src/pipeline.js';
import { processJob } from '../apps/worker/src/processing.js';

const text =
  'The original document describes a synthetic observation with enough text to exercise the ingestion pipeline and its evidence retention.';
const offline = {
  request: vi.fn(async (): Promise<Response> => {
    throw new Error('Not synced');
  }),
};

it('ingests a standalone rich text note as a source, even when short', async () => {
  const library: LibrarySnapshot = {
    ...snapshot,
    items: [
      {
        key: 'NOTE0001',
        version: 1,
        data: {
          itemType: 'note',
          note: '<h1>Field note</h1><p>Observed two bees.</p><script>secret()</script>',
        },
      },
    ],
  };
  const sources = normalize(library);
  expect(sources).toHaveLength(1);
  expect(sources[0].source.title).toContain('Field note');
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(sources[0], offline);
  expect(result.text).toContain('Observed two bees.');
  expect(result.text).not.toContain('secret()');
  expect(result.evidence).toMatchObject({
    status: 'text',
    method: 'text',
    artifactHash: null,
  });
});

it('keeps child notes and annotation comments separate from original source text and replays them', async () => {
  const library = structuredClone(snapshot);
  library.items[1].data.contentType = 'text/plain';
  library.items.push(
    {
      key: 'NOTE0001',
      version: 1,
      data: {
        itemType: 'note',
        parentItem: library.items[0].key,
        note: '<p>My interpretation differs.</p><style>hidden</style>',
      },
    },
    {
      key: 'ANNOT001',
      version: 1,
      data: {
        itemType: 'annotation',
        parentItem: library.items[1].key,
        annotationText: 'A highlighted quote.',
        annotationComment: 'Check this claim.',
        annotationPageLabel: '3',
      },
    },
  );
  const source = normalize(library)[0];
  const artifacts = new SourceArtifacts(new MemorySourceArtifactStore());
  const first = await artifacts.extract(source, {
    request: async () => new Response(text),
  });
  expect(first.evidence).toMatchObject({ status: 'text', method: 'text' });
  expect(first.text).toContain(text);
  expect(first.text).toContain('Saved Zotero note NOTE0001');
  expect(first.text).toContain('My interpretation differs.');
  expect(first.text).toContain('Saved Zotero annotation ANNOT001');
  expect(first.text).toContain('Check this claim.');
  expect(first.text).toContain('Page: 3');
  expect(first.text).not.toContain('hidden');
  expect(await artifacts.extract(source, offline)).toEqual(first);
});

it('uses saved child commentary as labelled metadata when there is no original', async () => {
  const library = structuredClone(snapshot);
  library.items[1] = {
    key: 'NOTE0001',
    version: 1,
    data: {
      itemType: 'note',
      parentItem: library.items[0].key,
      note: '<p>A short personal observation.</p>',
    },
  };
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(normalize(library)[0], offline);
  expect(result.text).toContain('A short personal observation.');
  expect(result.evidence).toMatchObject({
    status: 'metadata-only',
    method: 'zotero-metadata',
  });
  expect(result.evidence.reason).toContain('saved notes');
});

it('passes an attachment note alongside retained image bytes', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.children[0].data.contentType = 'image/png';
  source.children[0].data.note = '<p>The label was added by the user.</p>';
  source.root.data.abstractNote = '<p>A saved caption.</p>';
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(source, {
    request: async () => new Response(screenshot),
  });
  expect(result.images?.[0].bytes).toEqual(screenshot);
  expect(result.text).toContain('The label was added by the user.');
  expect(result.text).toContain('Saved Zotero description or caption');
  expect(result.text).not.toContain('Original source evidence');
  expect(result.evidence.method).toBe('image-vision');
});

it.each(['audio/mpeg', 'application/zip'])(
  'retains unsupported %s files for review',
  async (mime) => {
    const source = normalize(structuredClone(snapshot))[0];
    source.children[0].data.contentType = mime;
    const store = new MemorySourceArtifactStore();
    const result = await new SourceArtifacts(store).extract(source, {
      request: async () => new Response('unsupported original'),
    });
    expect(store.files.size).toBe(1);
    expect(result.evidence).toMatchObject({
      status: 'needs-review',
      artifactMime: mime,
    });
    expect(result.evidence.reason).toContain('not supported');
  },
);

it('reports a local linked file as unavailable without calling the cloud file endpoint', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.children[0].data.linkMode = 'linked_file';
  offline.request.mockClear();
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(source, offline);
  expect(result.evidence.status).toBe('needs-review');
  expect(result.evidence.reason).toContain('Linked files');
  expect(offline.request).not.toHaveBeenCalled();
});

it('tries another synced attachment when the preferred PDF has not synced yet', async () => {
  const source = normalize(structuredClone(snapshot))[0];
  source.children.push({
    key: 'IMAGE001',
    version: 1,
    data: {
      itemType: 'attachment',
      linkMode: 'imported_file',
      contentType: 'image/png',
    },
  });
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(source, {
    request: async (path) => {
      if (!path.includes('IMAGE001')) throw new Error('PDF not synced yet');
      return new Response(screenshot);
    },
  });
  expect(result.images?.[0].bytes).toEqual(screenshot);
  expect(result.evidence.method).toBe('image-vision');
});

it('analyzes an embedded image without losing its standalone parent note', async () => {
  const library: LibrarySnapshot = {
    ...snapshot,
    items: [
      {
        key: 'NOTE0001',
        version: 1,
        data: { itemType: 'note', note: '<p>My caption for the chart.</p>' },
      },
      {
        key: 'IMAGE001',
        version: 1,
        data: {
          itemType: 'attachment',
          parentItem: 'NOTE0001',
          linkMode: 'embedded_image',
          contentType: 'image/png',
        },
      },
    ],
  };
  const result = await new SourceArtifacts(new MemorySourceArtifactStore()).extract(normalize(library)[0], {
    request: async () => new Response(screenshot),
  });
  expect(result.images?.[0].bytes).toEqual(screenshot);
  expect(result.text).toContain('My caption for the chart.');
  expect(result.evidence.method).toBe('image-vision');
});

it('rejects stale cloud file bytes before retention when attachment metadata names a different MD5', async () => {
  const attachment = structuredClone(snapshot.items[1]);
  attachment.data.md5 = '00000000000000000000000000000000';
  await expect(
    downloadAttachment(attachment, {
      request: async () => new Response('stale original'),
    }),
  ).rejects.toBeInstanceOf(MissingArtifact);
});

it('publishes labelled child commentary and keeps the result readable after removal from Zotero', async () => {
  const library = structuredClone(snapshot);
  library.items[1].data.contentType = 'text/plain';
  library.items.push({
    key: 'NOTE0001',
    version: 1,
    data: {
      itemType: 'note',
      parentItem: library.items[0].key,
      note: '<p>My saved observation.</p>',
    },
  });
  let published: Note | undefined;
  const store = Object.assign(new MemorySourceArtifactStore(), {
    publishNote: async (note: Note) => {
      published = note;
    },
  });
  await discover(store, library, '3');
  const job = (await store.read<Job>((await store.list('jobs/'))[0]))!;
  const analysis: Analysis = {
    summary: 'Summary of the supplied document.',
    topics: [],
    sourceCategory: 'other',
    studyType: null,
    keyFindings: [],
    limitations: [],
    claims: [],
    relevance: [],
    population: null,
    participantCount: null,
    intervention: null,
    comparator: null,
    outcomes: [],
    funding: null,
    suggestedRelationships: [],
  };
  await processJob(store, job.id, {
    version: '3',
    model: 'test',
    extract: (s) =>
      new SourceArtifacts(store).extract(s, {
        request: async () => new Response(text),
      }),
    enrich: async (input) => {
      expect(input).toContain('My saved observation.');
      expect(input).toContain('Human commentary, separate from the original source.');
      return analysis;
    },
    rights: async () => [],
  });
  expect((await store.read<{ text: string }>(`source-text/${job.id}.json`))?.text).toContain('My saved observation.');
  expect((await store.read<Job>(`jobs/${job.id}.json`))?.status).toBe('imported');
  await discover(store, { ...library, version: library.version + 1, items: [] }, '3');
  expect(await store.list('jobs/')).toHaveLength(1);
  expect(published?.source.active).toBe(true);
  expect(published?.analysis?.summary).toBe(analysis.summary);
});
