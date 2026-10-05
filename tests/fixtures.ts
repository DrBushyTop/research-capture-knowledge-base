import type { PipelineStore } from '../apps/worker/src/pipeline.js';
import type { LibrarySnapshot } from '../shared/corpus.js';
class MemoryStore implements PipelineStore {
  data = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | undefined> { return this.data.get(key) as T | undefined; }
  async write(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async create(key: string, value: unknown) { if (!this.data.has(key)) await this.write(key, value); }
  async list(prefix: string) { return [...this.data.keys()].filter(k => k.startsWith(prefix)); }
  async withLease<T>(_key: string, fn: () => Promise<T>) { return fn(); }
}
const snapshot: LibrarySnapshot = {
  libraryType: 'users', libraryId: '12345', version: 8,
  items: [{ key: 'PBA4T3PN', version: 2, data: { itemType: 'journalArticle', title: 'A saved paper', creators: [], dateAdded: '2026-10-05T10:00:00Z' } },
    { key: '4WISI6AR', version: 8, data: { itemType: 'attachment', parentItem: 'PBA4T3PN', contentType: 'application/pdf', linkMode: 'imported_file' } }]
};

export { MemoryStore, snapshot };
