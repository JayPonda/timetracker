# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](VERSIONING.md) — `MAJOR.MINOR.PATCH`, no `v` prefix, `vX.Y.Z` for git
tags.

Unreleased work is listed under **Unreleased**. A release moves to a version heading only
when its exit test has passed, and its git tag `vX.Y.Z` is created at the same moment.

## [Unreleased]

### Fixed

- **Production resolved no principal, so the whole API refused with 403.**
  `createServer` installed a principal resolver only when the caller passed one,
  and production passes none — every guarded route answered 403 while the
  interface loaded and could do nothing. Every test installed its own resolver
  and stayed green, which is why nothing caught it until a live container was
  driven for the exit test. `createServer` now installs the local-user default
  when none is given, and a test builds a resolver-less server (production's
  shape) and proves reads and writes go through. The test fails with the fix
  reverted.

- **The SPA fallback answered DELETE with 200 and `index.html`.** With a web
  build present, `DELETE /projects/1` was served the frontend as a success
  while deleting nothing. The fallback now serves GET and HEAD only; every
  other method falls through to the 404 envelope. Proven with a built frontend
  present, which is the only setup that showed it.

### Added

- **Task history is readable.** `GET /tasks/:id/history` returns the task's log
  newest-first with before and after values, and the detail page renders it as
  lines in the server's time zone. Exit-test step 8 was unrunnable without it:
  history was written on every change and visible nowhere.

- **Projects are usable end to end.** Create, rename, archive and restore projects
  through declared API routes and the `/projects` screen; every write runs in one
  transaction with its activity-log entry. Archived projects stay out of default
  lists and appear only with “Show archived” on; there is no Delete button.
- **Task core is usable end to end.** Create, edit, move between Open and In
  progress, archive and restore tasks through declared routes and the `/tasks`
  screen, with project, status and archive filters, sorting, and the “No project”
  bucket. `started_at` is stamped on the first move to In progress and never
  rewritten. `ended` is not writable anywhere in this slice — by type and by
  test — because only the 0.5.0 closure service may set it.
- **Todos are usable end to end.** Add, rename, tick done, reorder, archive and
  restore phases through declared routes and the task detail page, which also
  gives every task an address (`/tasks/:id`). `done_at` follows the flag from
  the server clock; the client never supplies it. Reorder takes the complete
  order and refuses a partial or foreign one rather than dropping a phase
  silently; restore appends at the end so live positions stay unique.
- **Task links are usable end to end.** Add, edit, archive and restore up to 3
  links per task through declared routes and the detail page's links section.
  The 4th is refused with a message naming the limit of 3, then by the trigger
  for any writer that never calls the service. URLs must parse as absolute;
  positions are service-assigned slots freed by archiving.
- **Acceptance criteria are usable end to end.** Add, edit, reorder, archive and
  restore the definition of done through declared routes and the detail page's
  criteria section, kept visibly separate from todos: no tick box anywhere near
  a condition. Whether a criterion was met is decided at closure in 0.5.0, never
  here; archiving removes one from later closures without touching past records.
- **Reference materials are usable end to end.** Add, edit, archive and restore
  notes, links, snippets, lessons and decisions through declared routes and the
  detail page's references section, with the kind shown in words. An empty URL
  field means no URL, never a blank link. Reads check nothing about the task's
  state and nothing cascades, so a lesson outlives its task by doing nothing.
- **The tag manager is usable end to end.** Create, rename, archive and restore
  tags through declared routes and the `/tags` screen, with one live tag per
  name: clashes fail naming the tag, archiving releases the name, restoring
  under a taken one refuses. New `tag:read`/`tag:create`/`tag:update`
  capabilities say what the assistant may do; `tag:update` is outside its
  maximum set. Attaching tags to entries waits for entries in 0.3.0, which also
  leaves half of exit-test step 5 unrunnable. That was the last domain; the
  release exit test remains blocked.

### Removed

- **Prettier, and with it a `.prettierrc` and two scripts.** Formatting is now
  `@stylistic/eslint-plugin` inside `eslint.config.js`, so `pnpm lint` is the
  linter and the style check in one command and `pnpm lint:fix` is the formatter.

  Prettier was removed because it was producing noise rather than consistency:
  `prettier --write` reflowed every table in `ROADMAP.md` — 305 changed lines
  around a one-line edit — and reformatted a test file a change had never
  touched. A formatter that rewrites files nobody edited costs more to review
  than the consistency it returns, and its own `format:check` was already failing
  on 53 files, so the gate it fed was not a gate.

