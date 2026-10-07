import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Resolve from the deployment package, not the root development dependencies.
const require = createRequire(new URL('../.function-package/package.json', import.meta.url));
assert.ok(require.resolve('@llamaindex/liteparse').startsWith(path.resolve('.function-package/node_modules') + path.sep), 'LiteParse must resolve inside the deployment package');
const { LiteParse } = require('@llamaindex/liteparse');
const pkg = JSON.parse(await readFile('.function-package/package.json', 'utf8'));
assert.equal(pkg.dependencies['@llamaindex/liteparse'], '2.15.1');
assert.equal(pkg.dependencies['pdfjs-dist'], undefined);
const parser = new LiteParse({ ocrEnabled: false, outputFormat: 'markdown', imageMode: 'off', quiet: true, poolSize: 1, parseTimeoutMs: 60_000 });
try {
  const { pdfFixture } = await import('../tests/pdf-fixture.ts');
  const result = await parser.parse(pdfFixture([
    'BT /F2 24 Tf 50 740 Td (Packaged PDF smoke test) Tj ET\nBT /F1 12 Tf 50 690 Td (Native PDFium and pooled parsing work in this deployment package.) Tj ET'
  ]));
  assert.match(result.text, /# Packaged PDF smoke test/);
  assert.match(result.text, /Native PDFium/);
  console.log('Packaged LiteParse native PDF and worker-process smoke test passed.');
} finally { parser.close(); }
