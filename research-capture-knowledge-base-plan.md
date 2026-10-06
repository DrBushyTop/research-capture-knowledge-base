# Research capture and knowledge base implementation brief

**Status:** Initial MVP implemented; category and template extension planned

**Updated:** 2026-10-06
**Primary goal:** Make saving and revisiting sources easy, while keeping processing, storage, search, presentation, and future publishing under our control.

Sections 4 and 7 describe the planned category-aware data model. The deployed version still uses a single research-oriented analysis schema. Section 14 lists the work needed to implement the extension.

## 1. Product idea

Build a small personal knowledge base for collecting and revisiting sources found on the web.

The main user is non-technical. **Capture must be essentially one action**:

- Desktop browser: click the Zotero browser extension.
- Phone: Share → Zotero.
- Saving must feel immediate.
- No AI processing, tagging, form filling, or waiting should block capture.

The system then processes saved items asynchronously and turns them into a structured, searchable research corpus.

Likely source types include:

- research papers;
- PDFs;
- ordinary webpages;
- news/articles/blog posts;
- recipes;
- social posts;
- tutorials and guides;
- other reference material encountered while researching a topic.

An initial use case is research around fibromyalgia. Saved content also includes cooking, news, social posts and other interests. Analysis sections must suit the content rather than assume every source reports a study.

The resulting corpus should be:

- easy to read;
- full-text searchable;
- structured enough for filtering and later analysis;
- editable as plain files;
- usable from Obsidian if desired;
- renderable as a custom Astro application;
- potentially publishable later, with licensing restrictions respected.

---

## 2. Core architectural principle

**Zotero is the capture inbox, not the knowledge base.**

Zotero solves the annoying cross-device ingestion problem:

- browser extension on desktop;
- OS share target on mobile;
- scholarly metadata extraction;
- DOI/author/journal metadata where available;
- PDF capture;
- generic webpage capture and snapshots.

Everything after capture belongs to our system.

Conceptually:

```text
                   CAPTURE
                      |
          +-----------+-----------+
          |                       |
 Desktop browser             Phone browser
 Zotero Connector             Share -> Zotero
          |                       |
          +-----------+-----------+
                      |
                 Zotero library
                 ("Research Inbox")
                      |
                 Zotero Web API
                      |
                      v
              Ingestion pipeline
                      |
          +-----------+-----------+
          |                       |
     source storage           AI enrichment
          |                       |
          +-----------+-----------+
                      |
                 Markdown + JSON
                      |
             Git repository content
                /              \
               /                \
          Obsidian             Astro
        edit/search       primary reading UX
```

The user should normally only interact with:

1. **Zotero when saving**, and
2. **the Astro site when reading/searching**.

Obsidian is optional and mainly useful for power-user editing, inspection, linking, and search.

---

## 3. Repository model

Keep the application, infrastructure, and processed knowledge corpus in one monorepo.

Suggested layout:

```text
/
├── apps/
│   ├── web/                     # Astro frontend
│   └── ingestion/               # Azure Functions app
│
├── content/
│   └── research/                # Canonical human-readable corpus
│       └── <topic>/
│           └── <source-slug>/
│               ├── index.md
│               ├── analysis.json
│               └── visualizations.json
│
├── packages/
│   ├── domain/                  # Shared schemas/types if useful
│   └── content-schema/          # Content validation/schema
│
├── infra/
│   ├── main.bicep
│   └── modules/
│
├── scripts/                     # Import, repair, migration utilities
│
└── README.md
```

### Important distinction

Keep **processed text and structured metadata in Git**.

Do **not** normally commit raw PDFs, captured HTML snapshots, or other large/licensed source files to Git.

Those belong in private object storage, or may remain in Zotero if no separate copy is needed.

This gives us:

```text
Git repository
  -> Markdown
  -> JSON
  -> schemas
  -> application code
  -> infrastructure

Private Blob Storage
  -> PDFs
  -> HTML snapshots
  -> extracted source artifacts
  -> other binary/raw material
```

---

## 4. Canonical content format

Use **plain Markdown (`.md`) as the canonical human-readable format**, not MDX.

