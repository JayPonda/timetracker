import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { API_V1, UI_V1 } from '@pdm/shared';

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
  // Bundles are requested from `/ui/v1/assets/...` so the frontend occupies one
  // namespace and cannot collide with an API path (ADR 0013). The API serves
  // this directory mounted at the same prefix, and the browser router runs with
  // `basename={UI_V1}`, so all three read the same constant rather than three
  // copies of the string.
  //
  // The trailing slash is Vite's convention for a directory base and is the one
  // place the two forms of the prefix meet: `UI_V1` is `/ui/v1` and this is
  // `/ui/v1/`.
  base: `${UI_V1}/`,
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
      // The probes are unversioned by design (ADR 0013), so they are listed
      // alongside the API namespace rather than derived from `API_V1`.
      '/health': 'http://127.0.0.1:8080',
      '/ready': 'http://127.0.0.1:8080',
      [API_V1]: 'http://127.0.0.1:8080',
    },
  },
});
