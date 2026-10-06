import { registrySchema, presetRegistry, templateSchema, type Registry, type Template } from '../../../shared/categories.js';
import type { PipelineStore } from './pipeline.js';
export class CategoryError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function categoryRegistry(store: PipelineStore): Promise<Registry> {
  const saved = await store.read('categories/current.json');
  if (saved) return registrySchema.parse(saved);
  return store.withLease('category-registry', async () => {
    const current = await store.read('categories/current.json');
    if (current) return registrySchema.parse(current);
    const categories: Template[] = [];
    for (const category of presetRegistry.categories) {
      const key = `categories/templates/${category.id}/1.json`;
      await store.create(key, category);
      categories.push(templateSchema.parse(await store.read(key)));
    }
    const registry = registrySchema.parse({ revision: 1, categories });
    await store.write('categories/current.json', registry);
    return registry;
  });
}
export async function saveCategory(store: PipelineStore, expectedRevision: number, input: unknown): Promise<Registry> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) throw new CategoryError(400, 'Check the category name, description and section instructions. Section identifiers must be unique.');
  await categoryRegistry(store);
  return store.withLease('category-registry', async () => {
    const current = registrySchema.parse(await store.read('categories/current.json'));
    if (current.revision !== expectedRevision) throw new CategoryError(409, 'Categories changed in another tab. Reload the current settings before saving your draft.');
    const previous = current.categories.find(category => category.id === parsed.data.id);
    if (!previous && current.categories.length >= 40) throw new CategoryError(400, 'Use up to 40 categories');
    // A crash after saving immutable history must not reuse that revision for a different draft.
    const history = await store.list(`categories/templates/${parsed.data.id}/`);
    const revision = Math.max(previous?.revision || 0, ...history.map(key => Number(key.split('/').at(-1)?.replace('.json', '')) || 0)) + 1;
    const template: Template = { ...parsed.data, revision };
    const registry = registrySchema.safeParse({ revision: current.revision + 1, categories: [...current.categories.filter(category => category.id !== template.id), template] });
    if (!registry.success) throw new CategoryError(400, 'Keep the Other category available');
    await store.create(`categories/templates/${template.id}/${template.revision}.json`, template);
    await store.write('categories/current.json', registry.data);
    return registry.data;
  });
}