Reasons:

- works naturally in Obsidian;
- easy to diff and version in Git;
- portable to future tools;
- trivially readable outside this application;
- Astro handles Markdown well;
- avoids putting executable application code inside AI-generated research content.

Use front matter for reasonably small/queryable metadata.

Example:

```yaml
---
id: zotero-ABC123
title: "Example recipe"
source_type: webpage
source_url: "https://example.org/recipe"
doi: null
captured_at: 2026-10-05T09:30:00Z
published_at: 2026-04-12

authors:
  - Jane Example
  - John Example

topics:
  - cooking
  - weeknight-meals

category: recipe
template_revision: 2
category_assignment: automatic
evidence_status: text

publication:
  status: link-only
  license: unknown

processing:
  version: 1
  model: "<deployment/model identifier>"
---
```

Then normal Markdown:

```markdown
# Example recipe

## Summary

...

## Ingredients

...

## Steps

...

## Time and servings

...

## Source

...
```

### Structured sidecars

Do not force complex machine-readable material into YAML.

Use sidecar JSON where useful:

```text
index.md
analysis.json
visualizations.json
```

Keep source identity, bibliographic facts, original Zotero item type, retained artifacts, extraction status, rights evidence and human commentary independent of category. A PDF is a file format; its content might be research, a recipe or a guide. Topics describe subjects and remain separate from the single category that chooses an analysis template.

Every generated note records its category, assignment method and exact template revision. It also records the section labels and display formats used at generation time, so an older note remains readable after the admin edits its template. Use stable section identifiers; labels can change without breaking stored values.

For example, the analysis inside `analysis.json` may contain:

```json
{
  "summary": "A recipe for an example dish.",
  "topics": ["cooking"],
  "categoryId": "recipe",
  "templateRevision": 2,
  "sections": [
    {
      "id": "ingredients",
      "heading": "Ingredients",
      "format": "bullets",
      "text": null,
      "items": ["Ingredient amounts reported by the source"]
    },
    {
      "id": "steps",
      "heading": "Steps",
      "format": "steps",
      "text": null,
      "items": ["Instructions reported by the source"]
    }
  ]
}
```

This example describes the planned model, not the existing schema. The backend takes section identifiers, headings and formats from the selected template and validates the model's section values. The model does not invent the note layout. Section values initially support text, bullets and numbered steps; a visual schema builder is unnecessary.

Markdown and the reader render the same sections. Missing source facts stay missing. A recipe has no compulsory study-design or participant fields, and an inaccessible social post must not acquire invented captions or media. Extraction status and provenance remain visible for every category.

---

## 5. MDX and visualizations

Do **not** use MDX as the default generated format.

If we later need custom charts or visualizations, store declarative data/specifications and render them using trusted frontend components.

Preferred:

```text
AI -> structured JSON / Vega-Lite-like spec -> trusted Astro component -> visualization
```

Avoid:

```text
AI -> executable JSX/MDX -> application build/runtime
```

Hand-authored special pages may use MDX later, but generated research items should remain Markdown + structured data.

---

## 6. Ingestion workflow

### 6.1 Capture

The user saves something to Zotero.

Examples:

```text
Desktop:
page/paper/PDF -> click Zotero Connector

Android/iOS:
page/paper/PDF -> Share -> Zotero
```

There should be no requirement to:

- choose tags;
- write a summary;
- categorize the source;
- wait for an LLM;
- understand the storage structure.

A single default collection such as **Research Inbox** is enough initially.

### 6.2 Detect new Zotero items

An Azure Function periodically polls the Zotero Web API.

Store a cursor/version/checkpoint so each poll requests or processes only changes since the previous successful run.

Suggested interval: 5–15 minutes. Exact latency is not important.

The poller should:

1. query Zotero for new/changed inbox items;
2. create an internal source identifier;
3. persist minimal ingestion state;
4. enqueue a lightweight processing message.

### 6.3 Queue

Use **Azure Queue Storage initially**, not Service Bus.

A queue message should contain only identifiers and small metadata, for example:

```json
{
  "sourceId": "zotero-ABC123",
  "zoteroItemKey": "ABC123",
  "operation": "process"
}
```

