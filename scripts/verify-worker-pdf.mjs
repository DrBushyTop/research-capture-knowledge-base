import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import path from 'node:path';

// Resolve from the deployment package, not the root development dependencies.
const require = createRequire(new URL('../.function-package/package.json', import.meta.url));
assert.ok(require.resolve('@llamaindex/liteparse').startsWith(path.resolve('.function-package/node_modules') + path.sep), 'LiteParse must resolve inside the deployment package');
const { LiteParse } = require('@llamaindex/liteparse');
const pkg = JSON.parse(await readFile('.function-package/package.json', 'utf8'));
assert.equal(pkg.dependencies['@llamaindex/liteparse'], '2.15.1');
assert.equal(pkg.dependencies['pdfjs-dist'], undefined);
const parser = new LiteParse({ ocrEnabled: false, outputFormat: 'markdown', imageMode: 'off', quiet: true, poolSize: 1, parseTimeoutMs: 120_000 });
try {
  const { pdfFixture } = await import('../tests/pdf-fixture.ts');
  const result = await parser.parse(pdfFixture([
    'BT /F2 24 Tf 50 740 Td (Packaged PDF smoke test) Tj ET\nBT /F1 12 Tf 50 690 Td (Native PDFium and pooled parsing work in this deployment package.) Tj ET'
  ]));
  assert.match(result.text, /# Packaged PDF smoke test/);
  assert.match(result.text, /Native PDFium/);
  console.log('Packaged LiteParse native PDF and worker-process smoke test passed.');
} finally { parser.close(); }

for (const name of ['mammoth', 'yauzl']) {
  assert.ok(require.resolve(name).startsWith(path.resolve('.function-package/node_modules') + path.sep), `${name} must resolve inside the deployment package`);
}
const { docxFixture } = await import('../tests/docx-fixture.ts');
const converted = await require('mammoth').convertToHtml({ buffer: docxFixture() });
assert.match(converted.value, /<h1>Synthetic field observations<\/h1>/);
assert.match(converted.value, /<table>/);
assert.match(converted.value, /Afternoon/);
const archive = await require('yauzl').fromBufferPromise(docxFixture());
try {
  const names = [];
  for await (const entry of archive.eachEntry()) names.push(entry.fileName);
  assert.ok(names.includes('word/document.xml'));
} finally { archive.close(); }
console.log('Packaged DOCX heading, paragraph and table extraction smoke test passed.');

await new Promise((resolve, reject) => {
  const worker = fork(new URL('../.function-package/dist/pdf-document-worker.mjs', import.meta.url), {
    serialization: 'advanced', execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  let finished = false;
  const finish = error => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    worker.kill('SIGKILL');
    if (error) reject(error); else resolve();
  };
  const timer = setTimeout(() => finish(new Error('Packaged full-text worker timed out')), 120_000);
  let pageText = '';
  worker.on('error', finish);
  worker.on('exit', () => { if (!finished) finish(new Error('Packaged full-text worker exited early')); });
  worker.on('message', message => {
    if (message.type === 'pages') pageText += message.sections.map(section => section.text).join('\n');
    if (message.type === 'error') finish(new Error(message.reason));
    if (message.type === 'done') {
      try { assert.equal(message.complete, true); assert.match(pageText, /Packaged full-text batch worker/); finish(); }
      catch (error) { finish(error); }
    }
  });
  import('../tests/pdf-fixture.ts').then(({ pdfFixture }) => worker.send({
    bytes: pdfFixture(['BT /F1 12 Tf 50 700 Td (Packaged full-text batch worker retains native PDF text without OCR.) Tj ET']),
    pageLimit: 2000, textByteLimit: 40 * 1024 * 1024
  }), finish);
});
console.log('Packaged isolated full-text PDF batch worker smoke test passed.');
