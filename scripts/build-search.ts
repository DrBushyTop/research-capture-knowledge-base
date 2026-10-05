import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { readCorpus } from '../shared/reader.js';
import { buildSearchIndex } from '../shared/search.js';
const destination = process.argv.includes('--dev') ? 'apps/reader/public' : 'apps/reader/dist';
const entries = await readCorpus('content/research', process.env.READER_MODE === 'public' ? 'public' : 'private');
const documents = entries.map(({ note, humanHtml }) => ({ id: note.source.id, title: note.source.title,
  authors: note.source.authors.join(' '), topics: (note.analysis?.topics || note.source.tags).join('\n'),
  body: [JSON.stringify(note.analysis || ''), humanHtml.replace(/<[^>]*>/g, ' ')].join(' '),
  type: note.source.itemType, year: note.source.publishedAt?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 'Unknown' }));
await writeFile(`${destination}/search-index.json`, JSON.stringify(buildSearchIndex(documents)));
await build({ entryPoints: ['apps/reader/src/search.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: `${destination}/reader-search.js` });
console.log(JSON.stringify({ fuzzySearchDocuments: documents.length }));
