# Azure private hosting and ingestion

Researched: 2026-10-05. Scope: [Verify private Azure hosting and operational limits](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/3), using the [implementation brief](../../research-capture-knowledge-base-plan.md). This document records service capabilities and deployment checks. Reader policy, ingestion protocol, runtime language, region, and spending limits remain decisions for their respective tickets.

## Feasibility

The proposed services can support a private reader and asynchronous ingestion. A feasible minimal configuration is Static Web Apps Free with invitation-assigned reader roles, a separate Flex Consumption Function App, and authenticated Storage services. Free supports preconfigured authentication; managed Static Web Apps functions support HTTP triggers only. Keep timer and queue ingestion independent of the reader. [SWA authentication](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization), [SWA Functions FAQ](https://learn.microsoft.com/en-us/azure/static-web-apps/faq).

This conclusion is conditional on testing authorization for every deployed content path and choosing a supported Flex runtime and region. The free allowances below do not establish a zero-cost system.

## Reader access on Static Web Apps

### Specific users require a custom role

Both GitHub and Microsoft Entra ID are preconfigured authentication providers. Any user can sign in through these providers; the preconfigured Entra provider accepts Microsoft accounts outside a chosen tenant. Every signed-in user receives `authenticated`. Therefore, `allowedRoles: ["authenticated"]` alone does not allowlist the intended reader. [Authentication defaults](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization#prerequisites).

Free supports invitations assigning custom roles to up to 25 users. Its documented limits also include three preview environments, 250 MB per environment, 500 MB across environments, 15,000 files, and 100 GB monthly bandwidth, with no bandwidth overage option. Measure the completed Astro and Pagefind build against these limits. [SWA quotas](https://learn.microsoft.com/en-us/azure/static-web-apps/quotas).

An invitation specifies a provider and recipient: a GitHub username or Entra email address. The recipient accepts it while signed in to the corresponding account, receiving the assigned roles. Invitation expiry can be up to seven days. Role removal invalidates permissions but can take minutes to propagate. [Invitation and role management](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-custom#manage-roles).

A simple supported configuration invites the intended people to a custom `reader` role and requires that role for the corpus. A user may authenticate without being permitted to read. The provider and invitation process still require a human decision; no tenant restriction should be claimed for Free.

### Routes, assets, search and fallback

Route rules run in order and stop at the first match. Roles are alternatives, so combining `reader` with `authenticated` would broaden access. A `/*` role rule can cover the whole application. Configuration must reach the root of the deployed output. Exact-file and wildcard matching differ; `navigationFallback` requests bypass route rules. [SWA configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration).

Pagefind runs against generated HTML and writes browser dependencies and search index files into a `pagefind` directory. Its output is content-bearing material. [Pagefind build behavior](https://pagefind.app/docs/running-pagefind/).

For a fixture deployment, place any provider-blocking rule first, allow the required `/.auth/*` system routes and a corpus-free sign-in page, then require `reader` for `/*`. Keep the sign-in page self-contained. Omit SPA fallback. This proposed configuration still requires deployment testing.

Protect `/pagefind/*`, generated JSON, JavaScript containing data, HTML, feeds, sitemaps, image metadata and source maps. Hiding a search box or page link provides no server authorization. Build a future public index only from the public build output. Neither private search shards nor copied source files should enter that output. These are proposed build safeguards based on the static output described above.

### Previews and repository visibility

Default SWA workflows create temporary PR preview URLs and remove those environments after PR closure. Branch and named previews can also have stable URLs. Preview environments do not support custom domains and are not geographically distributed. A difficult-to-guess preview URL is not an access rule. [Preview environments](https://learn.microsoft.com/en-us/azure/static-web-apps/preview-environments).

The documentation examined does not establish role invitation and session behavior for every preview hostname. Treat that as a deployment-test requirement. Feasible policies to choose between are disabling previews containing private corpus data, deploying synthetic fixtures to previews, or explicitly testing the same authorization boundary on every enabled preview. Never assume protection on production proves protection on a preview.

SWA's own Free quickstart uses a private GitHub repository. GitHub public repositories are accessible to everyone, while private repositories restrict access to authorized people. Since the monorepo contains the canonical private corpus, reader authentication cannot compensate for a public repository. [Free/private-repository quickstart](https://learn.microsoft.com/en-us/azure/static-web-apps/get-started-portal), [GitHub repository visibility](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories#about-repository-visibility).

### When Free is insufficient

Standard is required for custom provider registrations, role assignment through a function, private endpoints, and linking an existing Function App as the SWA API. Free can still host the static reader alongside an independent ingestion app. [Plan comparison](https://learn.microsoft.com/en-us/azure/static-web-apps/plans).

If tenant-bound sign-in or programmable user/group roles become requirements, a feasible alternative is Standard with a custom Entra registration and explicit authorization. Tenant membership alone is broader than an intended-user allowlist. The role-source function requires custom authentication and replaces invitation-assigned roles. [Custom authentication](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-custom).

Password protection is a Standard-only preview feature with limited security; it does not provide individual signed-in identities. It is not an equivalent replacement for the requested reader. [Password protection](https://learn.microsoft.com/en-us/azure/static-web-apps/password-protection).

## Flex Consumption constraints

Flex runs on Linux, supports timer and Storage Queue triggers, and can scale to zero without always-ready instances. Blob triggers require the Event Grid source; a polling Blob trigger would conflict with the brief's avoidance of Event Grid. Non-C# apps require extension bundle 4.x or later. Deployment slots are unsupported. [Flex hosting](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan).

The current Flex language table lists these runtimes; this is a capability list, not a language selection:

| Stack | Documented versions |
| --- | --- |
| C# isolated worker | .NET 8, 9, 10 |
| Node.js | 22, 24 |
| Python | 3.10 through 3.14 |
| Java | 8, 11, 17, 21, 25 |
| PowerShell | 7.4, 7.6 |
| Custom handlers | 1.0 |

C# in-process is unsupported on Flex. Recheck versions and lifecycle support when implementing. [Flex supported stacks](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan#supported-language-stack-versions).

Flex supports code deployment but not custom containers. Its default execution timeout is 30 minutes with an unbounded configurable maximum; platform updates allow a ten-minute grace period and scale-in allows 60 minutes. HTTP responses remain limited to 230 seconds. Long execution allowance does not guarantee uninterrupted completion. Extraction dependencies must work in the provided Linux runtime or packaged code. [Hosting and execution limits](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale).

Region availability is not universal. Before provisioning, run `az functionapp list-flexconsumption-locations`, check the chosen region and subscription capacity, and confirm model availability separately. Flex supports 512, 2,048 and 4,096 MB instances. Deployment storage can use system-assigned or user-assigned identity with `Storage Blob Data Contributor`. Each app needs its own deployment container. [Flex configuration](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to).

Flex package deployment uses a ready-to-run ZIP in a Blob container; it is the supported code deployment mechanism. [Deployment technologies](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies).

Bicep must use Flex's `functionAppConfig` for runtime, deployment and scale configuration. Legacy settings such as `FUNCTIONS_WORKER_RUNTIME`, `WEBSITE_RUN_FROM_PACKAGE`, `SCM_DO_BUILD_DURING_DEPLOYMENT`, and `alwaysOn` should not be copied from other hosting plans. Timer schedules default to UTC; `WEBSITE_TIME_ZONE` and `TZ` are unsupported on Flex. [Flex deprecations and time-zone settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings#flex-consumption-plan-deprecations).

## Timer and queue reliability

Timer triggers use host Blob storage for coordination and run a single invocation across scaled instances; an outstanding invocation prevents another concurrent timer invocation. `AzureWebJobsStorage` therefore needs to remain available. Identity-based timer host storage requires `Storage Blob Data Owner`. [Timer behavior and connections](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer).

The timer reference describes no default retry after failure. The error-handling guide separately documents explicitly configured Timer retry policies, including fixed delay and exponential backoff. Their counters live in instance memory; timer retries do not resume on a replacement instance and can be fewer than configured. Durable checkpoint recovery must work independently of retries. [Retry policy guidance](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-error-pages).

Storage Queue delivery is at least once, without guaranteed ordering, broker duplicate detection, or atomic multi-message operations. Queue/state/repository updates must not be treated as one transaction. [Queue semantics](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted).

Messages are limited to 64 KB; base64 reduces usable payload to approximately 48 KB. The default TTL is seven days; modern APIs support a positive custom TTL or `-1` for no expiry. Choose retention explicitly for work and recovery records. [Message limits and TTL](https://learn.microsoft.com/en-us/azure/storage/queues/storage-queues-introduction), [Encoding overhead](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted#capacity-and-quotas).

The Functions queue trigger deletes messages after successful execution. By default it allows five attempts, counting the initial one, then writes to `<queue>-poison`. Failure retry visibility defaults to zero; host crashes leave a message invisible for ten minutes before redelivery. Queue polling uses backoff to reduce idle transactions. [Queue-trigger failure behavior](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger#poison-messages).

`host.json` controls `maxDequeueCount`, `visibilityTimeout`, polling interval, message encoding and batch concurrency. `batchSize: 1` only limits concurrency within one instance; scaled instances can still process concurrently. Producer and binding encodings must agree. [Queue extension configuration](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue#hostjson-settings).

The ingestion protocol needs to persist work before advancing the Zotero checkpoint, reconcile work that was persisted but never queued, reject stale messages, and claim jobs with conditional writes or renewable leases. Output and repository writes must be idempotent. Preserve completed expensive stages across retries and expose failed/poison work for explicit repair. A successful function return must mean its durable responsibility is complete. Automatic infinite poison requeueing would defeat the finite retry limit.

## Private storage and durable state

Set account `allowBlobPublicAccess: false` and container access to private. The account setting overrides anonymous container access, but it does not make the Storage static website endpoint private: `$web` remains publicly accessible. Keep static website hosting disabled for the source account. [Blob anonymous access](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-configure).

Functions requires host storage supporting Blob, Queue and Table services. GPv2 meets that requirement. Host and application data can share an account, though Microsoft recommends separate accounts for stronger production isolation. Lifecycle deletion must exclude host containers and deployment packages. Flex does not require an Azure Files content share. [Functions storage considerations](https://learn.microsoft.com/en-us/azure/azure-functions/storage-considerations).

Two small durable-state configurations are feasible within existing Storage primitives:

| Configuration | Verified capability | Planning implication |
| --- | --- | --- |
| JSON blobs: checkpoint and one record per source/job | Conditional ETag writes and renewable 15 to 60 second leases support conflict detection and exclusive writes. | Avoid one unprotected mutable manifest; define listing/reconciliation and lease recovery. [Blob concurrency](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage). |
| Storage Table entities for jobs/checkpoints/outbox | Table storage provides schema-flexible entities; transactions cover at most 100 entities and 4 MiB in one table partition. | Useful for discoverable state and a transactional outbox within one partition; it does not make queue enqueue atomic. [Table overview](https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-overview), [Transaction limits](https://learn.microsoft.com/en-us/rest/api/storageservices/performing-entity-group-transactions). |

Both avoid an always-running database. Table storage is a distinct Storage service choice and should be recorded explicitly if selected. Capacity and operations are billed; "inexpensive" is a workload assumption to estimate, not a free entitlement. [Tables pricing](https://azure.microsoft.com/en-us/pricing/details/storage/tables/).

Host, bindings and application SDKs have separate connection requirements. Managed identity connections use service-URI settings; queue trigger minimum roles include `Storage Queue Data Reader` and `Storage Queue Data Message Processor`, while writes require sender/contributor permissions. Table writes require `Storage Table Data Contributor`. Test poison-queue creation and writing too. [Functions connection and role reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-identity-based-connections-tutorial).

`Storage Queue Data Contributor` includes queue and message read/write/delete permissions, making it a feasible shared-app role when polling, queue processing and poison handling use the same identity. Scope data permissions to the needed resources; management-plane Contributor should not be assumed to grant data access. [Storage RBAC roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage#storage-queue-data-contributor).

Keep private blobs out of static output. Direct raw-artifact access requires separate authorization because SWA route rules govern SWA-served requests. [Scope of SWA route security](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#secure-routes-with-roles).

## Deployment identity and cost

GitHub Actions can federate to an Entra application or user-assigned managed identity using OIDC. It requires a matching federated credential, `id-token: write`, and scoped Azure RBAC. This supports Azure CLI/Bicep deployment without a stored Azure client secret. [Azure Login OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

Functions deployment supports OIDC with `Azure/functions-action`; Flex supports `remote-build` when needed and does not support the action's slot parameter. Use a Linux runner and the language-specific package build. [Functions GitHub deployment](https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-github-actions).

SWA deployment is separate: the documented workflow supplies an SWA deployment token. Even the example passing `github_id_token` also supplies `azure_static_web_apps_api_token`. Do not claim Azure Login OIDC automatically removes this credential. A token-management choice is still needed, and tokens can be reset if compromised. [SWA build authorization](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration), [Deployment-token management](https://learn.microsoft.com/en-us/azure/static-web-apps/deployment-token-management).

Verified allowances and charge drivers:

| Service | Verified billing fact |
| --- | --- |
| SWA Free | Free tier with the quotas above; Standard adds a paid hosting tier. [Hosting plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans). |
| Flex on-demand | 250,000 executions and 100,000 GB-seconds monthly per subscription, shared across apps; grants apply to on-demand meters on paid consumption subscriptions. Always-ready baseline and execution have separate meters. [Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/). |
| Queue Storage | Storage capacity and operations are billed, including reads, sends and updates. [Queue pricing](https://azure.microsoft.com/en-us/pricing/details/storage/queues/). |
| Blob Storage | Stored capacity, operations, retrieval for applicable tiers and inter-region transfers contribute to cost. Documentation example prices are fictitious. [Blob cost model](https://learn.microsoft.com/en-us/azure/storage/blobs/blob-storage-estimate-costs). |
| Application Insights | Workspace ingestion is billed; default Log Analytics pay-as-you-go includes 5 GB monthly per billing account. [Application Insights pricing FAQ](https://learn.microsoft.com/en-us/azure/azure-monitor/app/application-insights-faq#what-is-the-application-insights-pricing-model). |

Use sampling/filtering and avoid logging source text, model payloads or credentials. Configure both Application Insights and workspace caps where applicable, with an alert before the cap. A cap can overshoot and the excess is billed; reaching it also interrupts telemetry. [Telemetry sampling](https://learn.microsoft.com/en-us/azure/azure-monitor/app/sampling), [Daily-cap behavior](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap).

The estimate must also include model usage, repository build/artifact usage and any chosen monitoring alerts. Azure Monitor alert charges depend on rule type and frequency; standard platform metrics are collected without charge. [Monitor billing](https://learn.microsoft.com/en-us/azure/azure-monitor/cost-usage). The actual workload, model price, region, subscription benefits and build frequency are unverified; no monthly total is established here.

## Proposed deployment acceptance checks

These checks belong in the implementation plan. They were not executed during research.

1. Deploy a synthetic corpus first. Verify the output contains the intended `staticwebapp.config.json`, and no raw PDF/snapshot, source text, secret or private build artifact is copied into public assets.
2. On production's default hostname, any custom domain and each enabled preview, try anonymous and signed-in uninvited sessions. Request `/`, a research page, its explicit `index.html`, a JSON sidecar, a feed/sitemap, an image, a source map and every Pagefind file class. Responses must contain no fixture corpus text or metadata.
3. Accept the intended user's invitation. Verify article reading, Pagefind search and filters on phone and desktop. An uninvited authenticated account must still be denied. Test provider blocking, expired/wrong-account invitations, logout and revocation propagation.
4. Request nonexistent, trailing-slash and encoded paths. Confirm a fallback or error page cannot return private content. Review cache headers and recheck network requests after logout; do not use offline copies as evidence of current authorization.
5. Attempt anonymous Blob fetches and container listing. Verify account anonymous access is disabled, all source containers are private, and no Storage static website is enabled. Test each application identity's permitted and denied operations.
6. Verify runtime/region availability and subscription quota; deploy the package and confirm timer and queue triggers are discovered. Run ingestion with zero always-ready instances and after an idle period.
7. Inject interruption before enqueue, after enqueue, during processing, after output staging and after repository writing. Prove reconciliation and duplicate delivery converge on the same intended result without losing pending work or overwriting human notes.
8. Force repeated job failure, worker termination, stale messages and outages beyond the chosen retention window. Verify finite retries, poison visibility, durable failure state, bounded model spending and explicit repair.
9. Verify OIDC deployment permissions and trust boundaries, SWA token handling, output-size/file quotas, diagnostic caps and actual cost meters. Record which preview configurations and identity paths were tested.

## Decisions and unknowns to carry forward

- Reader policy: intended identities/provider, invitation ownership, preview policy, repository visibility and whether Standard-only features are required.
- Runtime and extraction: supported language/version, native Linux dependencies, memory, timeout and region. A custom-container dependency is incompatible with Flex unless the extraction approach changes.
- Ingestion protocol: Blob versus Table state, checkpoint/outbox ordering, concurrency claims, stale-version handling, TTL, poison retention and repair ownership.
- Infrastructure: host/application-storage isolation, managed-identity role scopes, package-container protection and retention, OIDC bootstrap and SWA credential handling.
- Cost: model deployment and rate, source volume, execution duration, data retention, rebuild frequency and human-set budget. Regional monetary rates and the user's subscription allowances must be checked at deployment time.

No Azure resources, credentials, application code or repository history were created by this research.
