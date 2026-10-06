# Development operations

The GitHub map is the canonical plan and ticket tracker. This file explains how to operate the implementation.

## Deployment and identity

Development resources use `rg-research-kb-dev` in Sweden Central in the selected Microsoft Azure Sponsorship subscription. `infra/main.bicep` creates private Storage containers and queues, on-demand Functions Flex, a consumption-based Foundry/OpenAI deployment, capped diagnostics, managed identities, GitHub federation and Static Web Apps Free. The pre-existing vault is `kv-research-dev-16681c6a`.

```sh
az deployment group create \
  --resource-group rg-research-kb-dev \
  --template-file infra/main.bicep \
  --parameters bootstrapPrincipalId=YOUR_AZURE_OBJECT_ID
```

Run provisioning with the intended Azure subscription selected. The initial deployment used subscription `ede0939c-80c4-4dfe-bf3d-84521f3f6d1f`. Bicep deployment output gives resource names and GitHub identity values. The workflow variables are `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `STORAGE_ACCOUNT` and `FUNCTION_APP`. `SWA_DEPLOYMENT_TOKEN` is a GitHub Actions secret; retrieve it through Azure CLI and pass it directly to `gh secret set`, without printing or writing it into repository files.

The worker identity reads only `zotero-account-id` and `zotero-api-key` in Key Vault. It has private storage and inference access. It cannot read the account password or the separate development test-data write key. The importer identity can access the pipeline and deployment containers and deploy the Function App; it has no raw-container, Zotero or vault permissions. Repository writes use the job's scoped GitHub workflow token. Federation trusts master in this private repository with GitHub's immutable owner/repository ID subject. See [GitHub OIDC subjects](https://docs.github.com/en/actions/reference/security/oidc). The githubSubject Bicep parameter must match the workflow token; PR checks have no cloud login or deployment secrets.

The deployed model is `gpt-6.1-sol`, version `2026-09-29`, named `research-sol`, using EU DataZoneStandard. Capacity 1000 allocates 1,000,000 tokens/minute of throughput. The user selected Sol and authorized ample quota. It is not a provisioned-compute deployment. The schema limits source input to 60,000 characters and generation to 16,000 completion/reasoning tokens; refused, incomplete and invalid responses do not become successful analyses.

## Observation and recovery

Cloud metadata and synced files can arrive at different times. The guarantee begins when the poller persists recoverable work. A capture permanently deleted before observation, or a transient collection membership, is not recoverable through current-state polling. The desktop Connector and its file-sync behavior still need user acceptance.

Blob Storage holds immutable snapshots, jobs and analyses, desired-generation pointers, a checkpoint, staging and conflict records. A discovery lease rejects overlap and older observations. Jobs are persisted before checkpoint advancement; queue handoff is reconciled independently. Messages contain only identifiers and have non-expiring TTL. A poison message does not erase its durable job. Unexpected worker failures stop after five recorded attempts. Reconciliation also stops after twenty persisted handoff attempts, including failures before worker startup. Failed jobs require operator replay. Queue delivery has no ordering guarantee.

The importer checks desired generations while holding the discovery lease, verifies generated-file hashes, commits the complete Markdown/JSON/receipt set without force-pushing, then acknowledges cloud jobs. A crash after a push is recovered through the committed receipt. Receipt recovery checks both generated files, including missing files. Lease loss aborts inference and Git commands; every mutable write renews its active leases, uses the ETag observed under that lease, and has a timeout shorter than the lease duration. Git commands run asynchronously so lease renewal continues during a push. The same workflow explicitly builds and deploys because commits made with its default token do not trigger another push workflow. A deployment failure is retried from committed corpus content.

Set `STORAGE_ACCOUNT` and authenticate with Azure CLI for operator commands:

```sh
npm run operate -- status
npm run operate -- replay JOB_ID
npm run operate -- reprocess SOURCE_ID
```

Replay resumes a durable job after infrastructure failure and keeps any cached analysis. Reprocess creates a new generation to retry extraction or replace a failed/outdated analysis. Global `PROCESSING_VERSION` changes force observation and fresh generations. Keep the runtime's configuration and Bicep processing version aligned. Stale generations cannot replace the currently desired generation.

An import conflict appears under `conflicts/{sourceId}.json`. Move intentional edits from generated files into `notes.md`, restore the generated files and receipt from Git, and dispatch the importer again. Do not remove a receipt to bypass the hash check. Human notes and publication decisions are preserved even for tombstoned sources; tombstones hide them from readers.

## Evidence and retention

Source downloads are limited to 20 MB and public HTTP(S) destinations. Every redirect is checked, validated DNS addresses are pinned to sockets, and API credentials never follow file redirects. HTML scripts and resource loading are disabled. PDF extraction uses at most 200 pages. Scans, locked or malformed files, blocked pages and unsupported formats become explicit review or metadata-only notes. OCR is outside this MVP. Synced-file absence and transient inference failures have bounded retry before review. Ingestion gives the model no tools. Chat exposes only the fixed read operations described below.

Raw files are private Blob objects addressed by hash. Active artifacts are retained until deliberate operator deletion. Source deletion hides notes but does not silently erase archived evidence or human commentary. Storage has seven-day soft deletion. Explicit deletion of raw objects should follow a retention decision; no automatic archive purge is configured. Staged validated analysis avoids repeating successful paid inference after repository failures.

Crossref DOI license metadata is recorded as external evidence, not permission to redistribute an arbitrary captured PDF. Note approval and exact-artifact approval are separate fields. Note approval requires both the source fingerprint and the exact approvedGenerationId. Any regeneration, including manual reprocessing, expires old approval. Legacy approval files without a generation fail closed. Missing or stale approval excludes a note from public builds. Public builds serve no raw downloads. Invited readers can open retained PDFs through the owned chat file API.

## Cost and acceptance

Functions has no always-ready instances. The hourly importer avoids five-minute GitHub builds; scheduled imports skip the code verification job, while source pushes run full checks. Private Actions minute allowances, storage operations, inference tokens and consumption execution are metered; observe actual usage before changing frequency. Diagnostic ingestion is capped at 0.1 GB/day with 30-day retention; a reached cap can limit diagnostics. Never log credentials, source text, raw responses or signed download URLs.

Manual acceptance still includes signing into the invited reader account, checking an unintended signed-in account, desktop Connector capture and comfortable reading on the actual Android device. Automation validates cloud captures, generated content, search/filter behavior, public-build exclusion and anonymous direct-asset access; it must not claim those human interactions occurred.

## Fuzzy search

The collection uses a prebuilt MiniSearch inverted index in the browser, with prefix matching, typo tolerance and boosted title/topic fields. It makes no model or backend calls. Source type, topic and year filters apply to the fuzzy results. Metadata, generated analysis and human Markdown are always indexed. Private builds also include extracted PDF, HTML, Markdown, plain text, CSV and JSON content when available, bounded to 60,000 characters per source. Scanned PDFs and chart images have no searchable text unless a text layer is present; chat can inspect pages and images when the model needs them.

The worker stores immutable `source-text/{generationId}.json` objects in the private pipeline container before inference. Build-time source identity, generation and artifact-hash checks reject mismatched text. The deployment workflow sets `SEARCH_SOURCE_TEXT=azure` and reads only the pipeline container. It cannot read raw files. Local development reads the ignored `.local/search-source-text` cache. Backfill existing archived sources without inference using `STORAGE_ACCOUNT=ACCOUNT npx tsx scripts/backfill-search-text.ts` while signed into Azure as the operator. This also fills the local cache.

Public builds index approved notes and human commentary only, even when private text is cached or Azure credentials are present. They never fetch original document text. `check:public` checks routes and index membership and excludes chat routes/scripts. Development indexing runs when `npm run dev` starts; restart after changing corpus files.

## Private dataset chat

The private `/chat/` route submits a question to the Static Web Apps managed API. The proxy checks the invitation-assigned reader role and same-origin POST, then forwards the platform principal with a dedicated function key to the Functions gateway. The gateway checks the role again and binds results to a hash of the signed-in user's provider and ID. The function key stays in server-side SWA application settings. No Azure or model credentials enter the browser or sandbox.

The gateway writes a durable message before queue handoff and returns 202. The React UI polls for completion and tool activity. This keeps requests within the managed API's 45-second limit and avoids paid Static Web Apps hosting. The recovery timer runs independently of Zotero, retries missing handoffs, and stops jobs after two attempts or ten minutes. A reader can run one answer at a time and submit twenty per hour. Messages are capped at 8,000 characters. Stop records cancellation, aborts active model and sandbox work, and leaves the conversation usable. [Managed API limits](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview).

Chat is a freeform discussion with the same Sol deployment. Each turn includes recent server-owned conversation history. Sol chooses whether to call `search_corpus`, `read_source` or `inspect_media`. Search covers metadata, original extracted text, generated analysis and human Markdown. Empty searches list sources; results can be paginated. Reading can select original documents, analysis, notes or facts. PDF reads can search matching pages or request a particular page. Inspection sends the actual rendered page or image to Sol and registers a file the answer or citation can display. No source or page selectors appear in the UI.

The native agent uses Azure's `/openai/v1/responses` endpoint with medium reasoning and strict JSON output. `store:false` keeps conversation storage in our existing Blob container. Encrypted reasoning items remain in memory between tool rounds. A live check confirmed that this Sol deployment rejects reasoning plus function tools on Chat Completions. Responses supports both. The loop permits eight read operations and two answer-validation corrections, with a 6,000-token output cap per model round. Recent history includes at most twenty turns and 100,000 serialized characters; the complete text context is capped at 300,000 characters. Image bytes and encrypted reasoning are counted by the API rather than that text limit. [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses).

After a successful private deployment, `scripts/sync-chat-corpus.ts` saves the exact Git revision, validated notes, human Markdown and matching private document-content index in the pipeline container. It rejects an index built for different source membership. The immutable snapshot ID hashes the Git revision, notes and actual index, so a document-text backfill produces a new snapshot even at the same commit. Each message pins this snapshot. Read and inspect tools upload hash-checked retained artifacts into temporary Azure Container Apps Sandboxes and run the fixed Python driver. Original extraction is limited to 20 MB and 200 PDF pages. Each read returns bounded passages; the model can request another page. Images render to bounded PNGs. Unsupported file types have metadata or generated notes only. There is no Office-file parser or automatic whole-document OCR.

The sandbox group has no managed identity, application credentials or external network access. No arbitrary model-generated code, shell commands, Git writes or package installation run in it. The current regional tooling snapshot is `4daeeb76-0b95-4d8b-9c36-32ea7167fcde`, with Python and PyMuPDF 1.26.7. It was created before any corpus upload. A recreated clean snapshot can be selected with the `sandboxSnapshot` Bicep parameter. Do not snapshot a message workspace. [Snapshot lifecycle](https://sandboxes.azure.com/docs/sandboxes/snapshots).

Each restored sandbox uses 250m CPU, 512 MiB RAM and 5 GiB disk. Functions records the ID before polling, sets a two-minute idle stop and ten-minute automatic deletion policy, and deletes the workspace before calling Sol again. Creation, deletion, file transfers and egress setup use bounded REST requests. This beta SDK drops some request abort signals and treats JSON file downloads as empty binary content, so those operations use bounded REST calls. A recovery sweep also deletes group instances older than ten minutes, including creations whose initial HTTP response was lost. Thus model latency does not hold sandbox compute. The tested SDK is `@azure/containerapps-sandbox` 1.0.0-beta.1 with the preview data API, accepted by the user. Sweden Central currently has one SandboxCore of quota in this subscription. [Sandbox costs](https://sandboxes.azure.com/docs/sandboxes/cost).

Sol returns evidence IDs, optional exact quotes and optional registered attachment IDs. The server rejects unknown citations, unmatched quotes, undeclared inline citations and invented attachments. General discussion can proceed without a corpus citation. Validation checks evidence membership and quoted text, not every interpretation. Citations retain source generation, supporting links and image IDs. PDF downloads use the cited generation even after a source changes. File endpoints check the reader's ownership and the answer's citation or attachment membership before returning bytes; nothing enters the public reader output.

Selected Vercel AI Elements conversation, Markdown message and citation primitives run in an Astro React island. Phone citations open an evidence sheet; desktop citations open on mouse hover or activation with a click, tap or keyboard. Supporting material includes excerpts, notes, sites, PDFs and rendered images. The bottom composer supports multiline phone input, desktop Enter to send, Shift+Enter for a newline, IME input and a Stop control. Phone image viewing uses the full screen, starts at full width, and supports pinch, double-tap, drag panning, keyboard controls and visible zoom buttons. The UI restores conversation history and an active job across reloads. It displays completed answers after validation rather than simulating token streaming.

After the first Functions deployment, configure SWA server settings `CHAT_BACKEND_URL`, `CHAT_BACKEND_KEY` and `READER_ORIGIN`. Generate a function-level key named `swa-proxy` for `chatGateway`; do not use a host master key. Pass the key directly to SWA application settings without printing it or committing it. Bicep provisions the queues, group-scoped worker role, runtime settings and Blob lifecycle rule. Message, conversation and file APIs expire after 24 hours from creation. Blob lifecycle removes old jobs, conversations, temporary files, cancellation flags and quota records after a day, subject to its asynchronous sweep and the account's seven-day soft-delete retention. Git notes and archived source artifacts keep their existing retention.