Do not put PDFs or full source text in queue messages.

Queue semantics should assume **at-least-once processing**. The worker must therefore be idempotent.

A deterministic `sourceId` / Zotero item key plus processing version should make repeat processing safe.

### 6.4 Process source

The queue-triggered worker should:

1. retrieve current Zotero metadata;
2. identify available artifact formats;
3. obtain source content;
4. preserve a private raw source if appropriate;
5. enrich bibliographic metadata;
6. classify the source into an enabled category, respecting any admin override;
7. analyse the source with that category's pinned template revision and validate the structured output;
8. generate/update Markdown and JSON;
9. update processing state;
10. trigger or allow the frontend to rebuild.

For papers, enrichment may include DOI-based services such as Crossref/OpenAlex/Unpaywall.

For ordinary webpages, perform normal article/content extraction.

### 6.5 Writing processed content back to Git

The desired canonical processed corpus lives in this repository.

The ingestion service therefore needs a controlled mechanism to update `content/research`.

Possible implementation approaches:

**Option A — GitHub App / repository API**
- worker creates/updates files directly;
- good near-real-time behavior;
- requires repository write credentials/installation;
- preferred if automatic commits are acceptable.

**Option B — staging data in Storage + scheduled GitHub Action**
- worker writes normalized results to Blob Storage;
- GitHub Action periodically imports staged results and commits them;
- more moving parts but isolates repository credentials.

Start with the simplest implementation that is reliable. Repository writes should be deterministic and idempotent.

Generated commits should be clearly identifiable, e.g.:

```text
research: ingest Zotero item ABC123
```

---

## 7. AI enrichment requirements

AI processing must happen **after successful capture**.

Use structured outputs rather than asking the model to directly author uncontrolled Markdown/front matter. Keep a shared summary and topics, then generate the selected template's sections. Research-specific fields belong in the research template, with clinical study details only where the source reports them.

### 7.1 Categories and templates

Start with these editable presets. The section examples are useful defaults, not fields every source must fill.

| Category | Example sections |
|---|---|
| Research | Question, methods, findings, limitations, funding |
| News | What happened, dates and people, reported claims, attribution |
| Recipe | Ingredients, steps, time and servings, substitutions |
| Guide | Purpose, prerequisites, instructions, cautions |
| Social post | Caption, creator, linked material, context |
| Other | Summary, key points |

The non-technical admin edits these through a private **Categories** page in the app. Each category has a name and a short description of what belongs in it. Its template has ordered sections with a heading, plain-language instructions and a display choice of text, bullets or numbered steps. For example, "Ingredients" can instruct the model to "List each ingredient and its amount. Preserve the units used in the source."

Support adding a category, duplicating a preset, adding or removing sections, reordering sections and previewing a draft against a chosen saved source. Show the generated sample before saving. A preview is a model call; saving only applies the settings and does not overwrite the sampled note. Drafts and validation errors must preserve the admin's edits.

The UI requires no prompt syntax, JSON, Git access or database concepts. Labels should describe actions, such as "Add category", "Add section", "Preview" and "Save". Avoid introductory slogans. The editor and preview must work on a phone.

Keep a permanent Other fallback. Archive unused categories rather than delete revisions referenced by existing notes. Archived categories receive no new automatic assignments. Notes already assigned to them remain readable; offer an explicit move to another category with re-evaluation.

### 7.2 Classification before analysis

After extraction, make a small classification call using the source facts, bounded available text and enabled category descriptions. Use the same configured model. Ask it to choose one known category identifier and give a short reason. Cache that result for the source fingerprint and category-routing revision, then make the analysis call with the selected template. This adds a classification call for new or deliberately reclassified material, not for every queue retry.

Use Zotero item type as a hint. Do not treat every webpage as Other or every PDF as Research. A recipe saved as a webpage should select Recipe. Category names and descriptions guide routing; section instructions guide analysis. Model output cannot create categories or alter templates.

Allow the admin to change a source's category in its note. Record the assignment as manual and preserve it through future automatic classification. Unsupported or ambiguous captures use Other with an honest explanation. Missing source text must remain explicit; classification from metadata does not justify inventing the source's contents.

