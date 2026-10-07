# Reader authentication

Azure Static Web Apps handles GitHub sign-in. Shelf creates its own server session after the worker verifies the signed-in account against `READER_GITHUB_USERS`. Azure's built-in session lasts about eight hours and has no supported sliding-expiry setting or `/.auth/refresh` endpoint. The [Azure issue](https://github.com/Azure/static-web-apps/issues/761) tracks that limitation. Shelf does not store GitHub access or refresh tokens.

`READER_GITHUB_USERS` is the single membership rule, configured on the Functions worker through the Bicep `readerGithubUsers` parameter. It defaults to `pinaatti,DrBushyTop` and matches GitHub logins without case sensitivity. Missing or empty configuration denies access. The SWA proxy does not need a second copy of this setting. No Azure invitation or custom role assignment is required.

Azure gives every signed-in user the `anonymous` and `authenticated` roles. These verify sign-in but do not identify Shelf members. They are SWA roles, separate from Entra app roles and Azure RBAC permissions for the worker and CI identities. [Azure authentication defaults](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization#prerequisites).

## Login screen contract

1. Send `POST /api/session` with same-origin credentials and no caching. This renews an existing Shelf session and returns `{ clientPrincipal, expiresAt }`.
2. If `clientPrincipal` is null, send `POST /api/session-start`. Azure protects this endpoint with the built-in `authenticated` role. The worker requires a valid GitHub principal with that role and a login in `READER_GITHUB_USERS`. A successful response creates the cookie and returns the same JSON shape. Shelf's returned principal has `authenticated` and `reader` roles after its membership check.
3. If session creation returns 401 or 403, `GET /.auth/me` can explain the Azure sign-in state. That diagnostic response never grants Shelf access. Offer `/.auth/login/github` with `post_login_redirect_uri` pointing back to `/login.html?returnTo=...`, so the login screen completes the session exchange before opening the reader. A signed-out visit starts this redirect automatically. The callback includes `signIn=returned` to stop automatic retries if GitHub returns without a session. A per-tab attempt marker also stops retries after browser Back. Recovery keeps a manual sign-in link.
4. Preserve only same-origin return paths. After a valid Shelf session, open the requested reader route. API failures and malformed JSON must remain retryable errors.
5. To sign out or switch accounts, navigate to `/logout.html`. That page submits a form with `method="POST"` to `/api/logout` and has a button fallback without JavaScript. Optional `returnTo` must be `/login.html` or a query on that path. The endpoint revokes the SQL record and clears the cookie. If Azure still has an authenticated principal, it then redirects through Azure's logout. An expired Azure session skips that step.
6. Successful logout returns to `/login.html?signedOut=1`, preserving any reader return path. This state shows "You're signed out" and a manual GitHub sign-in link. It does not check, renew or create sessions, or start sign-in automatically. A failed browser logout returns to `/logout.html?failed=1` with a manual retry button. API callers retain JSON error responses.

Keep the manifest, Apple icon and `/pwa.js` references on the login page. The login page has no install control. The signed-in reader shows an installation recommendation only on phones. Chromium uses its real browser install prompt; iPhone shows Share menu instructions. The recommendation remembers dismissal in local storage. PWA metadata names the app Shelf. The service worker never caches session or authentication requests.

## Session lifetime

The `__Host-ShelfSession` cookie has a 30-day Max-Age, Secure, HttpOnly, SameSite=Lax and Path=/. It has no Domain attribute. JavaScript cannot read it, and cookies stay on the host that issued them. SQL stores a SHA-256 hash of the random 256-bit token, the verified principal and the expiry timestamp. Development and production use separate SQL databases.

The browser sends the same HttpOnly session cookie across tabs and page refreshes. The reader opens without waiting for renewal. Source and conversation requests start immediately and the backend validates their cookies independently. A failed background renewal does not hide the reader or force another login. An explicit session rejection clears private data and returns to the login page.

The reader requests renewal on opening, window focus, returning to a visible tab and every ten minutes while visible. If the session renewed within the last ten minutes, the backend validates it without taking a SQL lease, writing the record or setting another cookie. Otherwise, renewal sets expiry to 30 days after the request. Background polling and ordinary private API requests do not extend the session. After 30 days without a renewal, another GitHub sign-in is required. A session already expired or revoked cannot renew itself.

The backend validates the session and current login allowlist on each private request. Removing an account from `READER_GITHUB_USERS` invalidates its existing sessions immediately. Azure custom roles do not grant or revoke Shelf membership. To revoke an existing session independently, delete its `reader-sessions/<token-hash>.json` SQL record. Expired records are removed by the recovery timer. Logout revokes the current device's session; other devices retain their own sessions.

## Authorization boundaries

The static React shell and its code assets contain no corpus and can load without Azure's cookie. Private screens request data while session renewal runs in the background. All sources, conversations, original files, uploads, notes and settings remain behind backend session validation. The proxy discards identity headers on private requests and forwards only the opaque session token to the key-protected worker. The separate session-start endpoint retains Azure's edge role check, so a caller cannot mint a session by supplying an identity header to a public API.

All session changes, logout and content writes require an exact allowed Origin. `/logout.html` overrides the global `Referrer-Policy: no-referrer` with `same-origin`, so its native POST form sends the host's Origin instead of `null`. Other pages retain `no-referrer`. See [MDN's Origin header explanation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_origin_header).

The cookie has no browser persistent-storage copy. API responses and HTML documents use `private, no-store`. Content-hashed files under `/assets/` use `public, max-age=31536000, immutable`. This caches only public application code, styles and fonts. The service worker caches only the generic public offline page and leaves APIs and Azure authentication untouched.

## Missing invitation roles on 2026-10-07

The production `pinaatti` sign-in returned a GitHub principal with only `anonymous` and `authenticated` roles. Azure's production role registry was empty. Development had a `DrBushyTop` registration with `reader,library_member`. Both workers already had the intended account allowlist, but session creation also required the Azure invitation roles. Waiting after login could not satisfy that second membership rule.

Session creation now uses Azure's automatic `authenticated` role and the worker's account allowlist. Existing Shelf sessions continue to work. Regression tests replay the reported production principal through session creation and exercise the proxy, worker, private access and allowlist revocation. The [auth options research](research/authentication-options.md) compares this repair with a Better Auth migration.
