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
     * Two coverage floors, and the difference between them matters.
     *
     * **95% on business code** — `services/**` and `packages/shared` (AGENTS.md
     * Part 9, the 0.2.0 Definition of Done). Raised from 80% by owner decision
     * on 2026-09-29, and it earned its keep immediately: raising it exposed
     * `dateKeyRange` in `time.ts` having no test at all.
     *
     * **80% on plumbing** — `repositories/**`, `middleware/**`, `routes/**` and
     * `lib/**`, also by owner decision on 2026-09-30. These were previously
     * measured but **not gated**, on the argument that a repository is a query
     * verified by the service test that uses it, so gating it separately pushes
     * tests to exist for coverage's sake. The owner overrode that: an ungated
     * number is a number that can collapse unnoticed, and "the service test
     * covers it" is true right up until someone adds a branch nobody exercises.
     *
     * Kept out of the threshold entirely, and deliberately: `App.tsx`,
     * `main.tsx`, `version.ts` and other scaffolding. A floor that scaffolding
     * can break is a floor the team learns to ignore, which is how a threshold
     * stops being a gate.
     *
     * **A known hole, stated rather than hidden.** A glob threshold applies to
     * the **aggregate** of the files matching it, not to each file on its own.
     * So `middleware/error.ts` sits at 76.47% statements and 66.66% functions
     * today, and the gate does not notice, because `middleware/**` averages
     * 83.05%. One file can therefore fall well below 80% while its group holds
     * the line. Closing that needs either `perFile: true` — which would also
     * apply per file to the 95% business floor and fail on
     * `closure.service.ts` at 94.77%, so it is not free — or per-file
     * thresholds listed by hand. Left as the owner set it; see MEMORY.md.
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
        'apps/api/src/repositories/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'apps/api/src/middleware/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'apps/api/src/routes/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'apps/api/src/lib/**': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
