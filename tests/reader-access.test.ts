import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

const html = await readFile('apps/reader/public/login.html', 'utf8');
const script = await readFile('apps/reader/public/access.js', 'utf8');
async function render(principal: unknown, error?: 'network' | 'html' | 'malformed', url = 'https://reader.invalid/login.html', denied = false) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const calls: { path: string; options: RequestInit }[] = [];
  dom.window.fetch = (async (path: string, options: RequestInit) => {
    calls.push({ path, options });
    if (path === '/api/session-start') return new Response('<h1>Sign in</h1>', { status: 401, headers: { 'Content-Type': 'text/html' } });
    if (path !== '/api/session' && path !== '/.auth/me') return new Response(denied ? '<h1>Sign in</h1>' : '<div id="root"></div>', { status: denied ? 403 : 200, headers: { 'Content-Type': 'text/html' } });
    if (error === 'network') throw new Error('offline');
    return new Response(JSON.stringify(error === 'malformed' ? {} : { clientPrincipal: principal }), {
      headers: { 'Content-Type': error === 'html' ? 'text/html' : 'application/json' }
    });
  }) as typeof fetch;
  const redirects: string[] = [];
  (dom.window as any).recordRedirect = (path: string) => redirects.push(path);
  dom.window.eval(script.replaceAll('location.replace(destination)', 'window.recordRedirect(destination)').replaceAll('location.replace(login)', 'window.recordRedirect(login)'));
  await new Promise(resolve => setTimeout(resolve, 0));
  return { dom, calls, redirects, document: dom.window.document };
}
it('automatically starts GitHub sign-in when the session is signed out', async () => {
  const { dom, calls, document, redirects } = await render(null);
  expect(document.querySelector('h1')?.textContent).toBe('Signing you in');
  expect(redirects).toEqual([document.querySelector('#primary')?.getAttribute('href')]);
  expect(document.querySelector('#primary')?.hasAttribute('hidden')).toBe(true);
  expect(document.querySelector('#check')).toBeNull();
  expect(document.querySelector('#primary')?.getAttribute('href')).toContain('/.auth/login/github');
  expect(calls).toHaveLength(3);
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.cache).toBe('no-store');
  dom.window.close();
});
it('stays on the login page after deliberate sign-out until the user chooses to sign in', async () => {
  const { dom, calls, document, redirects } = await render(null, undefined, 'https://shelf.huuhka.net/login.html?signedOut=1&returnTo=%2Fsources%2F');
  expect(redirects).toEqual([]);
  expect(calls).toHaveLength(0);
  expect(document.querySelector('h1')?.textContent).toBe("You're signed out");
  expect(document.querySelector('#primary')?.hasAttribute('hidden')).toBe(false);
  expect(document.querySelector('#primary')?.textContent).toBe('Sign in with GitHub');
  const login = new URL(document.querySelector('#primary')!.getAttribute('href')!, dom.window.location.href);
  expect(login.pathname).toBe('/.auth/login/github');
  expect(login.searchParams.get('post_login_redirect_uri')).toBe('/login.html?returnTo=%2Fsources%2F&signIn=returned');
  expect(document.querySelector('#switch')?.hasAttribute('hidden')).toBe(true);
  dom.window.close();
});
it('explains denied access without treating a GitHub identity as a Shelf session', async () => {
  const { dom, document } = await render({ identityProvider: 'github', userDetails: '<DrBushyTop>', userRoles: ['authenticated'] });
  expect(document.querySelector('h1')?.textContent).toBe('Signed in, access unavailable');
  expect(document.querySelector('#message')?.textContent).toContain('<DrBushyTop>');
  expect(document.querySelector('#message')?.textContent).toContain("Shelf's allowed account list");
  expect(document.querySelector('#message')?.innerHTML).toContain('&lt;DrBushyTop&gt;');
  expect(document.querySelector('#primary')?.getAttribute('href')).toBe('/logout.html?returnTo=%2Flogin.html%3FreturnTo%3D%252F');
  expect(document.querySelector('#switch')?.hasAttribute('hidden')).toBe(false);
  dom.window.close();
});
const authorized = { identityProvider: 'github', userDetails: 'DrBushyTop', userRoles: ['authenticated', 'reader'] };
it('automatically opens the requested source for an authorized session', async () => {
  const { dom, redirects } = await render(authorized, undefined, 'https://reader.invalid/sources/?source=abc');
  expect(redirects).toEqual(['/sources/?source=abc']);
  dom.window.close();
});
it('preserves an explicit safe return target through login', async () => {
  const { dom, redirects } = await render(authorized, undefined, 'https://reader.invalid/login.html?returnTo=%2Fchat%2Fabc%2F');
  expect(redirects).toEqual(['/chat/abc/']);
  dom.window.close();
});
it('keeps custom-domain sign-in and return paths on the custom domain', async () => {
  const { dom, calls, document } = await render(null, undefined, 'https://shelf.huuhka.net/sources/?source=abc');
  const login = new URL(document.querySelector('#primary')!.getAttribute('href')!, dom.window.location.href);
  expect(login.origin).toBe('https://shelf.huuhka.net');
  expect(login.pathname).toBe('/.auth/login/github');
  expect(login.searchParams.get('post_login_redirect_uri')).toBe('/login.html?returnTo=%2Fsources%2F%3Fsource%3Dabc&signIn=returned');
  expect(calls[0].path).toBe('/api/session');
  expect(calls[0].options.credentials).toBe('same-origin');
  dom.window.close();
});
it('does not redirect an authorized identity when the protected page still returns 403', async () => {
  const { dom, redirects, document } = await render(authorized, undefined, 'https://reader.invalid/login.html', true);
  expect(redirects).toEqual([]);
  expect(document.querySelector('h1')?.textContent).toBe('Access could not be confirmed');
  dom.window.close();
});
it('rejects external return targets', async () => {
  const { dom, redirects } = await render(authorized, undefined, 'https://reader.invalid/login.html?returnTo=https%3A%2F%2Fevil.example');
  expect(redirects).toEqual(['/']);
  dom.window.close();
});
for (const error of ['network', 'html', 'malformed'] as const) {
  it(`shows a retryable identity error for ${error} without treating it as denied access`, async () => {
    const { dom, calls, document } = await render(null, error);
    expect(document.querySelector('h1')?.textContent).toBe('Could not check access');
    expect(document.querySelector('#check')).toBeNull();
    expect(document.querySelector('#primary')?.hasAttribute('hidden')).toBe(false);
    expect(calls).toHaveLength(1);
    dom.window.close();
  });
}

it('stops automatic sign-in when GitHub returns without a session', async () => {
  const { dom, document, redirects } = await render(null, undefined, 'https://reader.invalid/login.html?returnTo=%2Fchat%2Fabc%2F&signIn=returned');
  expect(redirects).toEqual([]);
  expect(document.querySelector('#primary')?.hasAttribute('hidden')).toBe(false);
  expect(document.querySelector('#message')?.textContent).toContain('did not complete sign-in');
  dom.window.close();
});
it('stops another automatic attempt after returning with the browser back button', async () => {
  const { dom, redirects } = await render(null);
  redirects.length = 0;
  dom.window.eval('void checkAccess()');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(redirects).toEqual([]);
  expect(dom.window.document.querySelector('#primary')?.hasAttribute('hidden')).toBe(false);
  dom.window.close();
});
it('offers session refresh rather than bypassing the protected-page loop guard', async () => {
  const { dom, redirects, document } = await render(authorized);
  redirects.length = 0;
  dom.window.eval('void checkAccess()');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(redirects).toEqual([]);
  expect(document.querySelector('#primary')?.textContent).toBe('Refresh sign-in');
  expect(document.querySelector('#primary')?.getAttribute('href')).toContain('/logout.html');
  dom.window.close();
});
