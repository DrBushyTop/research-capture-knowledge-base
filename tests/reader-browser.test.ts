import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { normalize } from '../shared/corpus.js';
import { snapshot } from './fixtures.js';
import { Module } from 'node:module';

it('bundles the chat and source conversation for browsers without Node dependencies', async () => {
  const result = await build({
    entryPoints: ['apps/reader/src/components/Chat.tsx', 'apps/reader/src/components/SourceAsk.tsx', 'apps/reader/src/components/Sources.tsx'],
    outdir: 'reader-test', bundle: true, platform: 'browser', write: false,
    loader: { '.css': 'empty' }, logLevel: 'silent'
  });
  expect(result.outputFiles).toHaveLength(3);
});

it('renders full-height chat and sources shells before client hydration', async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import Chat from './apps/reader/src/components/Chat';
        import Sources from './apps/reader/src/components/Sources';
        export const chat = renderToStaticMarkup(React.createElement(Chat));
        export const sources = renderToStaticMarkup(React.createElement(Sources));`,
      resolveDir: process.cwd(), loader: 'tsx'
    },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    loader: { '.css': 'empty' }, logLevel: 'silent'
  });
  const compiled = new Module(`${process.cwd()}/reader-render-test.cjs`);
  compiled.require = createRequire(`${process.cwd()}/reader-render-test.cjs`);
  (compiled as Module & { _compile(code: string, filename: string): void })._compile(result.outputFiles[0].text, 'reader-render-test.cjs');
  const rendered = compiled.exports;
  expect(rendered.chat).toContain('class="discussion-chat"');
  expect(rendered.chat).toContain('id="main"');
  expect(rendered.chat).toContain('id="chat-message"');
  expect(rendered.sources).toContain('sources-shell is-index');
  expect(rendered.sources).toContain('id="main"');
  expect(rendered.sources).toContain('Loading sources');
});


it('replaces the reader and conversation when changing sources instead of leaving orphan panes', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/sources/' });
  const names = ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'Element', 'Event', 'MouseEvent', 'localStorage', 'matchMedia'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const oldFetch = globalThis.fetch;
  const oldAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as any)[name] });
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as any;
    dom.window.HTMLElement.prototype.scrollTo = () => {};
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const source = normalize(snapshot)[0].source;
    const entries = ['alpha', 'beta'].map(id => ({ note: {
      schemaVersion: 1, source: { ...source, id, title: id }, analysis: null,
      extraction: { status: 'text', method: 'html', reason: null }, processing: { processedAt: '2026-10-06T00:00:00Z' }
    }, humanHtml: '', searchText: '' }));
    globalThis.fetch = async input => new Response(JSON.stringify(String(input).includes('library=1') ? entries
      : String(input).includes('notes=') ? { markdown: '', revision: 'r' } : { text: '' }), { headers: { 'Content-Type': 'application/json' } });
    const result = await build({
      stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Sources from './apps/reader/src/components/Sources'; export {React, createRoot, Sources};`, resolveDir: process.cwd(), loader: 'tsx' },
      bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty' }, logLevel: 'silent'
    });
    const compiled = new Module(`${process.cwd()}/reader-interaction-test.cjs`);
    compiled.require = createRequire(`${process.cwd()}/reader-interaction-test.cjs`);
    (compiled as any)._compile(result.outputFiles[0].text, 'reader-interaction-test.cjs');
    const { React, createRoot, Sources } = compiled.exports;
    const root = createRoot(dom.window.document.querySelector('#app'));
    await React.act(async () => { root.render(React.createElement(Sources)); });
    for (let i = 0; i < 20; i++) {
      const id = i % 2 ? 'beta' : 'alpha';
      await React.act(async () => { dom.window.document.querySelector(`.source-rows a[href$="=${id}"]`)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
      expect(dom.window.document.querySelectorAll('main')).toHaveLength(1);
      expect(dom.window.document.querySelector('.sources-shell')!.children).toHaveLength(3);
      expect(dom.window.document.querySelector('.note-head h1')!.textContent).toBe(id);
    }
    await React.act(async () => { root.unmount(); });
  } finally {
    globalThis.fetch = oldFetch;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = oldAct;
    names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else delete (globalThis as any)[name]; });
    dom.window.close();
  }
});
