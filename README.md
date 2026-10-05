# Research library

Save sources in Zotero, find them with fuzzy search, read their notes, and ask questions in a private Astro reader. Chat uses the same GPT-6.1 Sol deployment and temporary Azure Container Apps Sandboxes for source evidence. Implementation decisions and execution status live in the [GitHub map](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/1).

The worker observes the whole personal library every five minutes. An optional `ZOTERO_COLLECTION` restricts it later. Blob jobs and queue reconciliation preserve observed work across retries. PDFs and HTML are extracted within limits, analyzed by the configured `gpt-6.1-sol` deployment, and staged privately. An hourly GitHub workflow imports the current candidates, commits their receipts, builds Pagefind and deploys the reader. Manual workflow dispatch refreshes immediately. Capture and cloud synchronization remain independent of processing.

Use Node 22.22.2 or later:

```sh
npm ci
npm run check
npm run build:reader
npm run preview
```

The local preview has no Azure authentication boundary; it is for local development. `npm run dev` runs Astro with live reload and a prebuilt MiniSearch fuzzy index. Search covers metadata, generated notes, human Markdown and available extracted document text. Chat needs the deployed private API. The cloud deployment requires an invitation-assigned `reader` role through GitHub sign-in, including for direct search-index, chat API and asset requests. Private deployment previews are disabled.

Canonical notes live in `content/research/{stable-source-id}/`. `index.md` and `analysis.json` are generated. Edit `notes.md` for personal commentary and `publication.json` for deliberate publishing decisions. Reprocessing preserves both. An edit to a generated file creates an import conflict rather than being overwritten. Raw files stay in private Blob Storage. Extracted source text stays outside Git and enters only the private fuzzy index, matched to the published generation and artifact hash. Public search includes approved notes and human commentary only.

All notes begin private. A public build requires explicit note approval matching both the current source fingerprint and generation, and excludes everything else before route generation and indexing:

```sh
READER_MODE=public npm run build:reader
```

Public mode is a local verification capability. The deployment workflow always builds the private reader. No raw artifacts are served in either mode, even if an artifact has a redistribution approval.

See [operations](docs/operations.md) for infrastructure, identity, replay, reprocessing, conflicts, retention, costs and the remaining human acceptance checks. See [the brief](research-capture-knowledge-base-plan.md) for the original scope and [research](docs/research/) for the technical evidence.
