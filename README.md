# Research library

Save sources in Zotero, find them with fuzzy search, read their notes, and discuss them in a private React application. Vite builds the frontend; TanStack Router handles navigation and URL state, and TanStack Query manages live API data. Chat uses GPT-6.1 Sol and temporary Azure Container Apps Sandboxes for source evidence. Planning and execution live in the [GitHub map](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/1).

Azure SQL Database owns source notes, human notes, categories, processing records and conversations. Blob Storage retains private original files. Git contains application code and historical Markdown exports, not the live database. Completed processing updates the reader without another static build. See [SQL setup and recovery](docs/sql.md).

## Development

Use Node 22.22.2 or later:

```sh
npm ci
npm run check
npm run build:worker
npm run dev
```

Configure development SQL and storage first using [the local setup instructions](docs/sql.md#local-development). The Vite reader listens on port 4360, with its development API on localhost port 7072. On the m1 host, use `http://m1.saiga-bleak.ts.net:4360`. The local API supplies a development identity and has no Azure authentication boundary. Never deploy it. Model work needs the separate development worker and Foundry settings.

`npm run preview` serves the built static application without a live API or authentication service. Use `npm run dev` for live development workflows. Frontend checks use the explicit reader TypeScript configuration; routes are defined in code and do not require generated route files.

## Private access

Only the invited GitHub accounts `pinaatti` and `DrBushyTop` can enter, and both are admins. Static pages and application assets require `library_member`; the API also checks the GitHub account allowlist and `reader` role. App URLs use authorized rewrites, not an unguarded navigation fallback. The frontend checks the session before mounting private screens, but backend authorization remains authoritative. Deployment previews are disabled.

The access page distinguishes signed-out users, sessions missing roles, and identity-service errors. After an invitation or role change, refresh sign-in explicitly. If different loads report different access, compare the session roles and clear only the app's site cookies if needed; repeated GitHub consent is not a reliable recovery.

## Reader behavior

The app opens into chat. Persistent conversations have `/chat/<conversation-id>/` addresses. Sources uses `/sources/` with source selection and filters in its query string. Categories uses `/categories/`. There are no legacy reader route aliases.

MiniSearch runs in the browser over authorized API data, including metadata, generated analysis, human notes and available extracted text. No private corpus or search index is included in the frontend build. Query invalidation refreshes reading and search after edits.

Human notes remain separate from generated analysis. Saves use revision checks and preserve drafts after conflicts or failures. Categories edits templates, previews a draft without changing saved notes, and explicitly queues reclassification or analysis updates. Saving a template affects future captures; failed document updates leave existing notes readable.

Public publishing is deferred. Only private builds are accepted; the app has no publication controls. Domain rights records and historical exports remain for a future publishing decision.

See [operations](docs/operations.md) for infrastructure and acceptance requirements, [the original brief](research-capture-knowledge-base-plan.md) for historical scope, and [research](docs/research/) for source evidence.
