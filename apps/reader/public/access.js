const heading = document.getElementById('heading');
const message = document.getElementById('message');
const primary = document.getElementById('primary');
const check = document.getElementById('check');
const switchAccount = document.getElementById('switch');
function returnPath() {
  const requested = new URLSearchParams(location.search).get('returnTo');
  const candidate = requested || (location.pathname !== '/login.html' ? location.pathname + location.search + location.hash : '/');
  try {
    const url = new URL(candidate, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith('/.auth') || url.pathname === '/login.html' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
const destination = returnPath();
const login = '/.auth/login/github?post_login_redirect_uri=' + encodeURIComponent(destination);
const recovery = '/login.html?returnTo=' + encodeURIComponent(destination);
const logout = '/.auth/logout?post_logout_redirect_uri=' + encodeURIComponent(recovery);
switchAccount.href = logout;

async function checkAccess() {
  check.disabled = true;
  message.textContent = 'Checking this sign-in session…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/.auth/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Identity check failed');
    const data = await response.json();
    if (!Object.hasOwn(data, 'clientPrincipal')) throw new Error('Invalid identity response');
    const principal = data.clientPrincipal;
    if (principal === null) {
      heading.textContent = 'Sign in';
      message.textContent = 'Use your invited GitHub account.';
      primary.textContent = 'Sign in with GitHub';
      primary.href = login;
      switchAccount.hidden = true;
    } else {
      if (typeof principal.userDetails !== 'string' || !Array.isArray(principal.userRoles)) throw new Error('Invalid identity response');
      const authorized = principal.identityProvider === 'github'
        && principal.userRoles.includes('reader') && principal.userRoles.includes('library_member');
      heading.textContent = authorized ? 'Open the library' : 'Signed in, access unavailable';
      message.textContent = authorized
        ? `Signed in as ${principal.userDetails}. This session has the required roles. If the library still refuses access, check again or refresh your sign-in.`
        : `Signed in as ${principal.userDetails}, but this session does not have the required reader access. A recent invitation or role change may not be reflected yet. Refresh your sign-in, then sign in again.`;
      primary.textContent = authorized ? 'Open library' : 'Refresh sign-in';
      primary.href = authorized ? destination : logout;
      if (authorized) {
        // Probe the protected app document before navigating. A stale role at an edge must not create a redirect loop.
        const target = await fetch(destination, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const content = await target.text();
        const marker = 'access-return:' + destination;
        let recent = false;
        try { recent = Date.now() - Number(sessionStorage.getItem(marker)) < 30000; } catch { /* Storage may be disabled. */ }
        if (target.ok && content.includes('id="root"') && !recent) {
          try { sessionStorage.setItem(marker, String(Date.now())); } catch { /* Protected document probe still prevents denied redirects. */ }
          message.textContent = 'Opening the library…';
          location.replace(destination);
          return;
        }
        heading.textContent = 'Access could not be confirmed';
        message.textContent = 'Your session has reader roles, but the requested page could not be opened consistently. Check access again or refresh sign-in.';
      }
      switchAccount.hidden = false;
    }
  } catch {
    heading.textContent = 'Could not check access';
    message.textContent = 'The sign-in service did not return a valid response. Check your connection and try again. This does not tell us whether your account has access.';
    primary.textContent = 'Sign in with GitHub';
    primary.href = login;
    switchAccount.hidden = false;
  } finally {
    clearTimeout(timeout);
    check.disabled = false;
  }
}

check.addEventListener('click', () => {
  try { sessionStorage.removeItem('access-return:' + destination); } catch { /* Storage may be disabled. */ }
  void checkAccess();
});
void checkAccess();
