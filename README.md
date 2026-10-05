# Research library

Save sources in Zotero, then find and read the resulting research notes in a private Astro reader. Implementation decisions and execution status live in the [GitHub map](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/1).

The worker observes the whole personal library every five minutes. An optional `ZOTERO_COLLECTION` restricts it later. Blob jobs and queue reconciliation preserve observed work across retries. PDFs and HTML are extracted within limits, analyzed by the configured `gpt-6.1-sol` deployment, and staged privately. An hourly GitHub workflow imports the current candidates, commits their receipts, builds Pagefind and deploys the reader. Manual workflow dispatch refreshes immediately. Capture and cloud synchronization remain independent of processing.

Use Node 22.22.2 or later:

```sh
npm ci
npm run check
npm run build:reader
npm run preview
```

The local preview has no Azure authentication boundary; it is for local development. `npm run dev` runs Astro with live reload; full-text search needs the built Pagefind files, so use the built preview to exercise search. The cloud deployment requires an invitation-assigned `reader` role through GitHub sign-in, including for direct search-index and asset requests. Private previews are disabled.

Canonical content lives in `content/research/{stable-source-id}/`. `index.md` and `analysis.json` are generated. Edit `notes.md` for personal commentary and `publication.json` for deliberate publishing decisions. Reprocessing preserves both. An edit to a generated file creates an import conflict rather than being overwritten. Raw files and extracted full text stay outside Git and the reader.

All notes begin private. A public build uses explicit note approval matching the current source fingerprint and excludes everything else before route generation and indexing:

```sh
READER_MODE=public npm run build:reader
```

Public mode is a local verification capability. The deployment workflow always builds the private reader. No raw artifacts are served in either mode, even if an artifact has a redistribution approval.

See [operations](docs/operations.md) for infrastructure, identity, replay, reprocessing, conflicts, retention, costs and the remaining human acceptance checks. See [the brief](research-capture-knowledge-base-plan.md) for the original scope and [research](docs/research/) for the technical evidence.
