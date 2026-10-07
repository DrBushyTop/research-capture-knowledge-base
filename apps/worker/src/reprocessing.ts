import { processingVersion, sourceId } from '../../../shared/corpus.js';
import { categoryRegistry } from './category-registry.js';
import { SourceGenerations, type PipelineStore } from './source-generations.js';

export async function reprocessSource(store: PipelineStore, id: string, send: (id: string) => Promise<void>, version = processingVersion) {
  sourceId.parse(id);
  const registry = await categoryRegistry(store);
  return new SourceGenerations(store).reprocess(id, registry, version, send);
}
