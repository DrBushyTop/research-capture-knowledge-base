import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useMatches, useRouterState } from '@tanstack/react-router';
import { accessStore, forgetPrivateData } from '../lib/api';

type Access = 'checking' | 'allowed' | 'unavailable';

/** Deployed builds confirm the Static Web Apps identity before any screen asks the API for private data. The local dev server has no /.auth. */
function useAccess(): Access {
  const [access, setAccess] = useState<Access>(import.meta.env.DEV ? 'allowed' : 'checking');
  useEffect(() => {
    if (access !== 'checking') return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    fetch('/.auth/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const principal = response.ok && response.headers.get('content-type')?.includes('application/json') ? (await response.json()).clientPrincipal : undefined;
      if (disposed) return;
      const roles: unknown = principal?.userRoles;
      if (principal?.identityProvider === 'github' && Array.isArray(roles) && roles.includes('reader') && roles.includes('library_member')) setAccess('allowed');
      else setAccess('unavailable');
    }).catch(() => { if (!disposed) setAccess('unavailable'); }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
  }, [access]);
  return access;
}

function AccessProblem({ checking }: { checking?: boolean }) {
  if (checking) return <main id="main" className="app-state" tabIndex={-1}><p role="status">Checking your sign-in…</p></main>;
  return <main id="main" className="app-state" tabIndex={-1}>
    <h1>Access unavailable</h1>
    <p>This session cannot open the private library. Private data on this page has been cleared.</p>
    <p><a href="/login.html">Check access and sign in</a></p>
  </main>;
}

export function NotFound() {
  return <main id="main" className="app-state" tabIndex={-1}>
    <h1>Page not found</h1>
    <p>This address is not part of the library. <Link to="/sources/">Browse sources</Link> or <Link to="/">start a chat</Link>.</p>
  </main>;
}

export default function Layout() {
  const queryClient = useQueryClient();
  const access = useAccess();
  const lost = useSyncExternalStore(accessStore.subscribe, accessStore.get);
  const path = useRouterState({ select: state => state.location.pathname });
  const title = useMatches({ select: matches => matches.findLast(match => match.staticData.title)?.staticData.title });
  useEffect(() => { document.title = title ? `${title} · Research library` : 'Research library'; }, [title]);
  useEffect(() => {
    if (!lost && access === 'allowed') {
      try { sessionStorage.removeItem('access-return:' + location.pathname + location.search + location.hash); } catch { /* Storage may be disabled. */ }
    }
    if (lost || access === 'unavailable') {
      const destination = location.pathname + location.search + location.hash;
      location.replace('/login.html?returnTo=' + encodeURIComponent(destination));
    }
  }, [lost, access]);
  const current = (active: boolean) => active ? 'page' as const : undefined;
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead">
      <Link to="/">Research library</Link>
      <nav aria-label="Library">
        <Link to="/" aria-current={current(path === '/' || path.startsWith('/chat/'))}>Chat</Link>
        <Link to="/sources/" aria-current={current(path.startsWith('/sources/'))}>Sources</Link>
        <Link to="/categories/" aria-current={current(path.startsWith('/categories/'))}>Categories</Link>
      </nav>
      <a className="sign-out" href="/.auth/logout?post_logout_redirect_uri=/login.html" onClick={() => forgetPrivateData(queryClient, false)}>Sign out</a>
    </header>
    {lost || access === 'unavailable' ? <AccessProblem /> : access === 'checking' ? <AccessProblem checking /> : <Outlet />}
  </>;
}