Treat source text as untrusted data. Keep template instructions separate from it, validate returned section identifiers and values against the pinned template, and escape generated content for Markdown and HTML. Template editing does not grant code execution, additional tools or publication rights.

### 7.3 Changes and re-evaluation

Saving a change creates a new immutable template revision. Before applying it, show the number of affected notes and offer:

- **Apply to future captures**. Existing notes keep their recorded revision and appear in an "Older template" filter.
- **Re-evaluate existing documents**. Choose all affected notes or a subset, preview one result, then start a background batch. Show the number of documents that will make model calls before starting.

Re-evaluation uses retained source material where available. It preserves human notes, source facts, original artifacts and category overrides. Keep the existing published note readable until a validated replacement has been imported and deployed. Failed documents retain their earlier note and can be retried individually.

Show batch progress with completed, pending and failed counts. Allow the admin to stop work that has not started. Bound concurrency and retries. Each batch pins its target template revision; editing the template again cannot change jobs already running. Duplicate requests or queue deliveries must reuse the same job and cached successful output.

Adding a category or changing its routing description can also offer **Check categories** for existing automatically assigned sources. Keep this separate from updating the analysis of sources already in a category. A new Recipe category could reclassify earlier Other notes, while changing Recipe's ingredient instructions should only re-evaluate Recipe notes. Manual assignments are preserved unless the admin explicitly includes them.

Include the category identifier, template revision, assignment revision and processing version in generation identity, alongside the source fingerprint. A source or assignment changed during a batch supersedes the earlier job; an older result cannot replace it. Track the desired generation separately from the currently readable generation. A regenerated note expires its previous public approval under the existing rules.

### 7.4 Configuration storage and admin access

Store live category settings and immutable revisions in the existing private Blob Storage, behind authenticated Function endpoints. The browser edits forms and the API reads and writes the configuration. Git remains the generated corpus store and is not the settings UI. A separate database is not required for these infrequent edits by one admin.

Use conditional writes for concurrent tabs and retain previous revisions. If settings changed while a form was open, show the conflict and preserve the unsaved draft. Keep source assignments and bulk-job records in private durable storage alongside existing ingestion state. Configuration and template history must not inherit the short retention used for chat.

Only the designated GitHub admin identity can change settings, assign categories or start re-evaluation. Check this on the server; hiding the editor link is insufficient. Existing reader access does not confer admin access.

The static reader refreshes through the existing import and deployment workflow. Show "Processing" and "Updating reader" as separate states so completing model calls does not imply the deployed site has changed. Search and chat consume the same deployed note generations and all template sections, while preserving the distinction between source text and generated interpretation.

Do not treat AI output as authoritative scientific or licensing metadata. Preserve provenance and distinguish:

- source metadata;
- externally retrieved metadata;
- AI-derived interpretation;
- human-written notes.

Store the model/deployment and processing-version identifiers so content can later be reprocessed.

---

## 8. Rights, licensing, and public publishing

The private research archive and the public site are separate concerns.

A captured PDF or webpage snapshot being privately available does **not** imply that it can be redistributed.

Use an explicit publishing status:

```text
ALLOW
  Exact source/version has a compatible redistribution license.

LINK_ONLY
  Public metadata/summary can be shown and the lawful source linked,
  but our stored copy is not redistributed.

PRIVATE
  Source is intentionally private/non-publishable.

UNKNOWN
  Rights cannot be established.
  Treat the same as PRIVATE for redistribution.
```

Default to conservative behavior.

The public-facing application may generally expose:

- title;
- authors;
- citation;
- DOI;
- original URL;
- our own categories/tags;
- our own summaries/commentary;
- links to lawful open-access copies.

It should **not automatically expose**:

- captured publisher PDFs;
- complete copied article text;
- private webpage snapshots.

Licensing decisions should be based on deterministic metadata/rules where possible. AI may assist classification but must not be the final publishing gate.

---

## 9. Reading/search UX

### Primary reader: Astro

The custom Astro site should be the preferred reading interface.

Initial requirements:

