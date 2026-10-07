# Authentication options for Shelf

Researched on 2026-10-07 against the repository, Microsoft documentation, GitHub documentation and Better Auth documentation and source. Recommendations below are design judgments. This note does not record a deployment or a completed Better Auth migration.

## Recommendation

Keep Azure Static Web Apps GitHub sign-in for the immediate repair. Use one application membership policy. The configured GitHub allowlist already names the intended accounts, so it can authorize them without a second invitation process. Replacing the login library would leave the membership decision unresolved.

Better Auth is a reasonable future replacement if we want to own the whole sign-in flow, use stable GitHub account IDs or add another login method. It supports SQL Server today. Its integration still needs a tested OAuth route, an identity migration and a decision about session storage. Those changes deserve their own implementation.

## Why pinaatti signed in but could not enter

The supplied `/.auth/me` response identifies `pinaatti` through GitHub and includes `anonymous` and `authenticated`. Azure assigns those built-in roles after successful sign-in. Custom roles require an invitation that the user accepts, or a configured role-assignment function. Waiting does not grant a custom role. [Microsoft authentication documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization), [Microsoft custom role documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-custom).

The code inspected at the start of this investigation required all of these conditions:

1. Azure allowed `/api/session-start` only for `library_member`.
2. The worker required a GitHub principal with `reader` and `library_member`.
3. `READER_GITHUB_USERS` had to contain the GitHub username.

The screenshot satisfies GitHub authentication but lacks both custom roles. The investigation also found an empty production SWA role registry, while development had a registered `DrBushyTop` account with those roles. Both live worker settings contained `READER_GITHUB_USERS=pinaatti,DrBushyTop`. The source of the denial is the extra role requirement, not the allowlist or the time since login. The baseline checks are in [the SWA configuration](../../apps/reader/staticwebapp.config.json), [readerIdentity](../../apps/worker/src/chat-service.ts) and [freshReader](../../apps/worker/src/reader-session.ts).

## What the existing roles actually control

Azure RBAC, Entra app roles and SWA user roles are separate systems.

Azure RBAC grants access to Azure resources. The assignments in [main.bicep](../../infra/main.bicep) let the worker and CI identities use storage, secrets, models and deployments. They do not grant a GitHub account access to Shelf. [Microsoft Azure RBAC overview](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview).

Entra app roles belong to an application registration. Entra places assigned roles in a token when that user signs into that application. Shelf currently blocks `/.auth/login/aad` and has no custom Entra provider or `rolesSource` configuration. A GitHub principal therefore supplies no Entra app-role proof to this application. [Microsoft Entra app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps), [SWA configuration](../../apps/reader/staticwebapp.config.json).

SWA Role management assigns custom roles to users of a particular SWA resource. It can be the sole membership policy if invitations are the intended access workflow. The current failure is evidence that production has not completed that workflow. Custom authentication and function-based role assignment require the SWA Standard plan. This repository provisions Free. [Microsoft custom authentication documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-custom), [infrastructure](../../infra/main.bicep).

The allowlist can be removed only after another application membership policy replaces it. Allowing every `authenticated` GitHub account would admit anyone who completes GitHub sign-in. Azure's default provider accepts any GitHub user. [Microsoft authentication defaults](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization).

## A single policy with the current session design

The immediate repair lets any Azure-authenticated principal reach session creation, then requires GitHub and membership in the worker's configured allowlist. An approved account needs only an ordinary GitHub login. The worker still refuses missing membership configuration. The trusted SWA proxy supplies the principal only at session creation, and private requests continue to require a valid Shelf session. Azure documents the principal header and places route authorization in SWA configuration. [Microsoft user information documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/user-information).

Shelf already has an opaque 30-day session. Its HttpOnly cookie contains a random token, and SQL stores the token's SHA-256 hash under `reader-sessions/`. Every private request checks the current allowlist, so removing a login denies its existing sessions. Login, renewal, logout and proxy behavior live in [reader-session.ts](../../apps/worker/src/reader-session.ts), [proxy.js](../../apps/chat-proxy/proxy.js) and [the authentication contract](../authentication.md).

Using SWA roles alone needs more work than deleting the environment variable. A Shelf session stores the principal from its creation. A role removal does not change that saved document, and renewal can extend it for another 30 days. We would need to check current membership independently or revoke those sessions when access changes. Requiring Azure's cookie for every request would also change the existing session behavior. This follows from the session implementation above.

