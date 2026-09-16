import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
});
