# Production deployment

Production uses `rg-research-kb-prod` in Sweden Central and the separate `kv-research-prod-16681c6` vault. Development remains in its existing group. No development secrets or source data are copied automatically.

## Provisioning

The application template is parameterized by environment; `infra/production.parameters.json` selects production names, the production SQL server and vault, and capture enabled. Provision the group and vault first with `infra/vault.bicep`, then the SQL server with `infra/sql.bicep` using `environment=prod` and `includeDevelopmentDatabase=false`. Deploy the application with:

```sh
az deployment group create \
  --resource-group rg-research-kb-prod \
  --template-file infra/main.bicep \
  --parameters @infra/production.parameters.json
```

The application template references the vault; it does not populate secrets.

The production vault uses Azure RBAC, 90-day soft delete and purge protection. The current operator has Key Vault Secrets Officer access. The worker has secret-scoped read permissions for `zotero-account-id` and `zotero-api-key`, not vault-wide secret management.

Production SQL is a separate S0 database on `sql-research-prod-16681c6a.database.windows.net`. Entra-only access, application data grants, private blobs and Functions managed identity mirror development. The Azure-services SQL firewall rule allows network connectivity from Azure but does not grant database access; use fixed egress/private networking if that broad network exception is no longer acceptable. SQL, model capacity, logs and any sandbox usage can incur charges.

The Microsoft Foundry resource is `foundry-research-prod-16681c6a`, with kind `AIServices`, project management enabled and key authentication disabled. The worker uses Entra authentication and its account-scoped Cognitive Services OpenAI User role. `FOUNDRY_ENDPOINT` is `https://foundry-research-prod-16681c6a.services.ai.azure.com`, and `FOUNDRY_DEPLOYMENT` is `research-sol`. The same OpenAI v1 request shapes support analysis and streaming chat on Foundry. The former `ai-research-prod-16681c6a` OpenAI account was deleted and purged on 2026-10-07. Incremental deployments do not delete resources omitted from the template.

## GitHub delivery

`.github/workflows/production.yml` checks and deploys master using the GitHub `production` environment. Its branch policy allows only master. Environment-scoped variables and the generated Static Web Apps deployment secret are separate from repository-level development settings. Azure OIDC trusts the immutable repository/environment subject, not the development branch credential.

The workflow deploys current code and does not change Key Vault contents or enable capture. `scripts/configure-production-delivery.py` configures environment values and transfers generated platform credentials directly to GitHub/SWA without saving them to files or printing them. Run it after worker deployment so `chatGateway` exists. The SWA proxy points only at the production worker and uses its dedicated function key.

## Reader domain

Production uses `https://shelf.huuhka.net/`. Its CNAME points to `orange-ground-01b0c6a03.3.azurestaticapps.net`, the production Static Web App. `readerCustomDomain` in the production parameter file declares the Azure custom-domain binding using CNAME validation. Azure manages the [HTTPS certificate](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-external).

After the binding reports `Ready`, run `python3 scripts/configure-production-delivery.py` to configure the proxy. The script reads the domain from production parameters and sets `READER_ORIGINS` to the exact Shelf and Azure origins. `READER_ORIGIN` records the primary Shelf URL and remains the fallback for older development configuration. API writes require a Shelf session and an allowed Origin header. Other origins, missing origins and HTTP variants are refused.

The frontend uses relative `/api/` and `/.auth/` URLs, with same-origin credentials. No cross-origin browser API access or Functions CORS change is needed. GitHub sign-in uses Azure's built-in provider. Shelf checks the worker's `READER_GITHUB_USERS` setting and exchanges an approved sign-in for a server-backed session that expires after 30 days without a visit. No invitation or custom Azure role is required. Renewal and logout stay on the current domain. Signing in on the Azure hostname does not establish a browser session on Shelf. See the [authentication and login screen contract](authentication.md).

## Install Shelf

Open `https://shelf.huuhka.net/login.html`. The login page checks the session and starts GitHub sign-in automatically when needed. It stops automatic retries if sign-in does not complete. After sign-in, phones show an installation recommendation when the browser supports it. Not now, a horizontal swipe, or opening the install prompt dismisses the recommendation permanently for that browser. Chrome and Edge still offer installation through their browser menus. On iPhone or iPad, use the browser Share menu, Add to Home Screen, then Add. The manifest names the app Shelf and opens it in a standalone window. Its stable ID and all URLs are relative, so production and development install separately on their own origins. See [browser installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Each launch opens the reader directly and renews the Shelf session in the background. Only a missing or rejected session returns to sign-in. An installed app may require a separate sign-in, especially on Apple devices. The worker's allowed account list applies when starting and validating a session.

Sources and chat require a connection. The service worker caches only the generic public offline page. It leaves API and authentication requests alone and never caches app pages, bundles, source files or responses. HTTP access errors still reach the browser unchanged. Static app code is public so it can validate a Shelf session after Azure's cookie expires. Private data requires backend authorization on every request. Bump the service worker's offline cache version when changing that page.

## Capture and acceptance

The production vault now contains enabled `zotero-account-id` and `zotero-api-key` secrets. Production parameters set `captureEnabled=true`, which sets `AzureWebJobs.discoverCaptures.Disabled=false`. The worker polls the configured Zotero library every five minutes. Adding secrets alone does not enable the timer; future infrastructure deployments preserve activation through the parameter file. Credentials remain in Key Vault.

Set the worker's `readerGithubUsers` Bicep parameter to the approved GitHub accounts, currently `pinaatti,DrBushyTop`. Verify capture, source reading, chat, citations and recovery under genuine user sessions before accepting the application for use. Anonymous users and signed-in accounts outside the allowlist must not receive private data.

The clean production sandbox snapshot is built without user data by `scripts/bootstrap-browser-sandbox.ts`. It includes Chromium/Playwright and fixed PDF tooling. Browser and evidence operations use separate ephemeral sandbox instances and egress policies even when they restore the same clean image. Do not snapshot a customer session. Keep image IDs in production parameters and settings; never use a dev source artifact as an image seed.

See [monthly cost assumptions](monthly-cost.md) for idle and usage-dependent production estimates.

## Validation on 2026-10-07

Both Foundry infrastructure deployments succeeded. Real structured analysis and streaming Responses requests passed against development and production. Each deployed Functions worker completed a queued chat request with its managed identity; the temporary validation conversations were deleted afterward.

Production Zotero returned HTTP 200 with zero items and library version 1. A deployed discovery invocation persisted that checkpoint in production SQL. Polling is enabled, but a new source capture remains untested until the production library contains an item.

Local checks passed with 125 unit tests and the reader and worker builds. The separate SQL integration test also passed. In the local preview browser, source listing, a Foundry answer using corpus search and source reads, and its citation details and note link were checked. Production browser sign-in and invited-user workflows remain untested; the user selected backend production validation.

Production reader: `https://shelf.huuhka.net/`.
Azure hostname: `https://orange-ground-01b0c6a03.3.azurestaticapps.net/`.
Vault: `https://kv-research-prod-16681c6.vault.azure.net/`.
