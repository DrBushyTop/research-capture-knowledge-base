import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useMatches, useRouterState } from '@tanstack/react-router';
import { accessStore, forgetPrivateData } from '../lib/api';

type Access = 'checking' | 'allowed' | 'unavailable';

/** The app session renews on visits and while the reader is visible. Local dev has no hosted authentication. */
function useAccess(): Access {
  const [access, setAccess] = useState<Access>(import.meta.env.DEV ? 'allowed' : 'checking');
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const controller = new AbortController();
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const options: RequestInit = { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) };
        let response = await fetch('/api/session', options);
        let data = response.ok && response.headers.get('content-type')?.includes('application/json') ? await response.json() : undefined;
        if (response.ok && data?.clientPrincipal === null) {
          response = await fetch('/api/session-start', options);
          data = response.ok && response.headers.get('content-type')?.includes('application/json') ? await response.json() : undefined;
        }
        if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error('Session service unavailable');
        const principal = data?.clientPrincipal;
        if (disposed) return;
        const roles: unknown = principal?.userRoles;
        setAccess(principal?.identityProvider === 'github' && Array.isArray(roles) && roles.includes('reader') && roles.includes('library_member') ? 'allowed' : 'unavailable');
      } catch {
        if (!disposed) setAccess(previous => previous === 'checking' ? 'unavailable' : previous);
      } finally { pending = false; }
    };
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const timer = setInterval(whenVisible, 10 * 60_000);
    document.addEventListener('visibilitychange', whenVisible);
    window.addEventListener('focus', whenVisible);
    return () => {
      disposed = true; controller.abort(); clearInterval(timer);
      document.removeEventListener('visibilitychange', whenVisible);
      window.removeEventListener('focus', whenVisible);
    };
  }, []);
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
      <form className="sign-out" action="/api/logout" method="POST" onSubmit={() => forgetPrivateData(queryClient, false)}><button type="submit">Sign out</button></form>
    </header>
    {!lost && access === 'allowed' && <aside className="install-recommendation" aria-label="Install Shelf" hidden>
      <div><strong>Add Shelf to your phone</strong><p className="install-message">Open the library from your home screen.</p></div>
      <div className="install-actions"><button className="install-app" type="button">Add to home screen</button><button className="dismiss-install" type="button">Not now</button></div>
    </aside>}
    {lost || access === 'unavailable' ? <AccessProblem /> : access === 'checking' ? <AccessProblem checking /> : <Outlet />}
  </>;
}