- clean article/research-page presentation;
- global text search;
- filter by topic;
- filter by source type;
- filter by date/year;
- link to original source;
- indicate paper/webpage/news/etc.;
- display AI summary separately from source facts;
- show useful paper metadata where available;
- work well on desktop and phone.

Later possibilities:

- relationships between sources;
- timelines;
- evidence tables;
- generated visualizations;
- topic overview pages;
- investigation/research collections;
- public/private content modes.

### Search

For an initially static site, prefer a static client-side search index before adding a database/search service.

Candidates include:

- Pagefind;
- Astro-compatible static search/index generation.

Only introduce Azure AI Search or another hosted search service if the corpus or desired semantic-search behavior actually justifies it.

### Obsidian

The `content/research` tree should also be directly usable as an Obsidian vault or vault subfolder.

Obsidian is useful for:

- full-text search;
- editing;
- links/backlinks;
- properties;
- Bases/database-like views.

It is not required to be the primary polished reading UX.

---

## 10. Azure infrastructure

Optimize for **low fixed cost and low maintenance**, not enterprise complexity.

### Recommended MVP resources

```text
Azure Static Web Apps (Free)
  -> Astro frontend

Azure Functions — Flex Consumption, on-demand
  -> Zotero polling
  -> queue-triggered processing
  -> optional administrative HTTP endpoints

Azure Storage account (GPv2, LRS)
  -> Queue Storage
  -> private Blob containers for raw sources/artifacts
  -> Function runtime storage as appropriate

Azure AI Foundry deployment
  -> source analysis / summarization / structured enrichment

Application Insights
  -> basic diagnostics within free/low-volume usage
```

### Why Static Web Apps

Azure Static Web Apps currently has a Free plan intended for personal projects. It provides GitHub integration, globally distributed static hosting, TLS/custom domains, and managed HTTP API support.

For this application the frontend can remain almost entirely static.

### Why a separate Function App

Static Web Apps managed functions are primarily HTTP API functions.

The ingestion system needs timer and queue triggers, so use a separate Azure Functions app.

Use **Flex Consumption**, on-demand, with **no always-ready instances** initially.

Flex Consumption:

- scales to zero;
- is Microsoft's recommended serverless Functions hosting plan;
- has execution-based billing;
- has a monthly free grant for on-demand execution.

This workload should be tiny.

### Why Storage Queue rather than Service Bus

Storage Queue is enough for the initial asynchronous pipeline:

```text
poll Zotero -> queue source ID -> process source
```

It integrates directly with Azure Functions and is billed as part of the storage account.

Do not deploy Service Bus initially.

Introduce Service Bus only if a real requirement appears for features such as:

- topics/subscriptions;
- sessions/FIFO processing;
- transactions;
- broker-level duplicate detection;
- more advanced messaging semantics.

### Blob Storage

Use private blobs for raw artifacts that we actually choose to retain.

Potential containers:

```text
raw/
  zotero-ABC123/original.pdf
  zotero-XYZ789/snapshot.html

extracted/
  zotero-ABC123/content.txt

processing/
  ...
```

Use LRS initially unless a stronger durability/geo requirement emerges.

Avoid storing files twice without a reason. If Zotero is sufficient for a particular attachment, Blob Storage can be introduced only when processing or long-term ownership requires it.

---

## 11. Secrets and identity

Prefer managed identity for Azure-to-Azure access where supported.

Likely secrets:

- Zotero API key;
- GitHub App/private-key material or another repository-write credential if ingestion commits files.

Do not add Key Vault solely for architectural purity in the first MVP if Function App secret settings are sufficient for the small private deployment.

Key Vault can be introduced when the security/rotation requirements justify it.

CI/CD should preferably use GitHub OIDC/workload identity rather than long-lived Azure deployment secrets.

---

## 12. Reliability requirements

This is not a high-throughput system, but ingestion should be safe.

Requirements:

- capture must not depend on downstream processing availability;
- processing is asynchronous;
- queue worker must be idempotent;
- reprocessing a source must be supported;
- processing-version changes should allow bulk re-enrichment later;
- failed jobs must remain discoverable;
- poison/repeatedly failing messages must not loop forever;
- raw source loss should not occur silently;
- the generated content schema must be validated before commit/publication.

