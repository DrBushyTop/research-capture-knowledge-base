import { copyFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

if ((process.env.READER_MODE || 'private') !== 'private') throw new Error('Only private reader builds are enabled. Public publishing is deferred.');
const root = new URL('.', import.meta.url).pathname;

// Authorized Static Web Apps route rewrites serve this single app entrypoint.
const hosting: Plugin = {
  name: 'reader-hosting',
  apply: 'build',
  async closeBundle() {
    await copyFile(`${root}staticwebapp.config.json`, `${root}dist/staticwebapp.config.json`);
  }
};

export default defineConfig({
  root,
  plugins: [react(), tailwind(), hosting],
  build: { outDir: 'dist', emptyOutDir: true }
});