### Changed

- **ESLint now enforces the house style instead of a second tool disabling it.**
  2-space indent, single quotes, semicolons, trailing commas, as Part 10 of
  `AGENTS.md` already described.

  The 53-file problem disappeared rather than being fixed, and that is the
  evidence: those failures were overwhelmingly markdown, which ESLint does not
  lint. The first rule set reported 204 errors, of which 197 were two of my own
  rules disagreeing with the deliberate existing style — interfaces here are
  written `field: Type;`, and the quotes rule was objecting to multi-line
  template literals. Both rules were changed to match the code, leaving 7 real
  problems fixed in 4 lines: 5 missing trailing newlines and 2 wrong indentation
  inside a template literal.


- **The three migrations are now one, `0001_initial_schema.js`.** The three files
  they replace (`0001_settings`, `0002_data_model`, `0003_invariants`) each opened
  with a version number in a comment — `-- 0002:`, `-- 0003:`, `-- 0004:` — that no
  longer matched their own filenames after the ADR 0012 renumbering. Nobody had
  opened them since. One file cannot carry a stale version number, and the migrator
  container now either produces a complete database or changes nothing at all.

  The DDL is unchanged, and that is verified rather than asserted: all 299
  executable statements are identical to the three files they replace, and a test
  reads the real `sqlite_master` after migrating and asserts 15 user-data tables, 14
  `BEFORE DELETE` triggers and 30 indexes, so a file that quietly lost a table or a
  trigger fails instead of shipping.

  **The next migration to be added is `0002`.**

### Fixed

- **The migrator is verified end to end, and two claims about it were false.**
  Building the container and migrating a real data directory — which had never been
  done — showed the 0.1.0 `schema_migrations` ledger surviving alongside
  `knex_migrations`, contradicting ADR 0012's claim that the latter is the only
  ledger. The release spec's statement that the 0.1.0 upgrade path "was verified
  against a real data directory" had no basis in any test, and every test in the
  suite migrated an empty file.

  **0.2.0 does not upgrade a 0.1.0 data directory; one is discarded and recreated**
  (`D-26`). The owner's call, since nothing is released and the database held one
  archived probe row. The upgrade path was not patched; it was declined.

  What *is* verified, including the failure path: a deliberately broken migration
  exits 1, names itself and the SQL error, names its backup and restores it, rolls
  the partial schema back, and `pdm` does not start because compose waits on
  `service_completed_successfully`.

- **Two tests asserted a hardcoded list of migration names,** so they silently
  stopped covering migrations added later. They now derive the list from the loader
  and the ledger.

- **A test asserted the total number of migrations,** which fails every time one is
  added. It now asserts contiguity, which is the rule that actually holds.

### Added


- **Added** the API foundation layer, the three layers every later service writes
  through. No business entity is served yet; this is the ground they stand on.

  - `apps/api/src/lib/errors.ts` — the typed `AppError` a service throws, and one
    `code → status` map so a refusal keeps its identity instead of having it guessed
    from a message. `validationDetails` turns a Zod failure into
    `details.issues[]` with a dotted field path (`details.owner.name`), and
    deliberately does **not** echo the submitted value, so a failed validation
    cannot be turned into a read-back channel (`UI-08`).
  - `apps/api/src/middleware/error.ts` — the error envelope, extracted from
    `server.ts`. A 5xx is replaced with a generic message and a log line, because a
    SQLite error names a file path and a constraint name. Every error response
    carries the request id, so a bug report can be matched to a line.
  - `apps/api/src/middleware/principal.ts` — the local user and an anonymous
    principal. MCP token resolution is 0.10.0; the seam is built now.
  - `apps/api/src/middleware/services.ts` — one service instance per process,
    reached through a Fastify decorator. A handler that built its own would hold a
    second Knex pool and open a transaction its other writes could not join.
  - `apps/api/src/routes/table.ts` — every route is **declared** with its
    capabilities (`MCP-14`, `DATA-09`). `DELETE` is unrepresentable: `declare`
    throws. A declaration with an empty capability set is refused at boot rather
    than allowed. An `onReady` hook **refuses to boot** if a route exists that the
    table never saw, so a handler added straight to the app cannot ship
    unauthorised.
  - `apps/api/src/repositories/activity-log.repository.ts` and
    `apps/api/src/services/activity-log.service.ts` — the first repository and the
    first service (`FR-STAT-05`). Appends a before/after pair and a changed-field
    diff, and writes nothing when nothing changed.
  - `packages/shared/src/uid.ts` — UUIDv7 through the `nowMs()` seam, which
    nothing previously generated.

