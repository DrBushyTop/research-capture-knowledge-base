# SQL storage and local development

Azure SQL Database Standard S0, 10 DTUs, is the authoritative application store. Blob Storage retains original files and temporary binary assets. Azure Storage Queues still deliver processing work. Git contains code and optional historical exports, not live application data.

`Sources` holds current source notes, metadata, category identifiers, original human commentary, and publication state. Indexed fields support source listing. `Records` holds validated versioned JSON for capture snapshots, analyses, processing jobs, category registries and revisions, reader notes, conversations, and retrieval snapshots. `Leases` coordinates distributed processing. SQL revision checks and renewable fenced leases preserve the existing processing contract without holding a database transaction open during model calls.

Processing publishes directly to `Sources`. The reader loads `/api/chat?library=1`; saving or reprocessing does not require a Git push or static deployment. Old `/research/{id}/` links load the same live reader. Chat freezes its retrieval snapshot at submission time and adds current reader notes when answering.

## Provisioning

Deploy `infra/sql.bicep` with the Entra administrator's object ID and login. It creates `research` and an optional `research_dev`, both S0. Set `includeDevelopmentDatabase=false` if an x86 local SQL Server is available. The development database is a second billable S0 database.

Firewall rules must include the operator IP and application egress. The current Flex Consumption app has no fixed outbound IP list, so the deployment uses Azure-services firewall access plus an operator IP. Entra-only authentication and database permissions still apply. This network rule admits connectivity from other Azure tenants, not authorization. Use fixed egress or a private endpoint if stricter network isolation becomes necessary.

Set `SQL_SERVER` and `SQL_DATABASE`, then run `npm run db:migrate`. Runtime identities receive only data permissions through `scripts/sql-grant.ts`; schema migration uses the administrator. Pass the application client ID for managed identities and service principals, or the object ID for human users. The Functions app uses its managed identity, never a SQL password.

## Local development

Use Podman, or set `CONTAINER_RUNTIME=docker`.

On x86-64, `npm run dev:setup` starts SQL Server Developer and Azurite with persistent named volumes and generated credentials. On Apple Silicon, set `SQL_SERVER` and `SQL_DATABASE=research_dev` before setup. SQL Server Linux containers do not provide a supported ARM engine; this machine's emulated container crashed. A separate Azure development database uses the same schema and Entra authentication.

Run:

```sh
az login
SQL_SERVER=sql-research-dev-16681c6a.database.windows.net SQL_DATABASE=research_dev npm run dev:setup
npm run dev
```

The reader listens on port 4360 and a localhost-only development API on 7072. This API supplies a local development identity and must never be deployed as an authentication boundary. Local SQL access uses your Azure CLI credentials. Azurite stores development files separately from production.

Configuration and generated credentials live in ignored `.local/dev.env` and `.local/dev-settings.json`. Setup refuses the production `research` database and does not erase either database or volumes. The initial seed imports source notes from the local historical corpus.

For real processing, set `FOUNDRY_ENDPOINT` and `FOUNDRY_DEPLOYMENT`, then run `npm run dev:worker` in another terminal. Azure Functions Core Tools consumes local Azurite queues. Zotero polling and cloud recovery timers are disabled locally. PDF/image sandbox inspection also needs the existing sandbox environment settings and Azure permissions. Model calls can incur charges.

Test real SQL behavior with `SQL_SERVER=... SQL_DATABASE=research_dev npm run test:sql`. Unit tests continue to use the in-memory storage fixture.

## Cutover and recovery

Stop Functions and avoid user writes before running `npm run db:import` with production SQL and storage settings. It copies and verifies structured blobs, imports existing human commentary, and publishes the latest completed analyses. Binary blobs remain in place. The importer never deletes original blobs or Git files. Do not rerun the importer over newer SQL data: mismatches deliberately fail rather than overwrite edits.

Deploy SQL-backed code, set Functions `SQL_SERVER` and `SQL_DATABASE`, and restart. Verify source count, notes, categories, conversations, and a reprocessing job before retiring the old importer. The deployment workflow no longer imports content into Git or publishes chat snapshots from a static build.

Rollback requires stopping writes and exporting any new SQL-only data before restoring the old application. Switching storage settings alone would lose visibility of edits made since cutover. Azure SQL point-in-time backups are the live recovery mechanism; the old blobs are only the cutover snapshot.
