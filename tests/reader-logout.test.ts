import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

const html = await readFile('apps/reader/public/logout.html', 'utf8');
const script = await readFile('apps/reader/public/logout.js', 'utf8');
function render(query = '') {
  const dom = new JSDOM(html, { url: 'https://shelf.huuhka.net/logout.html' + query, runScripts: 'outside-only' });
  const submitted: string[] = [];
  dom.window.HTMLFormElement.prototype.requestSubmit = function () { submitted.push(this.action); };
  dom.window.eval(script);
  return { dom, submitted, document: dom.window.document };
}

it('submits logout through a same-origin POST and preserves the requested login return path', () => {
  const { dom, submitted, document } = render('?returnTo=%2Flogin.html%3FreturnTo%3D%252Fsources%252F');
  expect(document.querySelector('form')?.method).toBe('post');
  expect(submitted).toEqual(['https://shelf.huuhka.net/api/logout?returnTo=%2Flogin.html%3FreturnTo%3D%252Fsources%252F']);
  dom.window.close();
});

it('offers a manual retry after logout failure without automatically submitting again', () => {
  const { dom, submitted, document } = render('?failed=1&returnTo=%2Flogin.html%3FreturnTo%3D%252Fsources%252F');
  expect(submitted).toEqual([]);
  expect(document.querySelector('h1')?.textContent).toBe('Could not confirm sign-out');
  expect(document.querySelector('p')?.textContent).toBe('Try again to finish signing out.');
  expect(document.querySelector('button')?.textContent).toBe('Try again');
  expect(new URL(document.querySelector('form')!.action).searchParams.get('returnTo')).toBe('/login.html?returnTo=%2Fsources%2F');
  dom.window.close();
});
