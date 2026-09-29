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
     * `dot` when running in CI, `default` locally.
     *
     * The owner asked for CI to show only what failed, on 2026-09-29. `default`
     * prints a line per test file, so a 300-test run is 300 lines of noise in a
     * build log that nobody reads, and the one failing line is as likely to be
     * scrolled past as read. `dot` prints a character per file and expands only
     * the failures, so a red build opens on the cause.
     *
     * This is a *reporter* change and nothing else: the tests, the assertions and
     * the exit code are identical either way, which is why it is safe to switch on
     * an environment variable rather than being a separate command that can drift
     * from `pnpm test`. Override with `VITEST_REPORTER=verbose` if a run needs the
     * long form locally.
     */
    reporter: process.env['VITEST_REPORTER'] ?? (process.env['CI'] ? 'dot' : 'default'),

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

    /**
     * The 95% floor on business code (AGENTS.md Part 9, the 0.2.0 Definition of
     * Done). Raised from 80% by owner decision on 2026-09-29, and it earned its
     * keep immediately: raising it exposed `dateKeyRange` in `time.ts` having no
     * test at all.
     *
     * Scoped to `services/**` and `packages/shared` because those hold the rules.
     * A threshold on *every* file would be satisfied or broken by scaffolding —
     * `App.tsx`, `main.tsx`, `version.ts` — and would train the team to ignore it,
     * which is the way a threshold stops being a gate.
     *
     * `repositories/**` and `middleware/**` are deliberately **not** in the
     * threshold. A repository is a query, and a query is verified by the service
     * test that uses it; measuring it separately would push tests to exist for
     * coverage's sake rather than for a rule's sake. It is still reported, so a
     * collapse is visible.
     *
     * The floor is what makes `pnpm test:coverage` a gate. Without this block the
     * command exits 0 having measured nothing, which is the state it was in until
     * 2026-09-29.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'apps/api/src/services/**/*.ts',
        'apps/api/src/repositories/**/*.ts',
        'apps/api/src/middleware/**/*.ts',
        'apps/api/src/routes/**/*.ts',
        'apps/api/src/lib/**/*.ts',
        'packages/shared/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/test/**', '**/index.ts', '**/test-support.ts'],
      thresholds: {
        'apps/api/src/services/**': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'packages/shared/src/**': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
