import { hash, noteArtifacts, type Note } from '../../../shared/corpus.js';
import { browserCaptureVersion } from './browser-capture.js';
import type { ChatCorpus } from '../../../shared/chat.js';
import type { LifecycleStore } from './source-lifecycle.js';

interface PurgeStore extends LifecycleStore {
  remove(key: string): Promise<void>;
  removeSource(id: string): Promise<void>;
  removeArtifact(hash: string): Promise<void>;
  artifactReferenced?(hash: string): Promise<boolean>;
  removeLegacy?(key: string): Promise<void>;
  legacyKeys?(): Promise<string[]>;
  legacyRead?<T>(key: string): Promise<T | undefined>;
}
interface Manifest { keys: string[]; hashes: string[]; corpora: string[]; batches: string[]; }
const rawHashes = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(rawHashes);
  return Object.entries(value).flatMap(([key, item]) => ['hash', 'artifactHash', 'screenshot'].includes(key) && typeof item === 'string' && /^[a-f0-9]{64}$/.test(item) ? [item] : rawHashes(item));
};

// The manifest survives interruption after receipts are removed, so raw cleanup can resume.
export async function purgeSourceContent(store: PurgeStore, id: string) {
  const manifestKey = `source-purges/${id}.json`;
  let manifest = await store.read<Manifest>(manifestKey);
  const read = async <T>(key: string) => await store.read<T>(key) ?? await store.legacyRead?.<T>(key);
  const all = [...new Set([...await store.list(''), ...await store.legacyKeys?.() || []])];
  if (!manifest) {
    const keys = new Set<string>([`sources/${id}.json`, `reader-notes/${id}.json`, `categories/assignments/${id}.json`, `publications/${id}.json`]);
    const generations = new Set<string>(); const fingerprints = new Set<string>(); const hashes = new Set<string>();
    const saved = await store.retainedSource?.(id);
    if (saved) {
      generations.add(saved.note.generationId); fingerprints.add(saved.note.source.fingerprint);
      for (const artifact of noteArtifacts(saved.note)) hashes.add(artifact.hash);
    }
    for (const key of all.filter(key => key.startsWith(`source-records/${id}/`))) {
      const owned = await read<{ key: string }>(key);
      if (owned) keys.add(owned.key);
      keys.add(key);
    }
    // Legacy records predate ownership receipts. These envelopes identify their source.
    for (const key of all.filter(key => /^(sources|jobs|snapshots|analysis|staged|artifact-sets|artifact-inputs|artifact-selections|artifact-references|browser-workspaces|chat\/assets)\//.test(key) && key.endsWith('.json'))) {
      const record = await read<{ sourceId?: string; source?: Note['source']; generationId?: string; id?: string; blobKey?: string; fingerprint?: string }>(key);
      if (record?.sourceId !== id && record?.source?.id !== id) continue;
      keys.add(key);
      if (record.blobKey) keys.add(record.blobKey);
      if (record.generationId) generations.add(record.generationId);
      if (/^(jobs|snapshots|analysis|staged)\//.test(key)) generations.add(key.split('/')[1].replace('.json', ''));
      if (record.source?.fingerprint || record.fingerprint) fingerprints.add(record.source?.fingerprint || record.fingerprint!);
      for (const artifact of rawHashes(record)) hashes.add(artifact);
    }
    for (const fingerprint of fingerprints) keys.add(`browser-captures/${hash(`${fingerprint}:${browserCaptureVersion}`)}.json`);
    for (const key of all) {
      if ([...generations].some(gen => key === `source-text/${gen}.json` || key.startsWith(`document-text/${gen}/`) || key === `artifact-sets/${gen}.json`)) keys.add(key);
      if ([...fingerprints].some(fp => key.startsWith(`artifact-inputs/${fp}/`) || key === `artifacts/${fp}.json` || key === `artifact-selections/${fp}.json`)) keys.add(key);
      // Old classification caches have no owner. Clearing them cannot remove published notes.
      if (key.startsWith('categories/classifications/')) keys.add(key);
    }
    for (const key of keys) if (/^(artifacts|artifact-sets|artifact-inputs|artifact-selections|artifact-references|analysis|staged|browser-captures)\//.test(key))
      for (const artifact of rawHashes(await read(key))) hashes.add(artifact);
    const corpora: string[] = []; const batches: string[] = [];
    for (const key of all.filter(key => key.startsWith('chat/corpora/'))) {
      const corpus = await read<ChatCorpus>(key);
      if (corpus?.sources.some(source => source.note.source.id === id)) corpora.push(key);
    }
    for (const key of all.filter(key => key.startsWith('categories/batches/'))) {
      const batch = await read<{ entries: { sourceId: string }[] }>(key);
      if (batch?.entries.some(entry => entry.sourceId === id)) batches.push(key);
    }
    manifest = { keys: [...keys], hashes: [...hashes], corpora, batches };
    await store.write(manifestKey, manifest);
  }
  // Keep conversations and their quotations. Remove every reusable corpus/index copy.
  for (const key of manifest.corpora) {
    await store.withLease(`corpus-${key.split('/').at(-1)}`, async () => {
      const corpus = await read<ChatCorpus>(key);
      if (corpus?.sources.some(source => source.note.source.id === id)) await store.write(key, { ...corpus, sources: corpus.sources.filter(source => source.note.source.id !== id) });
      await store.removeLegacy?.(key);
      await store.remove(`chat/indexes/${key.split('/').at(-1)}`);
    });
  }
  // A batch can own several sources. Remove only this source's entries.
  for (const key of manifest.batches) {
    await store.withLease(`category-batch-${key.split('/').at(-1)!.replace('.json', '')}`, async () => {
      const batch = await read<{ entries: { sourceId: string }[] }>(key);
      if (batch?.entries.some(entry => entry.sourceId === id)) {
        await store.write(key, { ...batch, entries: batch.entries.filter(entry => entry.sourceId !== id) });
      }
      await store.removeLegacy?.(key);
    });
  }
  await store.removeSource(id);
  for (const key of manifest.keys) await store.remove(key);
  for (const artifact of manifest.hashes) {
    await store.withLease(`artifact-${artifact}`, async () => {
      if ((await store.list(`artifact-references/${artifact}/`)).length) return;
      if (await store.artifactReferenced?.(artifact)) return;
      // Published notes and pre-migration receipts also count, including Trash and old generations.
      for (const key of await store.list('')) {
        if (!/^(artifacts|artifact-inputs|artifact-selections|artifact-sets|analysis|staged|browser-captures)\//.test(key)) continue;
        if (rawHashes(await store.read(key)).includes(artifact)) return;
      }
      for (const key of (await store.legacyKeys?.()) || []) {
        if (!/^(artifacts|artifact-inputs|artifact-selections|artifact-sets|analysis|staged|browser-captures)\//.test(key)) continue;
        if (rawHashes(await store.legacyRead?.(key)).includes(artifact)) return;
      }
      await store.removeArtifact(artifact);
    });
  }
  await store.remove(manifestKey);
}
