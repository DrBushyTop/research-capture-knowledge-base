import { defineConfig } from 'astro/config';
import { copyFile } from 'node:fs/promises';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';
const mode = process.env.READER_MODE || 'private';
if (mode !== 'private') throw new Error('Only private reader builds are enabled. Public publishing is deferred.');
export default defineConfig({
  output: 'static',
  vite: { plugins: [tailwind()] },
  integrations: [react(), { name: 'publication-boundary', hooks: {
    'astro:build:done': async ({ dir }) => {
      await copyFile(new URL('./staticwebapp.config.json', import.meta.url), new URL('staticwebapp.config.json', dir));
    }
  } }]
});
