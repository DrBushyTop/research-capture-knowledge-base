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

The local preview has no Azure authentication boundary and is for local development. `npm run dev` runs Astro with live reload and a MiniSearch fuzzy index. Search covers metadata, generated notes, human Markdown and available extracted document text. Chat needs the deployed private API. The cloud deployment admits only the invited GitHub accounts `pinaatti` and `DrBushyTop`. Both can edit categories and start document updates. Static routes, direct indexes and assets require the `library_member` role assigned only to these two accounts. API routes also check the GitHub username allowlist and `reader` role. Deployment previews are disabled.

Canonical notes live in `content/research/{stable-source-id}/`. `index.md` and `analysis.json` are generated. Edit `notes.md` for personal commentary. Reprocessing preserves human notes and saved rights metadata. Edits to generated files create import conflicts rather than being overwritten. Raw files and extracted source text remain in private Blob Storage, outside Git.

The Categories page edits names, routing descriptions and ordered analysis sections without repository access. Presets cover research, news, recipes, guides, social posts and other material. New captures are classified automatically. Settings and immutable template revisions live in existing private Blob Storage; no additional database is needed. A preview calls the model without changing a note. Saving affects future captures, and selected existing documents can be re-evaluated explicitly. Failed updates keep the current note readable.

Source pages support shared reader notes without switching to Zotero. Saves use revision checks, retain drafts on failure, and keep reader commentary separate from generated analysis. Chat reads saved reader notes immediately. The scheduled importer copies them into a marked section of `notes.md` for Git history and the next search rebuild. Existing notes without categories need an explicit "Check categories" update.

Public publishing is deferred. The build accepts private mode only, and the current UI has no publication controls. Existing rights records remain available for a future publishing design.

See [operations](docs/operations.md) for infrastructure, identity, replay, reprocessing, conflicts, retention, costs and the remaining human acceptance checks. See [the brief](research-capture-knowledge-base-plan.md) for the original scope and [research](docs/research/) for the technical evidence.
