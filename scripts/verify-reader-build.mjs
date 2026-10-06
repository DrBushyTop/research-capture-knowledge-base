import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'apps/reader/dist';
const allowedTopLevel = new Set(['index.html', 'login.html', 'access.js', 'access.css', 'staticwebapp.config.json', 'assets']);
for (const name of await readdir(root)) {
  if (!allowedTopLevel.has(name)) throw new Error(`Unexpected reader artifact: ${name}`);
}
const files = await readdir(root, { recursive: true });
if (files.some(file => /\.(pdf|docx?|xlsx?|zip)$/i.test(file))) throw new Error('Private source artifact in reader build');
const config = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'));
if (config.navigationFallback) throw new Error('Unguarded navigation fallback in private reader');
if (config.routes.at(-1)?.rewrite !== '/index.html' || !config.routes.at(-1)?.allowedRoles?.includes('library_member')) throw new Error('Reader rewrite must require library_member');
const index = await readFile(join(root, 'index.html'), 'utf8');
if (!index.includes('id="root"') || !index.includes('/assets/')) throw new Error('React entrypoint or built assets missing');
if (index.includes('astro-island') || index.includes('/_astro/')) throw new Error('Astro entrypoint still present');
console.log(`Reader build verified: ${files.length} application files, no static corpus or original files.`);