A source should have a simple processing state, e.g.:

```text
captured
queued
processing
processed
failed
needs-review
```

---

## 13. Suggested source identity/provenance model

Every processed object should retain enough provenance to reproduce or audit it.

Minimum identifiers:

```yaml
source_id: zotero-ABC123
zotero_item_key: ABC123
source_url: https://...
doi: 10.xxxx/...       # optional
captured_at: ...
processed_at: ...
processing_version: 1
category_id: recipe
template_revision: 2
category_assignment: automatic
```

AI-derived fields should remain distinguishable from captured metadata.

Do not silently overwrite human-authored notes during reprocessing.

---

## 14. MVP scope

### Phase 1 — prove capture and ingestion

1. Create a Zotero library/account.
2. Install desktop Connector and mobile app/share target.
3. Create `Research Inbox`.
4. Save:
   - one normal webpage;
   - one scholarly article;
   - one PDF.
5. Implement Zotero API polling.
6. Produce a normalized local object for each item.

Success criterion:

> A non-technical user can save any of the three source types in seconds without thinking about the backend.

### Phase 2 — asynchronous processing

1. Deploy Storage Queue.
2. Deploy Flex Consumption Function App.
3. Poll Zotero.
4. Queue changed/new items.
5. Extract source text/metadata.
6. Call Foundry.
7. Validate structured response.
8. Generate `index.md` + JSON sidecars.

Success criterion:

> Captured sources appear automatically as valid repository content without blocking capture.

### Phase 3 — reader

1. Build Astro content collection/schema.
2. Render research pages.
3. Add topic/source-type filtering.
4. Add static full-text search.
5. Deploy to Static Web Apps Free.

Success criterion:

> The user can comfortably search for and read previously captured research on phone and desktop.

### Phase 4 — publishing controls

1. Add rights-status fields.
2. Add public/private filtering.
3. Add deterministic license metadata lookup.
4. Ensure raw copyrighted artifacts cannot be exposed accidentally.

Success criterion:

> A public build cannot publish restricted source artifacts merely because they exist privately.

### Phase 5: category-aware analysis and admin editing

Implement this extension in four steps. The initial MVP remains usable throughout.

1. Add the category registry, immutable template revisions and a versioned note schema. Keep a read adapter for existing schema-version-1 notes and retain stable source paths. Update Markdown and Astro rendering together so all categories use their own sections. Add fixtures for research, recipes and metadata-only social posts.
2. Add classification, pinned template analysis and manual category assignment. Include settings revisions in generation identity and cached output. Preserve extraction evidence, importer conflict handling, human commentary and publication checks. Update search and chat to read every generated section.
3. Add the admin API and phone-friendly Categories editor with presets, draft validation, preview, save conflicts and server-side identity checks. Editing settings must not require repository access. Reader accounts cannot modify them.
4. Add bulk re-evaluation and optional reclassification with affected-note counts, one-document preview, progress, stopping pending work and retrying failed documents. Verify that notes stay readable during jobs, stale jobs cannot overwrite newer assignments, and successful replacements reach both search and chat after deployment.

Success criterion:

> The admin can add a category and edit its analysis sections through the app, save a recipe without research-study headings, and deliberately update older notes without losing human commentary or making the corpus unavailable.

---

## 15. Explicit non-goals for the first implementation

Do not initially build:

- a custom browser extension;
- a custom Android/iOS share target;
- a Notion-like editor;
- collaborative editing;
- a general-purpose CMS;
- Azure AI Search;
- Cosmos DB;
- Service Bus;
- Event Grid;
- AKS/Container Apps;
- complicated agent orchestration;
- executable AI-generated MDX/JSX;
- automatic public redistribution of captured source files.

Add infrastructure only after a concrete requirement appears.

---

## 16. Decisions currently favored