- **Added** `@vitest/coverage-v8`, pinned to 2.1.9 to match Vitest 2.1.9. The v8
  provider is the one Vitest 2 supports; the latest release is a v3-era package and
  fails at load with `does not provide an export named 'BaseCoverageProvider'`.

- **Added** an enforced **95%** coverage floor to `vitest.config.ts`, scoped to
  `apps/api/src/services/**` and `packages/shared`. Before this, `pnpm test:coverage`
  measured and exited 0 regardless of the result, so a release Definition-of-Done
  box was being checked by assertion. The floor was verified to actually fail by
  raising it to 100% and watching the command exit 1. `repositories/**` and
  `middleware/**` are reported but not thresholded, deliberately: a query is
  verified by the service test that uses it, and a threshold that scaffolding can
  break is a threshold the team learns to ignore.

- **Changed** CI now runs `pnpm test:coverage` as its own step in the `gates` job
  (`NFR-MAINT-01`), so coverage is a gate on the default branch rather than
  something to remember. It is a separate step and not a flag on `pnpm test` for
  two reasons: a combined step reports a coverage failure as "tests failed", which
  sends the next person to the wrong file; and the instrumented run is slower
  enough that folding it in would buy nothing.

- **Changed** the Vitest reporter is `dot` when `CI` is set and `default` locally,
  overridable with `VITEST_REPORTER`. A CI log currently prints a line per test
  file — 22 files and growing — so a red build opens on noise rather than on the
  cause. `dot` prints a character per file and expands only the failures. The
  tests, assertions and exit code are identical either way, which is why this is
  an environment switch rather than a separate `test:ci` script that could drift
  from `pnpm test`. It is `dot` rather than Vitest's `silent` reporter because
  `silent` hides the failures as well as the passes.

- **Fixed** `dateKeyRange` in `packages/shared/src/time.ts` had no test at all. It
  is a public helper that walks a day range by repeatedly advancing to the next
  local midnight, and it is what day-bucketed reports are built from. Found by
  raising the coverage floor from 80% to 95%, which is the best argument for the
  higher number. It now has six tests, including a DST transition day (where a
  naive 24-hours-per-day implementation drifts) and the 4000-day bound that keeps
  an over-wide range from looping.

- **Added** a project logger, used everywhere instead of `console`. One `Logger`
  class per app, each a singleton exported as `logger`:
  `apps/api/src/lib/logger.ts` and `apps/web/src/lib/logger.ts`. Standard levels
  `trace`, `debug`, `info`, `warn`, `error`, `fatal`, plus `silent`. Every line
  has the same shape, so a log read from the browser and one read from the
  container are grep-able the same way:

  ```text
  [2026-09-29T08:26:23.571Z] [INFO] (migrate.ts) (migrate) migration applied migration=0001_settings
  [2026-09-29T08:25:37.610Z] [INFO] (index.ts) (boot) listening host=0.0.0.0 port=8080 time_zone=UTC
  ```

  `[datetime] [level] (file/class) (method/function) message key=value key1=value2`.
  The level comes from `LOG_LEVEL` in the API and `VITE_LOG_LEVEL` in the browser
  — Vite only exposes `VITE_`-prefixed variables, so the unprefixed name would be
  `undefined` in a bundle. The API's level is validated in `configSchema`, so a
  typo is refused at boot by name; the logger itself degrades to `info` rather
  than throwing, because it is what reports the boot failure. The channel is the
  console, exposed as a `LogChannel` interface so the destination is decided once
  and a test can read what was logged: `warn` and `error` reach `console.warn`
  and `console.error` (stderr), everything else stdout. The API reads `nowMs()`
  for its timestamp (AGENTS.md ground rule 4), so a test can freeze the clock and
  assert on an exact line. Rendering never throws: circular references become
  `[Circular]`, an unserialisable value `[Unserializable]`, and a channel that
  throws is swallowed, because a logger that takes down its caller is worse than
  no log.

### Changed

- **Changed** application logging no longer uses `console`. Every `console.*` call
  in the API — the boot line, the four CLI commands and three app-level messages
  in `server.ts` — now goes through the logger, so one `LOG_LEVEL` controls the
  whole process and every line has the same format. `apps/api/src/main.ts:9` is
  the reason the logger reads the environment itself rather than taking its level
  from `AppConfig`: it reports a `ConfigError` through the logger, which a
  logger depending on a successfully parsed config could not do.
