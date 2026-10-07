/** Operator-only dev fixtures. Worker identities cannot read the write secret. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AzureCliCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { Zotero } from '../apps/worker/src/zotero.js';
import { downloadAttachment } from '../apps/worker/src/extraction.js';
import { layoutPdf, pdfFixture } from '../tests/pdf-fixture.js';

const apply = process.argv.includes('--apply');
const marker = 'ingestion-matrix-dev-v1';
const keyFor = (name: string) =>
  [...createHash('sha256').update(`${marker}:${name}`).digest().subarray(0, 8)]
    .map((b) => '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ'[b % 32])
    .join('');
const secrets = new SecretClient('https://kv-research-dev-16681c6a.vault.azure.net/', new AzureCliCredential());
const [account, key] = await Promise.all(
  ['zotero-account-id', apply ? 'zotero-api-key-write' : 'zotero-api-key'].map((name) => secrets.getSecret(name)),
);
if (!account.value || !key.value) throw new Error('Missing dev Zotero credentials');
const zotero = new Zotero(account.value, key.value);
const before = (await zotero.snapshot())!;
console.log(
  JSON.stringify({
    event: 'inventory',
    libraryId: before.libraryId,
    version: before.version,
    items: before.items.length,
  }),
);
const collectionKey = keyFor('collection');
const existingCollections = (await (await zotero.request('collections?limit=100')).json()) as {
  key: string;
  data: { name: string };
}[];
async function request(path: string, init: RequestInit) {
  const response = await fetch(`https://api.zotero.org/users/${account.value}/${path}`, {
    ...init,
    headers: {
      'Zotero-API-Key': key.value!,
      'Zotero-API-Version': '3',
      ...init.headers,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Dev fixture API ${path.split('?')[0]} HTTP ${response.status}`);
  }
  return response;
}
async function create(path: string, data: unknown[], token: string) {
  const body = JSON.stringify(
    data.map((value) => ({
      ...(value as Record<string, unknown>),
      version: 0,
    })),
  );
  const response = await request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Zotero-Write-Token': createHash('sha256')
        .update(token + body)
        .digest('hex')
        .slice(0, 32),
    },
    body,
  });
  const result = (await response.json()) as {
    failed: Record<string, { code: number; message: string }>;
  };
  if (Object.keys(result.failed || {}).length)
    throw new Error(`Dev fixture rejected: ${JSON.stringify(result.failed)}`);
}
if (apply && !existingCollections.some((c) => c.key === collectionKey))
  await create('collections', [{ key: collectionKey, name: 'Ingestion matrix - dev' }], `${marker}:collection`);

const items: Record<string, unknown>[] = [];
const files = new Map<string, { bytes: Buffer; filename: string; mime: string }>();
const titles: { case: string; key: string }[] = [];
function root(name: string, itemType: string, fields: Record<string, unknown> = {}) {
  const itemKey = keyFor(name);
  items.push({
    key: itemKey,
    itemType,
    ...(itemType === 'note' ? {} : { title: `Dev ingestion: ${name}` }),
    tags: [{ tag: marker }, { tag: `matrix:${name}` }],
    collections: [collectionKey],
    relations: {},
    ...fields,
  });
  titles.push({ case: name, key: itemKey });
  return itemKey;
}
function note(parent: string, name: string, text: string) {
  const itemKey = keyFor(name);
  items.push({
    key: itemKey,
    itemType: 'note',
    parentItem: parent,
    note: `<p>${text}</p>`,
    tags: [],
    collections: [],
    relations: {},
  });
  return itemKey;
}
function file(
  parent: string | undefined,
  name: string,
  bytes: Buffer,
  mime: string,
  filename: string,
  fields: Record<string, unknown> = {},
) {
  const itemKey = parent ? keyFor(name) : root(name, 'attachment');
  const data =
    fields.linkMode === 'embedded_image'
      ? {
          key: itemKey,
          itemType: 'attachment',
          parentItem: parent,
          linkMode: 'embedded_image',
          contentType: mime,
          filename,
        }
      : {
          key: itemKey,
          itemType: 'attachment',
          ...(parent ? { parentItem: parent } : { collections: [collectionKey] }),
          linkMode: 'imported_file',
          title: `Dev ingestion: ${name}`,
          contentType: mime,
          filename,
          tags: [{ tag: marker }, ...(!parent ? [{ tag: `matrix:${name}` }] : [])],
          relations: {},
          ...fields,
        };
  if (parent) items.push(data);
  else Object.assign(items.at(-1)!, data);
  files.set(itemKey, { bytes, filename, mime });
  return itemKey;
}
const imageItem = before.items.find(
  (i) =>
    i.data.contentType === 'image/png' &&
    i.data.md5 &&
    ['imported_file', 'imported_url'].includes(String(i.data.linkMode)),
);
if (!imageItem) throw new Error('Expected existing dev PNG to reuse');
const image = Buffer.from((await downloadAttachment(imageItem, zotero)).bytes);
const html =
  '<html><head><title>Saved field observations</title></head><body><article><h1>Saved field observations</h1><p>This synthetic dev fixture records a ten minute observation of twelve bees visiting a flowering plant. It tests extraction of a saved HTML snapshot. The counts are invented for testing and are not research findings.</p></article></body></html>';
root('standalone-note', 'note', {
  note: '<h1>Dev ingestion field note</h1><p>I observed twelve bees near the lavender. These are invented observations for an ingestion test.</p>',
});
const commentary = root('parent-with-note', 'book');
note(
  commentary,
  'book-note',
  'My saved note says this book needs a second reading. This is human commentary, not a claim from the book.',
);
file(undefined, 'standalone-pdf', layoutPdf(), 'application/pdf', 'layout.pdf');
const article = root('pdf-with-note-and-annotation', 'journalArticle');
const pdf = file(article, 'annotated-pdf', layoutPdf(), 'application/pdf', 'annotated.pdf');
note(article, 'article-note', 'My interpretation of the synthetic layout study is provisional.');
items.push({
  key: keyFor('highlight'),
  itemType: 'annotation',
  parentItem: pdf,
  annotationType: 'highlight',
  annotationText: 'Synthetic layout study',
  annotationComment: 'Check the methods before trusting this example.',
  annotationColor: '#ffd400',
  annotationPageLabel: '1',
  annotationSortIndex: '00000|000000|00000',
  annotationPosition: JSON.stringify({
    pageIndex: 0,
    rects: [[30, 680, 200, 700]],
  }),
  tags: [],
  relations: {},
});
file(undefined, 'standalone-image', image, 'image/png', 'chart.png');
const chart = root('image-with-note', 'artwork');
file(chart, 'chart-attachment', image, 'image/png', 'chart.png', {
  note: '<p>This saved human note asks me to check the chart axes before comparing the series.</p>',
});
const page = root('saved-html', 'webpage');
file(page, 'html-snapshot', Buffer.from(html), 'text/html', 'snapshot.html', {
  linkMode: 'imported_url',
  url: 'https://example.org/',
});
const link = root('child-linked-url', 'report');
items.push({
  key: keyFor('http-link'),
  itemType: 'attachment',
  parentItem: link,
  linkMode: 'linked_url',
  title: 'Example domain',
  url: 'https://example.org/',
  tags: [],
  relations: {},
});
file(
  undefined,
  'plain-text',
  Buffer.from(
    'These synthetic plain text observations record twelve bees visiting lavender over ten minutes. The file tests retained UTF-8 text ingestion and should remain readable after the original disappears.',
  ),
  'text/plain',
  'observations.txt',
);
file(
  undefined,
  'json-data',
  Buffer.from(
    JSON.stringify({
      fixture: true,
      observation: 'Invented bee observations for testing JSON capture ingestion.',
      count: 12,
      durationMinutes: 10,
      notes: 'No scientific conclusion should be inferred from these synthetic records.',
    }),
  ),
  'application/json',
  'observations.json',
);
const wav = Buffer.alloc(60);
wav.write('RIFF');
wav.writeUInt32LE(52, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(16, 40);
file(undefined, 'unsupported-audio', wav, 'audio/wav', 'silence.wav');
const compressed = execFileSync(
  'python3',
  [
    '-c',
    'import sys,io,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); i=zipfile.ZipInfo("snapshot.html",(2026,10,7,12,0,0)); i.compress_type=zipfile.ZIP_DEFLATED; z.writestr(i,sys.stdin.buffer.read()); z.close(); sys.stdout.buffer.write(b.getvalue())',
  ],
  { input: html },
);
const zip = root('compressed-html', 'webpage');
file(zip, 'compressed-snapshot', compressed, 'text/html', 'snapshot.zip', {
  linkMode: 'imported_url',
  url: 'https://example.org/',
});
const illustrated = root('note-with-embedded-image', 'note', {
  note: '<h1>Dev ingestion illustrated note</h1><p>My saved chart helps me compare the emissions series. The picture and this comment need to stay distinguishable.</p>',
});
file(illustrated, 'embedded-chart', image, 'image/png', 'embedded.png', {
  linkMode: 'embedded_image',
});
const pending = root('pending-file', 'journalArticle');
items.push({
  key: keyFor('pending-pdf'),
  itemType: 'attachment',
  parentItem: pending,
  linkMode: 'imported_file',
  title: 'Not uploaded yet',
  contentType: 'application/pdf',
  filename: 'pending.pdf',
  tags: [],
  relations: {},
});
const scan = root('blank-pdf-with-image', 'report');
file(scan, 'blank-pdf', pdfFixture(['']), 'application/pdf', 'blank.pdf');
file(scan, 'scan-fallback', image, 'image/png', 'fallback.png');
root('metadata-only', 'report');
const missing = items.filter((i) => !before.items.some((existing) => existing.key === i.key));
for (const existing of before.items.filter((i) => items.some((d) => d.key === i.key))) {
  let ancestor = existing;
  while (ancestor.data.parentItem) {
    const parent = before.items.find((i) => i.key === ancestor.data.parentItem);
    if (!parent) break;
    ancestor = parent;
  }
  if (
    !(ancestor.data.tags as { tag: string }[] | undefined)?.some((t) => t.tag === marker) ||
    existing.data.itemType !== items.find((d) => d.key === existing.key)?.itemType
  )
    throw new Error('Fixture key collision');
}
console.log(
  JSON.stringify({
    event: 'fixture-plan',
    apply,
    newItems: missing.length,
    roots: titles,
    uploadBytes: [...files.values()].reduce((sum, f) => sum + f.bytes.length, 0),
  }),
);
if (!apply) process.exit(0);
if (missing.length) await create('items', missing, `${marker}:${missing.map((i) => i.key).join(',')}`);
for (const fixture of items.filter((i) => !i.parentItem && i.itemType === 'attachment')) {
  const existing = before.items.find((i) => i.key === fixture.key);
  if (existing && !(existing.data.tags as { tag: string }[]).some((t) => t.tag.startsWith('matrix:')))
    await request(`items/${fixture.key}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Unmodified-Since-Version': String(existing.version),
      },
      body: JSON.stringify({ tags: fixture.tags }),
    });
}
for (const [itemKey, f] of files) {
  const current = (await (await zotero.request(`items/${itemKey}`)).json()) as {
    data: Record<string, unknown>;
  };
  const md5 = createHash('md5').update(f.bytes).digest('hex');
  if (current.data.md5 === md5) continue;
  if (current.data.md5 && f.filename === 'snapshot.zip') {
    const archived = await downloadAttachment({ key: itemKey, version: 0, data: current.data }, zotero);
    const saved = execFileSync(
      'python3',
      [
        '-c',
        'import sys,io,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read("snapshot.html"))',
      ],
      { input: archived.bytes },
    );
    if (saved.toString() === html) continue;
  }
  if (current.data.md5) throw new Error(`Existing fixture file ${itemKey} changed; refusing overwrite`);
  const authorization = await request(`items/${itemKey}/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'If-None-Match': '*',
    },
    body: new URLSearchParams({
      md5,
      filename: f.filename,
      filesize: String(f.bytes.length),
      mtime: '1791370800000',
    }),
  });
  const upload = (await authorization.json()) as {
    exists?: number;
    url: string;
    contentType: string;
    prefix: string;
    suffix: string;
    uploadKey: string;
  };
  if (!upload.exists) {
    if (new URL(upload.url).protocol !== 'https:') throw new Error('Invalid upload destination');
    const response = await fetch(upload.url, {
      method: 'POST',
      headers: { 'Content-Type': upload.contentType },
      body: Buffer.concat([Buffer.from(upload.prefix), f.bytes, Buffer.from(upload.suffix)]),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Fixture file upload HTTP ${response.status}`);
    }
    await response.body?.cancel();
    await request(`items/${itemKey}/file`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'If-None-Match': '*',
      },
      body: new URLSearchParams({ upload: upload.uploadKey }),
    });
  }
  console.log(
    JSON.stringify({
      event: 'file-uploaded',
      key: itemKey,
      bytes: f.bytes.length,
      mime: f.mime,
    }),
  );
}
console.log(JSON.stringify({ event: 'fixtures-ready', collectionKey, roots: titles }));
