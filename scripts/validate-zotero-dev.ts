/** Replays dev Zotero captures into local development SQL and Azurite. Default only inventories. */
import { readFile, writeFile } from 'node:fs/promises';
import { AzureCliCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { BlobServiceClient } from '@azure/storage-blob';
import { Zotero } from '../apps/worker/src/zotero.js';
import { SqlStore } from '../apps/worker/src/sql-store.js';
import { closeSql } from '../apps/worker/src/sql-connection.js';
import { SourceArtifacts } from '../apps/worker/src/source-artifacts.js';
import { MissingArtifact, maxBytes } from '../apps/worker/src/extraction.js';
import { hash, normalize, processingVersion } from '../shared/corpus.js';
import { SourceGenerations, type Job, type SourceState } from '../apps/worker/src/source-generations.js';
import { categoryRegistry } from '../apps/worker/src/category-registry.js';
import { processJob } from '../apps/worker/src/processing.js';
import { enrich, classifySource, enrichTemplate, licenseEvidence } from '../apps/worker/src/enrichment.js';
import { DocumentTexts } from '../apps/worker/src/document-text.js';
import { readSourceText } from '../apps/worker/src/source-reader.js';
import { readLibrary } from '../apps/worker/src/library.js';
import { corpusTools } from '../apps/worker/src/chat-tools.js';
import type { ChatCorpus, ChatJob } from '../shared/chat.js';

const processSources = process.argv.includes('--process');
const extract = processSources || process.argv.includes('--extract');
for (const line of (await readFile('.local/dev.env', 'utf8')).split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = JSON.parse(m[2]);
}
if (
  process.env.SQL_DATABASE !== 'research_dev' ||
  process.env.SQL_CONNECTION_STRING ||
  !process.env.AZURITE_CONNECTION_STRING
)
  throw new Error('Requires research_dev with Azure identity and local Azurite');
const secrets = new SecretClient('https://kv-research-dev-16681c6a.vault.azure.net/', new AzureCliCredential());
const [account, key] = await Promise.all(
  ['zotero-account-id', 'zotero-api-key'].map((name) => secrets.getSecret(name)),
);
if (!account.value || !key.value) throw new Error('Missing dev read credentials');
const zotero = new Zotero(account.value, key.value);
const library = (await zotero.snapshot())!;
const store = new SqlStore('researchdev');
const snapshots = normalize(library);
const previous = await store.sources();
console.log(
  JSON.stringify({
    event: 'inventory',
    libraryId: library.libraryId,
    version: library.version,
    items: library.items.length,
    roots: snapshots.length,
    existingSources: previous.length,
  }),
);
const representatives = new Set(['PBA4T3PN', 'JRIPDW25', 'FB75CUEK', 'BG5478UN']);
const selected = snapshots.filter(
  (s) => s.source.tags.includes('ingestion-matrix-dev-v1') || representatives.has(s.source.key),
);
if (process.argv.includes('--restore-dev-artifacts')) {
  const raw = new BlobServiceClient(
    'https://stresearchdev16681c6a.blob.core.windows.net',
    new AzureCliCredential(),
  ).getContainerClient('raw');
  for (const snapshot of selected) {
    const note = previous.find((entry) => entry.note.source.id === snapshot.source.id)?.note;
    const id = note?.extraction.artifactHash;
    if (!id || (await store.readArtifact(id))) continue;
    const blob = raw.getBlockBlobClient(id);
    const properties = await blob.getProperties();
    if (properties.contentLength === undefined || properties.contentLength > maxBytes)
      throw new Error('Dev original exceeds byte limit');
    const bytes = await blob.downloadToBuffer(0, undefined, {
      conditions: { ifMatch: properties.etag },
    });
    if (hash(bytes) !== id) throw new Error('Dev retained original hash mismatch');
    await store.retain(
      id,
      bytes,
      properties.contentType || note?.extraction.artifactMime || 'application/octet-stream',
    );
    console.log(
      JSON.stringify({
        event: 'restored-dev-original',
        key: snapshot.source.key,
        bytes: bytes.length,
      }),
    );
  }
}
const expected: Record<string, { status?: string; method?: string; contains?: string; texts?: string[]; artifacts?: number; images?: number; truncated?: boolean; fullText?: string }> = {
  'standalone-note': {
    status: 'text',
    method: 'text',
    contains: 'twelve bees',
  },
  'parent-with-note': {
    status: 'metadata-only',
    method: 'zotero-metadata',
    contains: 'second reading',
  },
  'standalone-pdf': { status: 'text', method: 'pdf-text' },
  'pdf-with-note-and-annotation': {
    status: 'text',
    method: 'pdf-text',
    contains: 'Check the methods',
  },
  'standalone-image': { status: 'image', method: 'image-vision' },
  'image-with-note': {
    status: 'image',
    method: 'image-vision',
    contains: 'chart axes',
  },
  'saved-html': { status: 'text', method: 'html', contains: 'twelve bees' },
  'child-linked-url': { status: 'text', method: 'html' },
  'plain-text': { status: 'text', method: 'text' },
  'json-data': { status: 'text', method: 'text' },
  'unsupported-audio': { status: 'needs-review', contains: '' },
  'compressed-html': { status: 'needs-review' },
  'note-with-embedded-image': {
    status: 'image',
    method: 'image-vision',
    contains: 'emissions series',
  },
  'blank-pdf-with-image': { status: 'image', method: 'image-vision' },
  'metadata-only': { status: 'metadata-only' },
  'standalone-docx': { status: 'text', method: 'docx-text', texts: ['Synthetic field observations', 'Afternoon', '18'], artifacts: 1 },
  'docx-with-note': { status: 'text', method: 'docx-text', texts: ['Afternoon', 'Check the Afternoon table row'], artifacts: 1 },
  'multiple-documents': { status: 'text', method: 'combined', texts: ['Synthetic layout study', 'eighteen synthetic bee visits'], artifacts: 2, images: 0 },
  'image-carousel': { status: 'image', method: 'combined', texts: ['green bar', 'reverses the two'], artifacts: 2, images: 2 },
  'mixed-attachments': { status: 'text', method: 'combined', texts: ['Synthetic layout study', 'Afternoon', 'separate synthetic evidence'], artifacts: 3, images: 1 },
  'partially-synced-attachments': { status: 'text', method: 'pdf-text', artifacts: 1, truncated: true },
  'long-docx': { status: 'text', method: 'docx-text', contains: 'Synthetic long Word document', truncated: true, fullText: 'Late Word evidence survives beyond the analysis preview.' },
  'long-pdf': { status: 'text', method: 'pdf-text', contains: 'Page 400:', truncated: true, fullText: 'Late PDF evidence survives on page 451.' },
  PBA4T3PN: { status: 'text', method: 'pdf-text' },
  JRIPDW25: { status: 'image', method: 'image-vision' },
  FB75CUEK: { status: 'text', method: 'html' },
  BG5478UN: { status: 'metadata-only', method: 'zotero-metadata' },
};
const results: Record<string, unknown>[] = [];
try {
  if (!extract) {
    console.log(
      JSON.stringify({
        cases: selected.map((s) => ({
          key: s.source.key,
          title: s.source.title,
          type: s.source.itemType,
          children: s.children.length,
        })),
      }),
    );
  } else {
    const cases = new Set(selected.map((s) => s.source.tags.find((tag) => tag.startsWith('matrix:'))?.slice(7)));
    if (
      Object.keys(expected)
        .filter((key) => !representatives.has(key))
        .some((key) => !cases.has(key)) ||
      !cases.has('pending-file')
    )
      throw new Error('Seed the missing dev matrix fixtures before validation');
    const artifacts = new SourceArtifacts(store);
    const registry = processSources ? await categoryRegistry(store) : undefined;
    for (const snapshot of selected) {
      const fixture = snapshot.source.tags.find((tag) => tag.startsWith('matrix:'))?.slice(7);
      try {
        const extracted = await artifacts.extract(snapshot, zotero);
        const expectation = expected[fixture || snapshot.source.key];
        if (
          expectation &&
          ((expectation.status && expectation.status !== extracted.evidence.status) ||
            (expectation.method && expectation.method !== extracted.evidence.method) ||
            (expectation.contains && !extracted.text.includes(expectation.contains)) ||
            expectation.texts?.some((text) => !extracted.text.includes(text)) ||
            (expectation.artifacts !== undefined && expectation.artifacts !== (extracted.evidence.artifacts?.length ?? (extracted.evidence.artifactHash ? 1 : 0))) ||
            (expectation.images !== undefined && expectation.images !== (extracted.images?.length || 0)) ||
            (expectation.truncated !== undefined && expectation.truncated !== extracted.evidence.truncated))
        )
          throw new Error('Capture evidence does not match matrix expectations');
        if (fixture === 'pending-file') throw new Error('Pending fixture unexpectedly had bytes');
        if (expectation?.fullText && !extracted.documents?.some((document) => document.sections.some((section) => section.text.includes(expectation.fullText!))))
          throw new Error('Full document text was lost beyond the analysis preview');
        if (extracted.evidence.artifactHash && !(await store.readArtifact(extracted.evidence.artifactHash)))
          throw new Error('Original artifact not retained');
        for (const artifact of extracted.evidence.artifacts || []) {
          const retained = await store.readArtifact(artifact.hash);
          if (!retained || hash(retained.bytes) !== artifact.hash)
            throw new Error('Attachment original missing or corrupt');
        }
        if (extracted.evidence.artifactHash) {
          const replay = await artifacts.extract(snapshot, {
            request: async () => {
              throw new Error('Offline replay contacted Zotero');
            },
          });
          if (replay.text !== extracted.text || JSON.stringify(replay.evidence) !== JSON.stringify(extracted.evidence) ||
            JSON.stringify(replay.images?.map((image) => hash(image.bytes))) !== JSON.stringify(extracted.images?.map((image) => hash(image.bytes))))
            throw new Error('Offline replay differs');
        }
        let processing: Record<string, unknown> | undefined;
        if (processSources) {
          await store.withLease('poll', () =>
            new SourceGenerations(store).observe(snapshot, processingVersion, registry),
          );
          const state = (await store.read<SourceState>(`sources/${snapshot.source.id}.json`))!;
          const endpoint = process.env.FOUNDRY_ENDPOINT!;
          const model = process.env.FOUNDRY_DEPLOYMENT!;
          if (!endpoint || !model) throw new Error('Missing dev model config');
          await processJob(store, state.generationId, {
            version: processingVersion,
            model,
            extract: (s, generationId) => artifacts.extract(s, zotero, undefined, generationId),
            enrich: (text, signal, images) => enrich(text, endpoint, model, signal, images),
            classify: (source, text, registry, signal, images) =>
              classifySource(source, text, registry, endpoint, model, signal, images),
            analyzeTemplate: (text, template, signal, source, images) =>
              enrichTemplate(text, template, endpoint, model, signal, source, images),
            rights: licenseEvidence,
          });
          const job = await store.read<Job>(`jobs/${state.generationId}.json`);
          const published = (await store.source(snapshot.source.id))?.note;
          if (job?.status !== 'imported' || published?.generationId !== state.generationId)
            throw new Error(`Processing did not publish: ${job?.status}`);
          if ((extracted.text || extracted.images?.length) && !published.analysis)
            throw new Error('Usable evidence did not produce analysis');
          const saved = await store.read<{ text: string }>(`source-text/${state.generationId}.json`);
          if (extracted.text && saved?.text !== extracted.text)
            throw new Error('Retained text differs from analysis input');
          if (expectation?.fullText) {
            const documents = new DocumentTexts(store);
            if (!(await documents.readAll(published))?.includes(expectation.fullText))
              throw new Error('Published generation lost full text beyond its analysis preview');
            const first = await documents.read(published);
            const late = await readSourceText(store, snapshot.source.id, fixture === 'long-pdf'
              ? { startPage: 451, endPage: 451 }
              : { offset: Math.max(0, (first?.documentLength || 0) - 4000) });
            if (!late.text.includes(expectation.fullText)) throw new Error('Reader cannot access retained late evidence');
          }
          processing = {
            jobId: state.generationId,
            status: job.status,
            analyzed: !!published.analysis,
            category: published.schemaVersion === 2 ? published.category.id : undefined,
          };
        }
        const result = {
          case: fixture || snapshot.source.title,
          key: snapshot.source.key,
          passed: true,
          extraction: extracted.evidence,
          textCharacters: extracted.text.length,
          images: extracted.images?.length || 0,
          processing,
        };
        results.push(result);
        console.log(JSON.stringify(result));
      } catch (error) {
        const pending = fixture === 'pending-file' && error instanceof MissingArtifact;
        if (pending && processSources) {
          await store.withLease('poll', () =>
            new SourceGenerations(store).observe(snapshot, processingVersion, registry),
          );
          const state = (await store.read<SourceState>(`sources/${snapshot.source.id}.json`))!;
          await processJob(store, state.generationId, {
            version: processingVersion,
            model: process.env.FOUNDRY_DEPLOYMENT!,
            extract: (s, generationId) => artifacts.extract(s, zotero, undefined, generationId),
            enrich: async () => {
              throw new Error('Pending file must not call inference');
            },
            rights: async () => [],
          });
          const job = await store.read<Job>(`jobs/${state.generationId}.json`);
          if (job?.status !== 'pending' || !job.retryAt) throw new Error('Missing file did not schedule retry');
        }
        const result = {
          case: fixture || snapshot.source.title,
          key: snapshot.source.key,
          passed: pending,
          pending,
          error: pending
            ? 'Waiting for cloud file sync'
            : error instanceof Error
              ? error.message
              : 'Capture verification failed',
        };
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
    if (processSources && !results.some(result => !result.passed)) {
      const reader = await readLibrary(store);
      const current = (await store.read<{ revision: string }>('chat/current.json'))!;
      const corpus = (await store.read<ChatCorpus>(`chat/corpora/${current.revision}.json`))!;
      const job: ChatJob = { id: hash('dev-fulltext-validation').slice(0, 32), owner: 'dev-validation', corpusRevision: corpus.revision,
        createdAt: new Date().toISOString(), request: { question: 'Find retained late evidence', history: [] }, status: 'pending', attempts: 0 };
      const tools = await corpusTools(store, corpus, job, async () => { throw new Error('Retained text should not need a sandbox'); }, async () => {}, AbortSignal.timeout(120_000));
      for (const fixture of ['long-docx', 'long-pdf']) {
        const snapshot = selected.find(source => source.source.tags.includes(`matrix:${fixture}`))!;
        const phrase = expected[fixture].fullText!;
        if (!reader.find(source => source.note.source.id === snapshot.source.id)?.searchText.includes(phrase))
          throw new Error('Reader search does not contain the full retained text');
        const search = await tools.execute('search_corpus', { query: phrase, offset: 0, limit: 20 });
        if (!(search.content as { results: { sourceId: string }[] }).results.some(result => result.sourceId === snapshot.source.id))
          throw new Error('Chat search cannot find late evidence');
        const read = await tools.execute('read_source', { sourceId: snapshot.source.id, section: 'source', query: phrase,
          page: null, pages: null, attachmentKey: null, offset: null });
        if (!(read.content as { passages: { text: string }[] }).passages.some(passage => passage.text.includes(phrase)))
          throw new Error('Chat retrieval cannot access late evidence');
        console.log(JSON.stringify({ event: 'fulltext-access', case: fixture, reader: true, search: true, chat: true }));
      }
    }
  }
  if (extract)
    await writeFile(
      '.local/zotero-coverage-results.json',
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          database: 'research_dev',
          libraryId: library.libraryId,
          libraryVersion: library.version,
          processingVersion,
          model: processSources ? process.env.FOUNDRY_DEPLOYMENT : undefined,
          results,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await closeSql();
}