- **Changed** the test suite is quiet by default: `vitest.config.ts` sets
  `LOG_LEVEL=silent` unless the environment already sets it, so a module-level
  line repeated across every test cannot bury a real failure. Run
  `LOG_LEVEL=debug pnpm test` to see everything. `migrate.int.test.ts` pins
  `LOG_LEVEL=info` for the CLI it spawns, because it asserts on the migrator's
  real output.
- **Changed** migrations no longer run through Umzug. Knex runs them and owns the
  ledger: `knex_migrations` replaces the hand-rolled `schema_migrations` table,
  migration `0001_schema_migrations` is gone, and the data-model migrations
  renumber as `0001_settings.js`, `0002_data_model.js`, `0003_invariants.js`. Each
  file embeds the reviewed schema SQL (byte-identical to the hand-written `.sql` it
  replaced) and applies it in one native SQLite transaction. The pre-migration
  backup, the restore-and-abort that names the file, and the contiguity check still
  live in `migrate.ts` (ADR 0012). The immutability checksum is dropped by owner
  decision: `knex_migrations` never carried a checksum, and every migration is
  `IF NOT EXISTS`, so a repeat run is a safe no-op. Upgrade of a live volume is a
  no-op re-run that fills the new ledger; verified against a copy of the real 0.1.0
  data directory (data and settings preserved).
- **Changed** `knex` is now the query-builder dependency of `apps/api`; `umzug` was
  removed. `drizzle-orm` had already been dropped (see 0.1.0 record).
- **Changed** `createServer` now takes the Knex instance instead of opening its own
  connection. It builds the services once, decorates them on the app, and passes the
  instance to the repositories that need it. Opening a connection per test
  application is what made the second pool, and the second transaction that
  would not join the first, easy to write by accident.
- **Changed** an unhandled request error can no longer escape as a default Fastify
  500. `error.ts` handles it, an unparsed `ZodError` from a handler is reported as a
  422 naming the field rather than as a server fault, and the response status and
  the envelope's `code` always agree — so a 403 no longer arrives labelled
  `validation_failed`, which a client could not tell apart from a typo.


## [0.1.0] — Foundation & runtime

Released 2026-09-29. See [`docs/RELEASES/v0.1.0.md`](docs/RELEASES/v0.1.0.md).

### Changed

- **Changed** the database and its backups live in **Docker-managed volumes**
  rather than host bind mounts. Host bind mounts failed intermittently on the
  development machine: same image and same command, 1 of 5 runs migrated from the
  repository folder and 2 of 5 from a local path, against **6 of 6** for a named
  volume. The symptom was `SQLITE_CANTOPEN`, and once the running app was caught
  holding `/data/pdm.db (deleted)` — a live database kept as an unlinked inode that
  disappears on restart. The cause was Docker Desktop's host file-sharing layer, not
  this project's permissions or code. There is now no `mkdir` and no `chown` on a
  fresh install. The database is still a plain SQLite file; `docker compose cp
  pdm:/data/pdm.db ./copy.db` opens it with any client. Acceptance criteria 3, 4, 10
  and 17 and the 0.1.0 exit test were updated to match.

- **Changed** the shell reads `GET /health` and renders the **server's** clock in the
  configured time zone, instead of printing a placeholder. `/health` now carries
  `now_ms`. The browser formats that value and never reads its own clock, so
  `nowMs()` stays the only clock in the codebase and the zone shown is `PDM_TZ` rather
  than the OS setting. Acceptance criterion 11 was not previously met: the web app had
  never made an API call.

- **Changed** the frontend shell has an **Operations** section in `README.md` covering
  install, start, stop, restart, logs, backup, restore, upgrade and removal, including
  starting Docker at login and the fact that there is no `chown` step. The restore
  sequence was executed end to end, not written from memory.

- **Changed** `typecheck`, `test`, `test:watch`, `test:coverage` and `test:int` build
  `@pdm/shared` first. They previously assumed a build had already happened, so they
  **failed on a clean checkout** with `TS2307: Cannot find module '@pdm/shared'` even
  though they were green in a working tree. Acceptance criterion 14 says "from a clean
  install", and it had only ever been checked in a dirty one. Verified in a fresh copy.

### Added

- **Added** continuous integration, `.github/workflows/ci.yml`: the four criterion-14
  gates on a clean checkout on Node 22, plus a job that builds the Docker image and waits
  for it to become healthy, so a native `better-sqlite3` break against a new base image is
  caught on the pull request rather than on the owner's laptop.

