import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/api/src/**/*.int.test.ts'],
    globals: true,
    testTimeout: 30000,
  },
});