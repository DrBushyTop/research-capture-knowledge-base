import { hash, noteSchema, type Note } from '../../../shared/corpus.js';
import { matchedSourceText, sourceText } from '../../../shared/source-text.js';
import { sourceImage, sourceImageLimits, type SourceImage } from './image-input.js';
import type { PipelineStore } from './pipeline.js';
import type { SourceArtifacts } from './source-artifacts.js';

type PinnedNote = Pick<Note, 'source' | 'generationId' | 'extraction'>;
type Evidence = { text: string; images?: SourceImage[] };

/** Owns the evidence shared by processing and template preview.
 * Text stays pinned to its generation, including browser captures and saved captions.
 * Image bytes come from the note's exact retained artifact, never a live URL or latest selection.
 * The artifact reader is injected so the request handler does not load PDF parsing at startup.
 */
export class AnalysisInputs {
  constructor(private readonly store: Pick<PipelineStore, 'read' | 'create'>,
    private readonly artifacts?: Pick<SourceArtifacts, 'readForNote'>) {}

  private checked(note: PinnedNote, input: Evidence) {
    // The record schema also validates source and generation identity and bounds text length.
    sourceText(note, input.text);
    if ((input.images?.length ?? 0) > sourceImageLimits.count) throw new Error('Only one source image is supported per analysis.');
    const images = input.images?.map(image => {
      const checked = sourceImage(image.bytes, image.mime);
      if (hash(checked.bytes) !== note.extraction.artifactHash) throw new Error('Analysis image does not match the pinned artifact');
      if (note.extraction.artifactMime && checked.mime !== note.extraction.artifactMime.split(';')[0].trim().toLowerCase()) throw new Error('Analysis image MIME does not match the pinned artifact');
      return checked;
    });
    return { text: input.text, images, available: !!input.text.trim() || !!images?.length };
  }

  async retain(note: PinnedNote, input: Evidence) {
    const checked = this.checked(note, input);
    const key = `source-text/${note.generationId}.json`;
    if (checked.text) {
      await this.store.create(key, sourceText(note, checked.text));
    }
    // An interrupted attempt may already have recorded text. Analyze that same immutable evidence.
    const cached = await this.store.read(key);
    if (cached !== undefined) checked.text = matchedSourceText(note, cached);
    checked.available = !!checked.text.trim() || !!checked.images?.length;
    return checked;
  }

  async read(sourceId: string, generationId: string) {
    if (!/^[a-f0-9]{64}$/.test(generationId)) throw new Error('Invalid analysis generation');
    const note = noteSchema.parse(await this.store.read(`analysis/${generationId}.json`));
    if (note.source.id !== sourceId || note.generationId !== generationId) throw new Error('Analysis does not match the pinned source generation');
    const cached = await this.store.read(`source-text/${generationId}.json`);
    const text = cached === undefined ? '' : matchedSourceText(note, cached);
    let images: SourceImage[] | undefined;
    if (note.extraction.method === 'image-vision') {
      const artifact = await this.artifacts?.readForNote(note);
      if (!artifact) throw new Error('Pinned image evidence is unavailable');
      images = [sourceImage(artifact.bytes, artifact.mime)];
    }
    const input = this.checked(note, { text, images });
    if (!input.available) throw new Error('No readable text or supported image evidence is available');
    return { ...input, source: note.source };
  }
}
