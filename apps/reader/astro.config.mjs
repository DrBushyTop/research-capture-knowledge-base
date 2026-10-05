import { defineConfig } from 'astro/config';
import { copyFile, writeFile } from 'node:fs/promises';
const mode = process.env.READER_MODE || 'private';
if (!['private', 'public'].includes(mode)) throw new Error('READER_MODE must be private or public');
export default defineConfig({
  output: 'static',
  integrations: [{ name: 'publication-boundary', hooks: {
    'astro:build:done': async ({ dir }) => {
      if (mode === 'private') await copyFile(new URL('./staticwebapp.config.json', import.meta.url), new URL('staticwebapp.config.json', dir));
      else await writeFile(new URL('staticwebapp.config.json', dir), JSON.stringify({ globalHeaders: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } }));
    }
  } }]
});
