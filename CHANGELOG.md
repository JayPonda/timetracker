# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](VERSIONING.md) — `MAJOR.MINOR.PATCH`, no `v` prefix, `vX.Y.Z` for git
tags.

Unreleased work is listed under **Unreleased**. A release moves to a version heading only
when its exit test has passed, and its git tag `vX.Y.Z` is created at the same moment.

## [Unreleased]

### Added

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