- **Added** `DataDirNotWritableError`, raised instead of a raw `SQLITE_CANTOPEN`, naming
  the directory, the uid and the exact `chown` command. The unwritable-directory case is
  now diagnosable from the message.

### Fixed

- **Fixed** three violations of the `nowMs()`-only rule: `Date.now()` was read twice in
  `/health` for the uptime, and `new Date()` once in the backup filename stamp. The
  health and backup tests are now deterministic under a frozen clock.

- **Fixed** vitest covers `apps/web` and transpiles `.tsx`, so the shell's rendering is
  tested. `HealthSummary` was split out of `App` as a pure component precisely so it
  could be rendered and asserted with `renderToStaticMarkup`, with no DOM and no new
  dependency.

- **Changed** migrations are applied by a **one-shot `pdm-migrate` container** from the
  same image, and the application no longer applies them. `pdm` depends on it with
  `service_completed_successfully`, so a failed migration leaves the app not running
  instead of half-started. The server now **refuses** to boot against an un-migrated schema
  with `SchemaNotReadyError` rather than applying anything, and `pnpm dev` runs the same
  migrate command first so local and Docker take the same rule. A failed migration is now
  one container that exited non-zero naming the migration and the backup file. Recorded as
  `D-23` and [ADR 0010](docs/adr/0010-migration-container.md). Consequences worth knowing:
  `docker compose ps -a` now shows two containers, the migrator is normally `exited (0)`,
  `docker compose restart pdm` deliberately does **not** re-run migrations, and a migration
  must be rebuilt into the image before it will run.
- **Changed** migrations are applied by **Umzug** rather than a hand-rolled runner. The
  migration files are still plain, hand-written `.sql`; our code is now a thin wrapper that
  keeps the pre-migration online backup, the restore-and-abort on failure, the
  `schema_migrations` ledger, and the immutability and contiguity checks. The 16 tests in
  `migrate.test.ts` assert the same behaviour as before and pass unchanged. Recorded as
  `D-22` and [ADR 0009](docs/adr/0009-migration-runner-umzug.md). `migrate()` is now
  async, because Umzug's API is; boot already was, so only the test and CLI call sites
  changed. One accepted cost: Umzug records the ledger row after the migration's
  transaction, so a crash in that window leaves a migration applied but unrecorded, and
  the next boot fails loudly with a named backup rather than silently.

### Documentation

- **Added** `AGENTS.md`, rewritten in full as the project constitution: the value loop, the
  eleven ground rules, setup from zero, the command surface, the architecture, the database
  invariants enforced by the schema itself, the request flow, the agreed data model, the
  release workflow, and a table of rejected patterns with the reason each was rejected.
- **Added** `MEMORY.md` for cross-session continuity: a verified environment snapshot, the
  gotchas discovered, the twelve SRS conflicts already resolved, a session log, and open
  threads for the next session.
- **Changed** the monorepo standardises on **pnpm workspaces**; ADR 0001 previously said npm
  while every other document said pnpm. Recorded as `D-21`. The root `package.json` must
  declare `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`, because pnpm 10 and later block
  dependency install scripts by default and `better-sqlite3` needs its install script to
  place or compile the native binding.
- **Added** a closing section to `AGENTS.md` stating which discoveries belong in that file
  and which belong in `MEMORY.md`, so the two do not drift into each other.

### Process

- **Documented** the feature-branch workflow as a standing rule: one feature per branch,
  merged to `main` only after `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, and never
  committed to `main` directly. Merges are squash merges, so `main` gets one Conventional
  Commit per feature. Release tags are placed on the merge commit on `main`, never on a
  branch. Recorded in `AGENTS.md` Part 8, `CONTRIBUTING.md`, `docs/PLAN.md`,
  `docs/RELEASES/README.md` and `VERSIONING.md`.


## Conventions

- **Added** — a new capability.
- **Changed** — an existing capability behaving differently.
- **Fixed** — a defect fix.
- **Security** — a change to the trust boundary, the token, or the permission model.
- **Performance** — a measured change. Every entry here names the scenario and the numbers
  from [`docs/PERF.md`](docs/PERF.md).
- **Docs** — a documentation-only change.
- **Deferred** — a requirement moved out of 1.0.0, always with a link to
  [`docs/DEFERRED.md`](docs/DEFERRED.md).
- **Data** — a migration, or a change to the stored shape. Migrations are always additive
  and always preceded by a backup.

Requirement IDs from the SRS are quoted in entries where a change is traceable to one, for
example `Fixed the closure gate refusing a valid payload when a criterion was archived
(FR-GATE-02)`.
