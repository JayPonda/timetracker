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
  },
});
