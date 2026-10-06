import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

const html = await readFile('apps/reader/public/login.html', 'utf8');
const script = await readFile('apps/reader/public/access.js', 'utf8');
async function render(principal: unknown, error?: 'network' | 'html' | 'malformed') {
  const dom = new JSDOM(html, { url: 'https://reader.invalid/login.html', runScripts: 'outside-only' });
  const calls: { path: string; options: RequestInit }[] = [];
  dom.window.fetch = (async (path: string, options: RequestInit) => {
    calls.push({ path, options });
    if (error === 'network') throw new Error('offline');
    return new Response(JSON.stringify(error === 'malformed' ? {} : { clientPrincipal: principal }), {
      headers: { 'Content-Type': error === 'html' ? 'text/html' : 'application/json' }
    });
  }) as typeof fetch;
  dom.window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 0));
  return { dom, calls, document: dom.window.document };
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
  expect(document.querySelector('#primary')?.getAttribute('href')).toBe('/.auth/logout?post_logout_redirect_uri=%2Flogin.html');
  expect(document.querySelector('#switch')?.hasAttribute('hidden')).toBe(false);
  dom.window.close();
});
it('lets an authorized session open the app without automatic redirect loops', async () => {
  const { dom, calls, document } = await render({ identityProvider: 'github', userDetails: 'DrBushyTop', userRoles: ['reader', 'library_member'] });
  expect(document.querySelector('#primary')?.getAttribute('href')).toBe('/');
  expect(document.querySelector('h1')?.textContent).toBe('Open the library');
  expect(calls).toHaveLength(1);
  (document.querySelector('#check') as HTMLButtonElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toHaveLength(2);
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
