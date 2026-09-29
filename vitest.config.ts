import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `react-jsx` is set through esbuild rather than the React plugin, because a
  // test needs the transform but not fast refresh, and pulling the Vite plugin
  // into the root config would need it hoisted to the root.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: [
      'apps/api/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/web/src/**/*.test.tsx',
      'packages/shared/src/**/*.test.ts',
    ],
    globals: true,

    /**
     * The application logger is silent in tests by default.
     *
     * A module-level message — `no frontend build; serving the API only` — is
     * printed once per test that builds a server, which buries a real failure in
     * dozens of repeated lines. The level is still settable, so
     * `LOG_LEVEL=debug pnpm test` shows everything.
     */
    env: {
      LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'silent',
    },
  },
});