The current username allowlist has a limitation. GitHub usernames can change and old names can be claimed by someone else. GitHub recommends its immutable user `id` for authorization records. A later improvement should bind approved accounts to a stable identity. [GitHub username changes](https://docs.github.com/en/account-and-profile/concepts/username-changes), [GitHub durable identifiers](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#use-the-durable-unique-id-to-store-the-user).

## How Better Auth fits this repository

The frontend is Vite and React. The managed SWA API proxy and the separate Functions worker use Node 22. The worker already connects to Azure SQL through managed identity. [Package configuration](../../package.json), [proxy package](../../apps/chat-proxy/package.json), [SQL connection](../../apps/worker/src/sql-connection.ts).

Better Auth supports handlers built around standard `Request` and `Response` objects and has a React client. An Azure Functions wrapper is therefore a plausible integration, but this research has not tested it. Azure Functions' own request and response types need conversion. [Better Auth installation](https://better-auth.com/docs/installation).

SQL Server is explicitly supported through Kysely's `MssqlDialect`, with `tedious` and `tarn`. Schema generation and migration are documented. The existing `mssql.ConnectionPool` is not the documented connection object. We can retain Azure SQL, but must configure the dialect and verify managed identity token renewal, TLS and pool limits. Do not copy the documentation's local SQL password or `trustServerCertificate` setting into production. [Better Auth SQL Server adapter](https://better-auth.com/docs/adapters/mssql).

Better Auth expects `user`, `session`, `account` and `verification` tables. Shelf's sessions are JSON documents in `dbo.Records`, so the library will need new tables or a custom adapter. Use generated SQL in the existing reviewed migration process. Hooks can reject creation, but private endpoints must also check current application membership. A login library does not decide who may read this corpus. [Better Auth database schema and hooks](https://better-auth.com/docs/concepts/database), [current SQL schema](../../apps/worker/sql/001-initial.sql).

The design I would test puts Better Auth in the existing worker and adds a dedicated managed proxy for `/api/auth/*`. That keeps SQL access with the existing worker identity. Auth routes must be reachable before SWA authentication. The new proxy must preserve callback paths, query strings, redirects and each `Set-Cookie` header. The current proxy rejects redirects and non-JSON responses, so it cannot forward OAuth unchanged. [Current proxy](../../apps/chat-proxy/proxy.js).

Set an explicit public base URL and exact trusted origins per environment. Keep cookies on the frontend's host through the proxy. Better Auth documents this arrangement for Safari, which can block cookies on unrelated API domains. Use persistent SQL storage for OAuth state and rate limits rather than per-instance memory. [Better Auth options](https://better-auth.com/docs/reference/options), [cookie and proxy behavior](https://better-auth.com/docs/concepts/cookies), [serverless rate-limit storage](https://better-auth.com/docs/concepts/rate-limit).

Better Auth has configurable rolling expiry, so a 30-day session is possible. Its default is seven days, and session retrieval can refresh it. Match Shelf's intended renewal behavior explicitly. The default schema stores a session `token`, whereas Shelf stores only its hash. Cookies are secret-signed, but migrating does not preserve Shelf's hash-only storage automatically. Assess that difference before adoption. [Better Auth sessions](https://better-auth.com/docs/concepts/session-management), [session creation source](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/db/internal-adapter.ts).

## GitHub registrations and identity migration

Better Auth needs an application client ID, server-side secret and a callback such as `https://shelf.huuhka.net/api/auth/callback/github`. Its GitHub provider requests user information and email access. A new registration means users grant consent to that application. [Better Auth GitHub setup](https://better-auth.com/docs/authentication/github).

Separate dev and production registrations are my recommendation for secret isolation. They are not required by a single-callback limitation. GitHub now supports up to ten OAuth callback URLs. New OAuth apps also default to expiring access tokens. GitHub announced these changes on 2026-08-14. [GitHub OAuth changes](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/), [registration instructions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

Better Auth's GitHub documentation still says OAuth apps do not issue refresh tokens. That statement is stale. The provider source inspected at commit `dbd302e422c66620cde391f6a80ab90ee34182f9` has a refresh implementation and identifies accounts through `profile.id`. Verify both behaviors in the version actually pinned for a migration. [GitHub provider source](https://github.com/better-auth/better-auth/blob/dbd302e422c66620cde391f6a80ab90ee34182f9/packages/core/src/social-providers/github.ts).

Shelf currently assigns private conversation and upload ownership using a SHA-256 hash of `github:` followed by the SWA user ID. That SWA ID is specific to the app and changes if the user is deleted and added again. It is not GitHub's numeric account ID or Better Auth's local user ID. [Current owner calculation](../../apps/worker/src/chat-service.ts), [Microsoft SWA identifiers](https://learn.microsoft.com/en-us/azure/static-web-apps/user-information).

A migration should retain an internal application user record that maps the verified GitHub account to its existing owner key. Capture the old mapping before any user deletion. Establish the association through a trusted administrative migration or a transition where the user proves both identities. Do not accept a browser-supplied owner key or derive the association from an unverified username. Existing data can then keep its current keys while login changes.

## Next decision

The user clarified that the roles in question were those shown in the screenshot and development's custom roles. Those are SWA roles. `anonymous` and `authenticated` do not restrict admission to the intended users. Keep the configured application list as the membership policy and remove the invitation-role dependency. Entra app roles would require a different login configuration and are not active reader authorization today.

For the current two approved GitHub accounts, I would repair the existing flow with the application list. Before replacing it with Better Auth, prove one complete dev sign-in with SQL Server and the SWA proxy, including a cold callback, cookie persistence, rejection of another account, session revocation and preservation of existing conversations. Production access for pinaatti still needs verification in her own browser after the repair deploys.
