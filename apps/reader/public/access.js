const heading = document.getElementById('heading');
const message = document.getElementById('message');
const primary = document.getElementById('primary');
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
const recovery = '/login.html?returnTo=' + encodeURIComponent(destination);
const login = '/.auth/login/github?post_login_redirect_uri=' + encodeURIComponent(recovery + '&signIn=returned');
const logout = '/logout.html?returnTo=' + encodeURIComponent(recovery);
switchAccount.href = logout;

async function checkAccess() {
  message.textContent = 'Checking this sign-in session…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    let sessionDenied = false;
    const options = { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal };
    let response = await fetch('/api/session', options);
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Identity check failed');
    let data = await response.json();
    if (data.clientPrincipal === null) {
      response = await fetch('/api/session-start', options);
      if (response.status === 401 || response.status === 403) {
        sessionDenied = true;
        const identity = await fetch('/.auth/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!identity.ok || !identity.headers.get('content-type')?.includes('application/json')) throw new Error('Identity check failed');
        data = await identity.json();
      }
      else {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Identity check failed');
        data = await response.json();
      }
    }
    if (!Object.hasOwn(data, 'clientPrincipal')) throw new Error('Invalid identity response');
    const principal = data.clientPrincipal;
    if (principal === null) {
      heading.textContent = 'Sign in';
      message.textContent = 'Use your approved GitHub account.';
      primary.textContent = 'Sign in with GitHub';
      primary.href = login;
      switchAccount.hidden = true;
      const marker = 'github-sign-in:' + destination;
      let attempted = new URLSearchParams(location.search).get('signIn') === 'returned';
      try { attempted ||= sessionStorage.getItem(marker) === 'started'; } catch { /* The callback query also prevents automatic retries without storage. */ }
      if (!attempted) {
        try { sessionStorage.setItem(marker, 'started'); } catch { /* The callback query protects the return visit. */ }
        heading.textContent = 'Signing you in';
        message.textContent = 'Opening GitHub...';
        location.replace(login);
        return;
      }
      message.textContent = 'GitHub did not complete sign-in. Try again with your approved account.';
      primary.hidden = false;
    } else {
      if (typeof principal.userDetails !== 'string' || !Array.isArray(principal.userRoles)) throw new Error('Invalid identity response');
      const authorized = !sessionDenied && principal.identityProvider === 'github'
        && principal.userRoles.includes('reader');
      heading.textContent = authorized ? 'Open the library' : 'Signed in, access unavailable';
      message.textContent = authorized
        ? `Signed in as ${principal.userDetails}. Opening the library...`
        : `Signed in as ${principal.userDetails}, but Shelf could not grant access. Ask the owner to check that this GitHub account is on Shelf's allowed account list. You can also switch accounts.`;
      primary.textContent = authorized ? 'Open library' : 'Refresh sign-in';
      primary.href = authorized ? destination : logout;
      primary.hidden = false;
      if (authorized) {
        try { sessionStorage.removeItem('github-sign-in:' + destination); } catch { /* Storage may be disabled. */ }
        // Probe the protected app document before navigating. A stale role at an edge must not create a redirect loop.
        const target = await fetch(destination, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const content = await target.text();
        const marker = 'access-return:' + destination;
        let recent = false;
        try { recent = Date.now() - Number(sessionStorage.getItem(marker)) < 30000; } catch { /* Storage may be disabled. */ }
        if (target.ok && content.includes('id="root"') && !recent) {
          try { sessionStorage.setItem(marker, String(Date.now())); } catch { /* Protected document probe still prevents denied redirects. */ }
          message.textContent = 'Opening the library…';
          primary.hidden = true;
          location.replace(destination);
          return;
        }
        heading.textContent = 'Access could not be confirmed';
        message.textContent = 'Your session has reader access, but the requested page could not be opened. Refresh your sign-in to try again.';
        primary.textContent = 'Refresh sign-in';
        primary.href = logout;
      }
      switchAccount.hidden = false;
    }
  } catch {
    heading.textContent = 'Could not check access';
    message.textContent = 'The sign-in service did not return a valid response. Check your connection and try again. This does not tell us whether your account has access.';
    primary.textContent = 'Sign in with GitHub';
    primary.href = login;
    primary.hidden = false;
    switchAccount.hidden = false;
  } finally {
    clearTimeout(timeout);
  }
}

if (new URLSearchParams(location.search).get('signedOut') === '1') {
  heading.textContent = "You're signed out";
  message.textContent = 'Sign in with GitHub to open Shelf.';
  primary.textContent = 'Sign in with GitHub';
  primary.href = login;
  primary.hidden = false;
  switchAccount.hidden = true;
} else {
  void checkAccess();
}
