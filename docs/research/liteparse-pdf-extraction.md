# LiteParse PDF extraction

Checked October 7, 2026.

## What the shared discussion proposes

The [shared conversation](https://chatgpt.com/share/6ac63339-8814-83ed-b96b-93bb7329a28d?ogimg=plain) recommends LiteParse with OCR disabled for PDFs that already contain text. It proposes Markdown for model input and page-level layout blocks for later citations. Its package-size examples describe Python wheels, not this repository's Node deployment.

## Current package and API

The npm registry identifies `@llamaindex/liteparse` 2.15.1 as the current release. The package requires Node 18 or newer and has Apache-2.0 licensing. Its v2 parser uses Rust and PDFium, unlike the older v1 implementation. The registry records release source commit `ab8879623ee45a0b7a775d12b42a9a7ae9dab16b`. [Package metadata](https://registry.npmjs.org/@llamaindex/liteparse/latest), [official repository](https://github.com/run-llama/liteparse).

The Node API accepts a file path, `Buffer`, or `Uint8Array`. Constructor options include `ocrEnabled`, `maxPages`, `outputFormat`, `imageMode`, `extractLinks`, and `extractBlocks`. With `outputFormat: 'markdown'`, `result.text` contains Markdown. Pages also expose `pageNum`, `text`, `markdown`, and text coordinates. `extractBlocks: true` adds classified blocks in reading order, including heading, paragraph, list item, table, and code blocks. Tables contain cells and bounding boxes. Reconstruction remains heuristic and can fail on complex layouts. [Versioned Node documentation](https://github.com/run-llama/liteparse/blob/ab8879623ee45a0b7a775d12b42a9a7ae9dab16b/packages/node/README.md).

`isComplex()` is a separate text-layer inspection pass. It can flag pages that need OCR. It does not itself recover missing text. `parseBatches()` bounds retained page-result memory, but repeated-header removal and image deduplication work only within each batch. Prefer one bounded parse when consistent document formatting matters. [Versioned Node documentation](https://github.com/run-llama/liteparse/blob/ab8879623ee45a0b7a775d12b42a9a7ae9dab16b/packages/node/README.md).

## Deployment and safety

This is a native dependency. The npm package declares optional platform packages for macOS, Linux, and Windows. The matching `.node` addon and PDFium shared library must remain in the installed package. The main package reports about 34.4 MB unpacked, and the Linux x64 glibc platform package reports about 32.6 MB. These are package sizes, not runtime memory measurements. [Main package metadata](https://registry.npmjs.org/@llamaindex/liteparse/latest), [Linux package metadata](https://registry.npmjs.org/@llamaindex/liteparse-linux-x64-gnu/latest).

OCR defaults to enabled. Although the Tesseract engine ships with the library, missing language data triggers a download from GitHub and a write to a local cache. Set `ocrEnabled: false` for the initial migration so parsing remains local and scans keep the existing review fallback. [Tesseract implementation](https://github.com/run-llama/liteparse/blob/ab8879623ee45a0b7a775d12b42a9a7ae9dab16b/crates/liteparse/src/ocr/tesseract.rs).

PDFium serializes parses inside one process. Node pool mode uses child processes and supports a hard `parseTimeoutMs` deadline that kills a stalled worker. The deadline covers parsing, not worker startup or waiting for a free worker. A JavaScript promise timeout alone does not stop native parsing. Pool mode requires the package's `dist/pool-worker.js` file. [Pool implementation](https://github.com/run-llama/liteparse/blob/ab8879623ee45a0b7a775d12b42a9a7ae9dab16b/packages/node/src/pool.ts).

The official Node CI uses Node 20 across supported native platforms. The checked Node documentation does not promise Bun compatibility. This repository targets Node 22, so Bun support is not a migration requirement. [Official Node CI](https://github.com/run-llama/liteparse/blob/ab8879623ee45a0b7a775d12b42a9a7ae9dab16b/.github/workflows/ci-node.yml), [repository package configuration](../../package.json).

## Fit for this repository

The current extractor joins every PDF.js text item with spaces. That discards line structure within a page. LiteParse Markdown directly addresses that behavior without adding a cloud parser or OCR. Keep the existing 200-page, 60,000-character, and 20 MB input limits. Preserve the original PDF and report incomplete coverage rather than treating partial output as a complete extraction. [Current extractor](../../apps/worker/src/extraction.ts).

The worker build keeps dependencies external and then creates a production package. Add LiteParse to its dependency allowlist and verify an actual PDF through that package on Linux CI. A successful macOS import does not establish Linux deployment compatibility. Adding persisted block JSON or a cloud fallback would be separate work, not a prerequisite for replacing the flattened text output. [Worker packaging](../../scripts/build-worker.mjs), [production workflow](../../.github/workflows/production.yml).
