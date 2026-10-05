# Extraction, enrichment, and repository writes

Checked 2026-10-05 for [Verify extraction, structured enrichment, and repository update options](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/4).

Both proposed repository writers are feasible. HTML article extraction and text-layer PDF extraction can run in the worker; OCR is a separate capability. Foundry can return structured analysis, but support depends on the deployed model and API. None of these mechanisms establishes publication rights or protects human edits automatically.

This note records verified capabilities and proposed safeguards. Runtime language, extraction limits, OCR policy, retention, model, and repository writer remain decisions for the map. No paid inference, account setup, or private API access was performed.

## Source extraction

| Input | Feasible option | Verified behavior and limits |
| --- | --- | --- |
| Article HTML in a JavaScript worker | Mozilla Readability with a DOM implementation such as jsdom | Returns article HTML, plain `textContent`, and metadata. `maxElemsToParse` can bound DOM work. Its readerability check has false positives and negatives. Keep jsdom script execution and remote-resource fetching disabled. Readability does not sanitize HTML. [Mozilla documentation](https://github.com/mozilla/readability). |
| Article HTML in a Python worker | Trafilatura | Extracts main content and metadata from supplied HTML, with text, JSON, XML, or Markdown output. It can exclude comments and uses fallback extractors by default. Extracting all page text also includes navigation and footers. [Trafilatura quickstart](https://trafilatura.readthedocs.io/en/latest/quickstart.html). |
| PDF with a text layer in a JavaScript worker | PDF.js / `pdfjs-dist` | Mozilla's Node example loads a document, reads its page count and metadata, then calls each page's `getTextContent()`. This demonstrates extraction without deploying the browser viewer. Packaging and the selected Functions runtime still need a smoke test. [Mozilla Node example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs). |
| PDF with a text layer in a Python worker | pypdf | Supports ordinary and layout extraction. It cannot read text from images. Tables, positioning, reading order, and existing OCR errors can affect results; large decompressed page streams can require much more memory than the file size suggests. [pypdf extraction documentation](https://pypdf.readthedocs.io/en/stable/user/extract-text.html). |
| Scanned PDF or image | Optional Azure Document Intelligence Read | v4 `prebuilt-read` supports PDFs and images. S0 permits files up to 500 MB and PDFs up to 2,000 pages; F0 permits 4 MB and processes only the first two pages. Password locks must be removed before submission. These service ceilings are not appropriate default worker limits. [Read model requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read?view=doc-intel-4.0.0). |

Start with extraction from captured HTML and PDF text layers. Store extraction method, library version, input hash, page/block locators, and coverage. Treat extraction success and adequate coverage as separate checks; a nonempty string does not prove that the whole source was read. Multi-column papers, tables, equations, and scans belong in the fixture set before selecting a library.

The extraction-policy decision must choose the behavior for these exceptions:

- A scan or mixed PDF with insufficient page text becomes `needs-review` with the affected pages recorded. Manual replacement with a text-bearing copy or bounded OCR are feasible paths. OCR should record its own method and coverage.
- A locked PDF becomes `needs-review`; require a usable attachment rather than retrying passwords. Some libraries support explicit password decryption, including AES dependencies in pypdf, but that does not determine the product's password policy. [pypdf encryption documentation](https://pypdf.readthedocs.io/en/stable/user/encryption-decryption.html).
- Malformed, unsupported, oversized, or excessively slow documents stop at configured byte, decompression, page, DOM-element, memory, and elapsed-time budgets. Preserve a citation record and reason; do not manufacture full-source findings from partial text.
- A paywall, login page, missing snapshot, or HTML shell without article content produces a metadata-only record or `needs-review`. A captured accessible attachment can be used; a live URL fetch must not silently replace the captured version. The above parsers consume supplied content, so they cannot recover absent article text by themselves.
- A document beyond the chosen model input budget needs explicitly recorded chunk coverage or manual handling. Silent truncation would make provenance misleading. Concrete limits and the minimum acceptable coverage remain unknown until representative captures are inspected.

## Source-content trust

The worker is processing third-party data even when the user chose to capture it. Microsoft documents hidden instructions in webpages and documents as an indirect prompt-injection path. Prompt Shields can detect document attacks; its optional Spotlighting feature is limited to Chat Completions and can expand token usage. It is an additional control, not the basis of repository or publishing authorization. [Microsoft Prompt Shields](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection).

The proposed safeguards are:

- Parse source bytes without running page scripts or fetching embedded resources. Pass plain extracted text to enrichment. If extracted HTML is displayed, sanitize it; generated Markdown should also reject or sanitize raw HTML and unsafe links. [Readability security guidance](https://github.com/mozilla/readability).
- A source URL must not grant access to internal services. Restrict fetches to expected HTTP(S) destinations, validate resolved addresses, block private/loopback/link-local destinations, revalidate each redirect, and bound downloads. Never forward Zotero, Azure, or GitHub credentials to a source host. These apply the official guidance on arbitrary-URL fetching and redirect/DNS bypasses. [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
- Supply extraction as lower-trust evidence with fixed instructions. Give the enrichment call no repository, shell, browser, or publishing tools. Derive paths, source IDs, publication status, and authoritative metadata outside the model response.
- Validate the response schema and application rules separately: allowed enums, lengths, dates, URLs, source locators, citation existence, and provenance. Render Markdown through a trusted template. Schema-conforming text can still contain inaccurate claims or malicious instructions.

## Foundry structured enrichment

Azure OpenAI's GA v1 endpoint uses `/openai/v1/`, supports standard OpenAI clients and Entra token authentication, and removes the dated `api-version` requirement. The `model` parameter identifies the Azure deployment. Other providers can expose compatible Chat Completions syntax without having identical capabilities. [Microsoft v1 API documentation](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).

Microsoft documents structured outputs for both Chat Completions (`response_format`) and Responses (`text.format`), with model/version-specific support; examples include `gpt-4o-mini` 2024-07-18 and `gpt-5-mini` 2025-08-07. Its Azure schema limits require an object root, all fields required, nullable unions for missing values, and `additionalProperties: false` on objects. The documented ceiling is 100 properties and five nesting levels. Keywords including string `format`/`pattern`, numeric bounds, and array length bounds are unsupported. Structured outputs are not universally available across Foundry services or models. [Microsoft structured-output documentation](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).

OpenAI's own current API documentation permits larger schemas: 5,000 properties and ten levels. That is not evidence that Azure accepts them. It also explains that refusals may fall outside the schema and that structured outputs can still contain factual mistakes. [Official OpenAI structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Use a small strict inference schema and a separate, richer corpus schema. Missing scientific details should be `null`, empty lists, or explicitly unknown; do not force plausible-looking values. Select and verify the exact deployment/endpoint/API/SDK combination during implementation. Invalid schema errors are configuration failures; refusals, filtered output, incomplete responses, and missing parsed output must not be committed as successful analysis. Transient failures get bounded retries. Persist valid normalized results before repository writing so a GitHub outage does not require repeating paid inference.

Deployment types also affect cost and processing location: Standard types are pay-per-token, provisioned types reserve capacity, Global types can process worldwide, and Data Zone types constrain processing to their designated zone. Not all models support every region or type. [Microsoft deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types).

Keep endpoint, deployment, API family, model/version, SDK version, prompt/schema/processing versions, output budget, and timeout identifiable in configuration and provenance. Regional availability, tenant quota, actual extraction quality, analysis quality, language performance, and unit cost have not been verified against this user's deployment or corpus.

## Repository writer comparison

| Property | Direct GitHub App from worker | Private Blob staging and scheduled Action |
| --- | --- | --- |
| Update timing | After processing and repository API success | After the next importer run; cron timing is best effort |
| Repository credential location | App private key available to the Azure writer; short-lived installation token | Repository token in Actions; worker needs no GitHub credential |
| Atomic corpus update | One tree/commit followed by one branch-ref update | One local Git commit and ordinary push for a validated batch |
| Extra coordination | Ref-conflict retries and write receipts | Durable pending batches, importer acknowledgement, workflow scheduling and deployment wiring |
| Human edits | Requires an ownership/merge contract | Requires the same ownership/merge contract |

### Direct GitHub App

The Contents API creates or replaces one file per request; sequential requests would expose intermediate combinations of Markdown and sidecars. GitHub also warns that parallel content-update/delete requests conflict. [Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).

The Git Database APIs support a complete multi-file update:

1. Read the current branch commit and its tree.
2. Create a tree containing all changed paths, using the current tree's SHA as `base_tree`. Omitting it replaces the tree with only the supplied entries and can delete unrelated files. [Tree API](https://docs.github.com/en/rest/git/trees#create-a-tree).
3. Create one commit referencing that tree and the current branch commit as its parent. [Commit API](https://docs.github.com/en/rest/git/commits#create-a-commit).
4. Update the branch ref with `force: false`. GitHub requires a fast-forward and returns conflict/validation errors otherwise. This makes the whole new tree visible through one branch update; it is not a transaction with Azure processing state. An empty repository must first have an initial branch/commit before this ref workflow can operate. [Reference API](https://docs.github.com/en/rest/git/refs).

An App installation token expires after one hour and can be narrowed to the installed repository and granted permissions. [Installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation). The above content operations need `Contents: write`; workflow-file changes additionally need workflow permissions. Avoid writing workflow files and enforce a corpus-path allowlist in the writer. Contents permission is repository-level, so the allowlist is an application safeguard rather than a path-scoped token. Branch rules and required checks must be inspected before choosing direct default-branch commits. [Reference permissions](https://docs.github.com/en/rest/git/refs#update-a-reference).

If the branch moved, refetch its head, preserve its human edits, rebuild the proposed tree, and retry a bounded number of times without force. After a timeout on ref update, inspect the branch and operation receipt before retrying; the commit may already be reachable even if a later commit is now head. Persist the attempted commit SHA and normalized result. A write error can occur after the commit succeeds.

### Blob staging and scheduled Action

The worker can stage an immutable validated result bundle plus manifest; the importer reads pending manifests, validates again, preserves human fields, and commits a batch. A ready manifest should identify all expected content hashes so partly staged files cannot be imported.

Schedules have a five-minute minimum interval, run only from the default branch, and may be delayed or dropped during load. Public-repository schedules are disabled after 60 inactive days. Keep pending results discoverable until a successful import and provide manual workflow dispatch for recovery. [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Azure access can use GitHub OIDC through `azure/login`, with `id-token: write` and a federated trust condition matching the actual repository/ref or environment. Token creation grants no storage permission by itself. Repositories created after July 15, 2026 can use the new immutable-ID OIDC subject format; setup must match the actual subject, not blindly copy an older example. [GitHub OIDC with Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure). Grant Blob Data Reader on only the staging container for reading; writing acknowledgements needs additional data permission. Prefer separate receipt scope if practical. Management-plane Contributor alone does not grant Blob data access. [Azure Blob authorization](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory).

An importer using `GITHUB_TOKEN` with `contents: write` can commit, but its push does **not** start another push-triggered workflow. Build/deploy the committed content in the same workflow, explicitly dispatch a deployment, or use an App token. [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). Serialize importer runs with a concurrency group and avoid cancelling an active import. This does not prevent a human pushing concurrently; an ordinary non-forced push still needs refetch/merge/retry handling. [GitHub concurrency controls](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Private-repository Actions consume the owner's plan allowance; GitHub Free includes 2,000 minutes/month. For a cost scenario, a 15-minute schedule creates 2,880 runs in 30 days; if each consumes one minute, imports alone use 2,880 minutes before builds. Account plan, actual duration, other workflows, and schedule frequency must be checked. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

### Shared write and human-edit requirements

For either mechanism, identify an operation by the source revision/artifact hash and processing configuration; retain the first valid normalized result for retries. Keep a repository receipt with the operation ID and generated content hashes in the same commit. A duplicate operation with identical content makes no new commit. A stale result must not replace a newer source revision.

Mark the durable result imported only after verifying the commit/receipt. If acknowledgement fails after a successful commit, reconciliation can finish it without repeating inference or overwriting files. Use conditional ETag updates for mutable Azure manifests/receipts; Azure returns `412` when an `If-Match` value is stale. There is no shared transaction across Blob Storage and GitHub. [Blob concurrency](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage).

Human-note ownership must be specified before writing. A separate human-owned Markdown file is a simple option; explicit human-owned sections/fields in `index.md` are another. Reprocessing updates only generated fields, preserves human bytes, and detects unexpected edits by comparing the last generated hashes. Unexpected changes become `needs-review` with the proposed result retained. Never use a force push or unconditional regeneration of the whole source directory to resolve a conflict. These are design recommendations, not guarantees supplied by either writer.

## Optional metadata and rights inputs

Enrichment services are optional adapters. Their absence, timeout, `429`, missing DOI, or ambiguous match should leave captured metadata intact and record the lookup outcome. A title match alone should not silently establish source identity. Cache responses by source identifier and retrieval time; keep returned metadata separate from captured facts and model interpretation.

| Service | Useful API facts | Rights limitation |
| --- | --- | --- |
| Crossref | Public JSON metadata API, no sign-up; DOI lookup, citation/funding/license/update metadata, and a polite pool identified by email. [REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/). | License references can specify version and effective date, but publishers sometimes point to general terms instead of an exact license. Free-to-read and a license are distinct metadata. [Crossref license guidance](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/license-information/). |
| OpenAlex | DOI/external-ID lookup is supported. [Singleton lookup](https://help.openalex.org/api/get-single-entities/). Current Help Center allows limited keyless use; a free key raises the daily budget 10×. Budget exhaustion or more than 100 requests/second returns `429`. Older announcements and legacy docs differ, so recheck current headers at implementation. [Authentication](https://help.openalex.org/api/authentication/). | Per-location fields include URL, license, and version. `is_oa` broadly means readable without payment/login; different locations can have different licenses and versions. It is not a redistribution decision for an arbitrary captured PDF. [Location semantics](https://help.openalex.org/data/locations/). |
| Unpaywall | `GET /v2/:doi` requires an email parameter; documented limit is 100,000 calls/day. Search was retired September 18, 2026, so use DOI lookup rather than planning a search integration. [API documentation](https://unpaywall.org/products/api). | Each OA location has URLs, `license`, and `version` (`submittedVersion`, `acceptedVersion`, `publishedVersion`). License can be null, publisher-specific, or `implied-oa`; "best" location may differ from the user's saved copy. [Data format](https://unpaywall.org/data-format). |

Retain license evidence as a tuple of provider, retrieval time, returned URL/location, reported version, license identifier/URL, effective date where available, and the particular artifact it has been matched to. A work-level DOI/OA flag does not establish the license of exact captured bytes. Missing, conflicting, generic, or version-mismatched evidence should remain unresolved for the deterministic publishing policy. This research establishes the available API fields; the publishing policy must decide which licenses are compatible.

## Handoff checks and unknowns

The implementation plan can now require these checks without selecting the remaining preferences:

- Fixture extraction on a normal webpage, scholarly page, text PDF, scan/mixed PDF, locked PDF, malformed input, and bounded oversized input; record coverage and review reasons.
- Strict schema accepted by the configured Azure deployment; refusal, incomplete/filter/error paths produce no successful analysis commit. Use mocked provider outcomes before any authorized paid evaluation.
- All note/sidecar/receipt paths appear in one commit; duplicate and stale operations are harmless; an ambiguous successful write is recovered.
- Concurrent human changes survive both ordinary import and reprocessing; unexpected edits are retained for review.
- If staging is chosen, import survives a missed schedule and a failed acknowledgement; storage OIDC and the reader rebuild are tested independently.

Still unknown: actual artifact sizes and extraction quality, agreed retention/OCR policy, language/runtime/model choice, tenant-region quota and deployment availability, repository plan/rules, human-edit representation, desired ingestion-to-reader delay, and exact-version rights evidence coverage. The options above are feasible inputs to those decisions, not resolved preferences.
