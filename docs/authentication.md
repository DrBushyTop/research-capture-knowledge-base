# Reader authentication

Azure Static Web Apps handles GitHub sign-in and invitations. Shelf creates its own server session after Azure confirms the invited account. Azure's built-in session lasts about eight hours and has no supported sliding-expiry setting or `/.auth/refresh` endpoint. The [Azure issue](https://github.com/Azure/static-web-apps/issues/761) tracks that limitation. Shelf does not store GitHub access or refresh tokens.

## Login screen contract

1. Send `POST /api/session` with same-origin credentials and no caching. This renews an existing Shelf session and returns `{ clientPrincipal, expiresAt }`.
2. If `clientPrincipal` is null, send `POST /api/session-start`. Azure protects this endpoint with the `library_member` role. The worker also requires GitHub, the `reader` role and a login in `READER_GITHUB_USERS`. A successful response creates the cookie and returns the same JSON shape.
3. If session creation returns 401 or 403, `GET /.auth/me` can explain the Azure sign-in state. That diagnostic response never grants Shelf access. Offer `/.auth/login/github` with `post_login_redirect_uri` pointing back to `/login.html?returnTo=...`, so the login screen completes the session exchange before opening the reader. A signed-out visit starts this redirect automatically. The callback includes `signIn=returned` to stop automatic retries if GitHub returns without a session. A per-tab attempt marker also stops retries after browser Back. Recovery keeps a manual sign-in link.
4. Preserve only same-origin return paths. After a valid Shelf session, open the requested reader route. API failures and malformed JSON must remain retryable errors.
5. To sign out or switch accounts, submit a form with `method="POST"` to `/api/logout`. Optional `returnTo` must be `/login.html` or a query on that path. The endpoint revokes the SQL record, clears the cookie, then redirects through Azure's logout. `/logout.html?returnTo=...` submits that form for link-based controls and has a button fallback without JavaScript.

Keep the manifest, Apple icon and `/pwa.js` references on the login page. The login page has no install control. The signed-in reader shows an installation recommendation only on phones. Chromium uses its real browser install prompt; iPhone shows Share menu instructions. The recommendation remembers dismissal in local storage. PWA metadata names the app Shelf. The service worker never caches session or authentication requests.

## Session lifetime

The `__Host-ShelfSession` cookie has a 30-day Max-Age, Secure, HttpOnly, SameSite=Lax and Path=/. It has no Domain attribute. JavaScript cannot read it, and cookies stay on the host that issued them. SQL stores a SHA-256 hash of the random 256-bit token, the verified principal and the expiry timestamp. Development and production use separate SQL databases.

Every successful renewal sets expiry to 30 days after the request. The reader renews on opening, window focus, returning to a visible tab and every ten minutes while visible. Background polling and ordinary private API requests do not extend the session. After 30 days without a renewal, another GitHub sign-in is required. A session already expired or revoked cannot renew itself.

The backend validates the session and current login allowlist on each private request. Removing an account from `READER_GITHUB_USERS` invalidates its existing sessions immediately. Invitation roles are verified when a session starts. To revoke an existing session independently, delete its `reader-sessions/<token-hash>.json` SQL record. Expired records are removed by the recovery timer. Logout revokes the current device's session; other devices retain their own sessions.

## Authorization boundaries

The static React shell and its code assets contain no corpus and can load without Azure's cookie. The React access check completes before any private screen loads data. All sources, conversations, original files, uploads, notes and settings remain behind backend session validation. The proxy discards identity headers on private requests and forwards only the opaque session token to the key-protected worker. The separate session-start endpoint retains Azure's edge role check, so a caller cannot mint a session by supplying an identity header to a public API.

All session changes, logout and content writes require an exact allowed Origin. The cookie has no browser persistent-storage copy. API responses use `private, no-store`. The service worker caches only the generic public offline page and leaves APIs and Azure authentication untouched.
