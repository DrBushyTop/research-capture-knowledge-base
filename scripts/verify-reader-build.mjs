import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'apps/reader/dist';
const publicPwa = ['manifest.webmanifest', 'pwa.js', 'sw.js', 'offline.html'];
const allowedTopLevel = new Set(['index.html', 'login.html', 'logout.html', 'logout.js', 'access.js', 'access.css', 'staticwebapp.config.json', 'assets', 'icons', ...publicPwa]);
for (const name of await readdir(root)) {
  if (!allowedTopLevel.has(name)) throw new Error(`Unexpected reader artifact: ${name}`);
}
const files = await readdir(root, { recursive: true });
if (files.some(file => /\.(pdf|docx?|xlsx?|zip)$/i.test(file))) throw new Error('Private source artifact in reader build');
const config = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'));
if (config.navigationFallback) throw new Error('Unguarded navigation fallback in private reader');
if (config.routes.at(-1)?.rewrite !== '/index.html' || !config.routes.at(-1)?.allowedRoles?.includes('anonymous')) throw new Error('Reader app shell must load so the backend can validate the rolling session');
const sessionStart = config.routes.find(route => route.route === '/api/session-start');
if (sessionStart?.methods?.length !== 1 || sessionStart.methods[0] !== 'POST' || sessionStart.allowedRoles?.length !== 1 || sessionStart.allowedRoles[0] !== 'authenticated' || config.routes.indexOf(sessionStart) >= config.routes.findIndex(route => route.route === '/api/*')) throw new Error('Session creation must require Azure sign-in before the public API route');
if (config.routes.find(route => route.route === '/assets/*')?.headers?.['Cache-Control'] !== 'public, max-age=31536000, immutable') throw new Error('Versioned public assets must remain browser-cacheable');
const index = await readFile(join(root, 'index.html'), 'utf8');
if (!index.includes('id="root"') || !index.includes('/assets/')) throw new Error('React entrypoint or built assets missing');
if (index.includes('astro-island') || index.includes('/_astro/')) throw new Error('Astro entrypoint still present');
const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
if (manifest.id !== '/' || manifest.scope !== '/' || manifest.start_url !== '/' || manifest.display !== 'standalone') throw new Error('PWA must open the reader directly in standalone mode');
for (const icon of manifest.icons) {
  const png = await readFile(join(root, icon.src.slice(1)));
  const size = Number(icon.sizes.split('x')[0]);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Incorrect PWA icon dimensions: ${icon.src}`);
}
for (const path of [...publicPwa.map(name => '/' + name), '/icons/*']) {
  const route = config.routes.find(route => route.route === path);
  if (!route?.allowedRoles?.includes('anonymous')) throw new Error(`Public PWA resource requires sign-in: ${path}`);
}
for (const entry of ['index.html', 'login.html']) {
  const html = await readFile(join(root, entry), 'utf8');
  if (!html.includes('rel="manifest"') || !html.includes('/manifest.webmanifest') || !html.includes('/pwa.js') || !html.includes('rel="apple-touch-icon"')) throw new Error(`PWA metadata missing from ${entry}`);
}
console.log(`Reader build verified: ${files.length} application files, no static corpus or original files.`);