| Area | Current choice |
|---|---|
| Capture UX | Zotero |
| Desktop capture | Zotero browser Connector |
| Mobile capture | Share → Zotero |
| Zotero role | Ingestion inbox only |
| Canonical text | Markdown |
| Complex structured data | JSON sidecars |
| MDX | Optional, hand-authored exceptions only |
| Primary reader | Astro |
| Secondary editor/search | Obsidian |
| Repository | Single monorepo |
| Processed content | Same Git repo |
| Raw PDFs/snapshots | Private Blob Storage or Zotero, not Git |
| Frontend hosting | Azure Static Web Apps Free |
| Background compute | Azure Functions Flex Consumption |
| Queue | Azure Queue Storage |
| Service Bus | Not initially |
| AI | Azure AI Foundry |
| Search | Static index first |
| Database | None initially |
| Category settings | Admin forms backed by existing private Blob Storage |
| Analysis layout | Editable category templates with immutable revisions |
| Template changes | Future captures by default; explicit background re-evaluation |
| Infrastructure as code | Bicep |
| Public publishing | Conservative, rights-aware |

---

## 17. Open implementation questions

These do not block the first prototype:

1. **Repository write mechanism**
   - GitHub App/API directly from ingestion, or
   - stage output and let GitHub Actions commit it.

2. **Raw attachment ownership**
   - retain all raw artifacts in Blob Storage, or
   - use Zotero as the primary private file store and copy only when needed.

3. **Authentication for the reader**
   - fully public initially,
   - private preview,
   - or separate private/public builds.

4. **Search implementation**
   - likely Pagefind/static index first.

5. **Extraction implementation**
   - choose reliable HTML article extraction;
   - define PDF text extraction strategy separately.

6. **Foundry model**
   - choose based on structured-output quality, latency, and cost;
   - model choice should be configuration, not architecture.

---

## 18. Cost philosophy

Expected usage is very small, so optimize for scale-to-zero and shared low-cost primitives.

The target should be approximately:

```text
Static Web Apps Free             ~ €0
Functions Flex Consumption       ~ €0 at tiny usage / free grant
Storage Queue                    negligible
Blob Storage                     negligible at small volumes
Application Insights             free/low-volume range
Foundry                          usage-based, likely dominant variable cost
Zotero metadata sync             free
Zotero files                     free allowance initially / optional
```

Avoid resources with unavoidable hourly/base charges unless needed.

In particular, the initial design intentionally avoids Service Bus Standard/Premium and always-on compute.

---

## 19. Azure assumptions checked on 2026-10-05

The implementation agent should re-check these if deployment happens materially later.

- Azure Static Web Apps has Free and Standard plans; Free includes static hosting, GitHub integration, global distribution, TLS, custom domains, and managed HTTP APIs.
- Static Web Apps managed functions are intended for HTTP API scenarios; timer/queue workloads should use a separate Function App.
- Azure Functions Flex Consumption is the recommended serverless Functions plan and supports scale-to-zero/on-demand billing.
- Flex Consumption on-demand currently includes a monthly free grant.
- Azure Queue Storage is designed for asynchronous work backlogs and integrates directly with Azure Functions queue triggers.
- Storage Queue messages are limited to 64 KB, which is fine because messages should contain identifiers only.
- Service Bus advanced features such as sessions and duplicate detection require higher tiers and are not needed for the initial workflow.

Official references:

- https://learn.microsoft.com/azure/static-web-apps/plans
- https://learn.microsoft.com/azure/static-web-apps/faq
- https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan
- https://azure.microsoft.com/pricing/details/functions/
- https://learn.microsoft.com/azure/storage/queues/storage-queues-introduction
- https://learn.microsoft.com/azure/azure-functions/functions-bindings-storage-queue
- https://learn.microsoft.com/azure/service-bus-messaging/service-bus-premium-messaging

---

## 20. Guiding principle

When choosing between architectures, preserve this ordering:

1. **Saving must be effortless.**
2. **Captured data must not depend on AI succeeding.**
3. **Processed knowledge should remain portable plain files.**
4. **The reading experience should be better than the storage/editing experience.**
5. **Private source retention and public publishing rights are separate concerns.**
6. **Use the cheapest/simple Azure primitive that satisfies an actual requirement.**
7. **Do not add infrastructure merely because it may become useful someday.**
