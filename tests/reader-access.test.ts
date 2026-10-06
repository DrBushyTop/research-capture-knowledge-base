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
    if (path !== '/.auth/me') return new Response(denied ? '<h1>Sign in</h1>' : '<div id="root"></div>', { status: denied ? 403 : 200, headers: { 'Content-Type': 'text/html' } });
    if (error === 'network') throw new Error('offline');
    return new Response(JSON.stringify(error === 'malformed' ? {} : { clientPrincipal: principal }), {
      headers: { 'Content-Type': error === 'html' ? 'text/html' : 'application/json' }
    });
  }) as typeof fetch;
  const redirects: string[] = [];
  (dom.window as any).recordRedirect = (path: string) => redirects.push(path);
  dom.window.eval(script.replace('location.replace(destination)', 'window.recordRedirect(destination)'));
  await new Promise(resolve => setTimeout(resolve, 0));
  return { dom, calls, redirects, document: dom.window.document };
}
it('shows ordinary sign in only when the session is signed out', async () => {
  const { dom, calls, document } = await render(null);
  expect(document.querySelector('h1')?.textContent).toBe('Sign in');
  expect(document.querySelector('#primary')?.getAttribute('href')).toContain('/.auth/login/github');
  expect(calls).toHaveLength(1);
  expect(calls[0].options.cache).toBe('no-store');
  dom.window.close();
});
it('explains missing session roles without claiming sign-in or invitation failed', async () => {
  const { dom, document } = await render({ identityProvider: 'github', userDetails: '<DrBushyTop>', userRoles: ['authenticated'] });
  expect(document.querySelector('h1')?.textContent).toBe('Signed in, access unavailable');
  expect(document.querySelector('#message')?.textContent).toContain('<DrBushyTop>');
  expect(document.querySelector('#message')?.innerHTML).toContain('&lt;DrBushyTop&gt;');
  expect(document.querySelector('#primary')?.getAttribute('href')).toBe('/.auth/logout?post_logout_redirect_uri=%2Flogin.html%3FreturnTo%3D%252F');
  expect(document.querySelector('#switch')?.hasAttribute('hidden')).toBe(false);
  dom.window.close();
});
const authorized = { identityProvider: 'github', userDetails: 'DrBushyTop', userRoles: ['reader', 'library_member'] };
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
    expect((document.querySelector('#check') as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toHaveLength(1);
    dom.window.close();
  });
}
