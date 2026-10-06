# Production deployment

Production uses `rg-research-kb-prod` in Sweden Central and the separate `kv-research-prod-16681c6` vault. Development remains in its existing group. No development secrets or source data are copied automatically.

## Provisioning

The application template is parameterized by environment; `infra/production.parameters.json` selects production names, the production SQL server and vault, and capture disabled. Provision the group and vault first with `infra/vault.bicep`, then the SQL server with `infra/sql.bicep` using `environment=prod` and `includeDevelopmentDatabase=false`. Deploy `infra/main.bicep` with the production parameter file. The application template references the vault; it does not populate secrets.

The production vault uses Azure RBAC, 90-day soft delete and purge protection. The current operator has Key Vault Secrets Officer access. The worker has secret-scoped read permissions for `zotero-account-id` and `zotero-api-key`, not vault-wide secret management.

Production SQL is a separate S0 database on `sql-research-prod-16681c6a.database.windows.net`. Entra-only access, application data grants, private blobs and Functions managed identity mirror development. The Azure-services SQL firewall rule allows network connectivity from Azure but does not grant database access; use fixed egress/private networking if that broad network exception is no longer acceptable. SQL, model capacity, logs and any sandbox usage can incur charges.

## GitHub delivery

`.github/workflows/production.yml` checks and deploys master using the GitHub `production` environment. Its branch policy allows only master. Environment-scoped variables and the generated Static Web Apps deployment secret are separate from repository-level development settings. Azure OIDC trusts the immutable repository/environment subject, not the development branch credential.

The workflow deploys current code and does not change Key Vault contents or enable capture. `scripts/configure-production-delivery.py` configures environment values and transfers generated platform credentials directly to GitHub/SWA without saving them to files or printing them. Run it after worker deployment so `chatGateway` exists. The SWA proxy points only at the production worker and uses its dedicated function key.

## Activation later

1. Add `zotero-account-id` and `zotero-api-key` to the production vault. Use the intended production Zotero library and read-only key. Do not paste credentials into chat, Git or workflow parameters.
2. Accept new production reader invitations for the two approved GitHub accounts, `pinaatti` and `DrBushyTop`, with `reader,library_member` roles. Development invitations do not carry over.
3. Confirm SQL, proxy and model access, then explicitly enable capture by setting `AzureWebJobs.discoverCaptures.Disabled=false`. Also update the production parameter file's `captureEnabled` to true before future infrastructure deployments. Merely adding secrets does not start capture.
4. Verify a capture, source reading, chat, citations and recovery under genuine user sessions. Until then the production application is provisioned and deployed, not accepted as ready for use.

The clean production sandbox snapshot is built without user data by `scripts/bootstrap-browser-sandbox.ts`. It includes Chromium/Playwright and fixed PDF tooling. Browser and evidence operations use separate ephemeral sandbox instances and egress policies even when they restore the same clean image. Do not snapshot a customer session. Keep image IDs in production parameters and settings; never use a dev source artifact as an image seed.
