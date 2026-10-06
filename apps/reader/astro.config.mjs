import { defineConfig } from 'astro/config';
import { copyFile, writeFile, readdir, rm } from 'node:fs/promises';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';
const mode = process.env.READER_MODE || 'private';
if (!['private', 'public'].includes(mode)) throw new Error('READER_MODE must be private or public');
export default defineConfig({
  output: 'static',
  vite: { plugins: [tailwind()] },
  integrations: [react(), { name: 'publication-boundary', hooks: {
    'astro:build:done': async ({ dir }) => {
      if (mode === 'private') await copyFile(new URL('./staticwebapp.config.json', import.meta.url), new URL('staticwebapp.config.json', dir));
      else {
        await writeFile(new URL('staticwebapp.config.json', dir), JSON.stringify({ globalHeaders: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } }));
        // Public routes use the standalone search script and have no React islands.
        const assets = new URL('_astro/', dir);
        for (const name of await readdir(assets)) if (name.endsWith('.js')) await rm(new URL(name, assets));
      }
    }
  } }]
});
