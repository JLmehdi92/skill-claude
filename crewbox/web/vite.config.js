import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const API = process.env.CREWBOX_API || 'http://127.0.0.1:4747';

export default defineConfig({
  root,
  plugins: [
    react(),
    {
      // In dev, the page is served by Vite: inject the token the API server was started with.
      name: 'crewbox-dev-token',
      apply: 'serve',
      transformIndexHtml: (html) => html.replace('__CREWBOX_TOKEN__', process.env.CREWBOX_UI_TOKEN || 'dev'),
    },
  ],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { '/api': API, '/p': API, '/s': API } },
});
