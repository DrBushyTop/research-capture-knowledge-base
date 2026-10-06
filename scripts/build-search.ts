import { build } from 'esbuild';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { matchedSourceText } from '../shared/source-text.js';
import { readCorpus } from '../shared/reader.js';
import { buildSearchIndex } from '../shared/search.js';
const destination = process.argv.includes('--dev') ? 'apps/reader/public' : 'apps/reader/dist';
const entries = await readCorpus('content/research', process.env.READER_MODE === 'public' ? 'public' : 'private');
const cloud = process.env.READER_MODE !== 'public' && process.env.SEARCH_SOURCE_TEXT === 'azure' ? new BlobServiceClient(`https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient('pipeline') : undefined;
let fullTextSources = 0;
const documents = await Promise.all(entries.map(async ({ note, humanHtml }) => {
  let source = '';
  if (process.env.READER_MODE !== 'public' && note.extraction.artifactHash) {
    try {
      const json = cloud ? (await cloud.getBlockBlobClient(`source-text/${note.generationId}.json`).downloadToBuffer()).toString('utf8') : await readFile(`.local/search-source-text/${note.generationId}.json`, 'utf8');
      source = matchedSourceText(note, JSON.parse(json)); if (source) fullTextSources++;
    } catch (error) { if ((error as { code?: string }).code !== 'ENOENT' && (error as { statusCode?: number }).statusCode !== 404) throw error; }
  }
  return { id: note.source.id, title: note.source.title,
  authors: note.source.authors.join(' '), topics: (note.analysis?.topics || note.source.tags).join('\n'),
  body: [JSON.stringify(note.analysis || ''), humanHtml.replace(/<[^>]*>/g, ' '), source].join(' '),
  type: note.source.itemType, year: note.source.publishedAt?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 'Unknown' };
}));
await writeFile(`${destination}/search-index.json`, JSON.stringify(buildSearchIndex(documents)));
await build({ entryPoints: ['apps/reader/src/search.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: `${destination}/reader-search.js` });
await rm(`${destination}/reader-chat.js`, { force: true });
console.log(JSON.stringify({ fuzzySearchDocuments: documents.length, fullTextSources }));
