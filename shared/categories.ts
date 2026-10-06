import { z } from 'zod';

export const categoryId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const templateSectionSchema = z.strictObject({
  id: categoryId, heading: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(2000), format: z.enum(['text', 'bullets', 'steps'])
});
export const templateSchema = z.strictObject({
  id: categoryId, revision: z.number().int().positive(), name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1200), archived: z.boolean(),
  sections: z.array(templateSectionSchema).min(1).max(12)
}).refine(value => new Set(value.sections.map(section => section.id)).size === value.sections.length, 'Section identifiers must be unique');
export type Template = z.infer<typeof templateSchema>;
export const registrySchema = z.strictObject({ revision: z.number().int().positive(), categories: z.array(templateSchema).min(1).max(40) })
  .refine(value => new Set(value.categories.map(category => category.id)).size === value.categories.length, 'Category identifiers must be unique')
  .refine(value => value.categories.some(category => category.id === 'other' && !category.archived), 'Keep the Other category available');
export type Registry = z.infer<typeof registrySchema>;
export const assignmentSchema = z.strictObject({
  categoryId, revision: z.number().int().positive(), method: z.enum(['automatic', 'manual']), reason: z.string().max(1000)
});
export type CategoryAssignment = z.infer<typeof assignmentSchema>;
export const classificationSchema = z.strictObject({ categoryId, reason: z.string().max(1000) });
export const sectionValuesSchema = z.strictObject({ id: categoryId, text: z.string().max(12000).nullable(), items: z.array(z.string().max(2000)).max(40) });
export const templateOutputSchema = z.strictObject({ summary: z.string().max(12000), topics: z.array(z.string().max(80)).max(12), sections: z.array(sectionValuesSchema).max(12) });
export const templateAnalysisSchema = z.strictObject({
  summary: z.string().max(12000), topics: z.array(z.string().max(80)).max(12),
  sections: z.array(sectionValuesSchema.extend({ heading: z.string().max(100), format: z.enum(['text', 'bullets', 'steps']) })).max(12)
});
export type TemplateAnalysis = z.infer<typeof templateAnalysisSchema>;
export function applyTemplate(template: Template, input: unknown): TemplateAnalysis {
  const result = templateOutputSchema.parse(input);
  const ids = result.sections.map(section => section.id);
  if (ids.length !== template.sections.length || new Set(ids).size !== ids.length || ids.some(id => !template.sections.some(section => section.id === id))) throw new Error('Analysis sections do not match the template');
  return templateAnalysisSchema.parse({ summary: result.summary, topics: result.topics,
    sections: template.sections.map(definition => {
      const value = result.sections.find(section => section.id === definition.id)!;
      if (definition.format === 'text' ? value.items.length > 0 : value.text !== null) throw new Error('Analysis section has the wrong format');
      return { ...value, heading: definition.heading, format: definition.format };
    }) });
}
const section = (id: string, heading: string, instructions: string, format: 'text' | 'bullets' | 'steps' = 'bullets') => ({ id, heading, instructions, format });
const preset = (id: string, name: string, description: string, sections: Template['sections']): Template => ({ id, name, description, sections, revision: 1, archived: false });
export const presetRegistry: Registry = registrySchema.parse({ revision: 1, categories: [
  preset('research', 'Research', 'Research papers, scientific reviews and reports that describe a research question, method or evidence.', [
    section('question', 'Question', 'State the question or purpose reported by this source.', 'text'),
    section('methods', 'Methods', 'Describe the reported study design and methods. Include population, sample size, intervention or comparator only when applicable and stated.'),
    section('findings', 'Findings', 'List the main reported findings. Distinguish observations from the authors\' interpretation.'),
    section('limitations', 'Limitations', 'List limitations stated or supported by the source. Do not invent missing study details.'),
    section('funding', 'Funding', 'Report stated funding and conflicts of interest. Leave empty when not reported.', 'text')
  ]),
  preset('news', 'News', 'News stories and announcements reporting events, decisions or developments.', [
    section('events', 'What happened', 'Describe the reported event and its status.', 'text'),
    section('people-dates', 'Dates and people', 'List the relevant reported dates, people and organisations.'),
    section('claims', 'Reported claims', 'Summarise the main claims and attribute each to its named source. Preserve uncertainty.'),
    section('context', 'Context', 'Explain relevant context available in this source without adding unsupported facts.', 'text')
  ]),
  preset('recipe', 'Recipe', 'Recipes with ingredients and instructions for preparing food or drinks.', [
    section('ingredients', 'Ingredients', 'List each ingredient and amount. Preserve the original units.'),
    section('steps', 'Steps', 'List the preparation steps in their original order.', 'steps'),
    section('time-servings', 'Time and servings', 'Report preparation time, cooking time and servings when stated.'),
    section('substitutions', 'Substitutions', 'List only substitutions and variations suggested by the source.')
  ]),
  preset('guide', 'Guide', 'Tutorials, manuals, instructions and practical guides for completing a task.', [
    section('purpose', 'Purpose', 'State what this guide helps the reader do.', 'text'),
    section('requirements', 'Prerequisites', 'List tools, knowledge and other stated requirements.'),
    section('instructions', 'Instructions', 'Describe the main instructions in sequence.', 'steps'),
    section('cautions', 'Cautions', 'List stated warnings, restrictions or common mistakes.')
  ]),
  preset('social', 'Social post', 'Posts shared on social platforms, including captions and linked images or videos.', [
    section('caption', 'Caption', 'Summarise the caption that is actually available. Do not infer an unavailable caption or image.', 'text'),
    section('creator', 'Creator', 'Identify the credited creator from the available source facts.', 'text'),
    section('links', 'Linked material', 'Describe linked material mentioned by the post. Do not invent links.'),
    section('context', 'Context', 'Record relevant context supported by the available post.', 'text')
  ]),
  preset('other', 'Other', 'Saved material that does not fit another category, including ambiguous or inaccessible sources.', [
    section('points', 'Key points', 'List useful points supported by the available source. Leave empty if the contents are unavailable.')
  ])
] });
