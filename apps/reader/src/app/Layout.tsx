import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useMatches, useRouterState } from '@tanstack/react-router';
import { Ellipsis, LogOut, Tags } from 'lucide-react';
import { accessStore, forgetPrivateData } from '../lib/api';
import { MastheadSlots } from './masthead';

type Access = 'allowed' | 'unavailable';

/** The browser retains the HttpOnly cookie. Renewal must not block the reader; each private API validates the session. */
function useAccess(): Access {
  const queryClient = useQueryClient();
  const [access, setAccess] = useState<Access>('allowed');
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
        const readSession = async (response: Response) => {
          if (response.status === 401 || response.status === 403) return { clientPrincipal: null };
          if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Session service unavailable');
          const data = await response.json();
          if (!data || !Object.hasOwn(data, 'clientPrincipal')) throw new Error('Invalid session response');
          return data;
        };
        let data = await readSession(response);
        if (response.ok && data?.clientPrincipal === null) {
          response = await fetch('/api/session-start', options);
          data = await readSession(response);
        }
        const principal = data?.clientPrincipal;
        if (disposed) return;
        const roles: unknown = principal?.userRoles;
        if (principal?.identityProvider !== 'github' || !Array.isArray(roles) || !roles.includes('reader')) {
          forgetPrivateData(queryClient);
          setAccess('unavailable');
        }
      } catch {
        // A failed renewal does not revoke a session. Private APIs still check its expiry and allowlist.
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
  }, [queryClient]);
  return access;
}

function AccessProblem() {
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
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  const slots = useMemo(() => ({ start, end }), [start, end]);
  const current = (active: boolean) => active ? 'page' as const : undefined;
  return <MastheadSlots.Provider value={slots}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead">
      <Link className="masthead-brand" to="/">Research library</Link>
      <div className="masthead-start" ref={setStart} />
      <nav aria-label="Library">
        <Link to="/" aria-current={current(path === '/' || path.startsWith('/chat/'))}>Chat</Link>
        <Link to="/sources/" aria-current={current(path.startsWith('/sources/'))}>Sources</Link>
      </nav>
      <div className="masthead-actions">
        <div className="masthead-end" ref={setEnd} />
        <MoreMenu categories={path.startsWith('/categories/')} signOut={() => forgetPrivateData(queryClient, false)} />
      </div>
    </header>
    {!lost && access === 'allowed' && <aside className="install-recommendation" aria-label="Install Shelf" hidden>
      <div><strong>Add Shelf to your phone</strong><p className="install-message">Open the library from your home screen.</p></div>
      <div className="install-actions"><button className="install-app" type="button">Add to home screen</button><button className="dismiss-install" type="button">Not now</button></div>
    </aside>}
    {lost || access === 'unavailable' ? <AccessProblem /> : <Outlet />}
  </MastheadSlots.Provider>;
}

/** Categories is a rarely used admin page and sign-out is rarer still, so both live behind one menu. */
function MoreMenu({ categories, signOut }: { categories: boolean; signOut: () => void }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className="masthead-tool masthead-more" aria-label={categories ? 'More, Categories open' : 'More'} data-current={categories || undefined}>
      <Ellipsis size={22} aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Portal><Popover.Content className="masthead-menu" align="end" sideOffset={6} collisionPadding={8}>
      <Link to="/categories/" aria-current={categories ? 'page' : undefined} onClick={() => setOpen(false)}><Tags size={18} aria-hidden="true" />Categories</Link>
      <a href="/logout.html" onClick={signOut}><LogOut size={18} aria-hidden="true" />Sign out</a>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
