import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The build output goes to `dist` and the API serves it from there.
 *
 * **No asset CDN and no external font.** `NFR-PRIV-01` forbids any outgoing
 * request, not even a stylesheet or a sound file, so nothing may be referenced
 * by absolute URL and `assetsInlineLimit` stays generous rather than deferring
 * images to a CDN.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 8192,
  },
  server: {
    port: 5173,
    // The dev server proxies to the API, so `pnpm dev` needs no CORS and no
    // second origin in the browser's eyes.
    proxy: {
      '/health': 'http://127.0.0.1:8080',
      '/api': 'http://127.0.0.1:8080',
    },
  },
});
