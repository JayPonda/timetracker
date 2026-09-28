# AGENTS.md

Working agreements for coding assistants and contributors on this repository. Read
[`docs/PLAN.md`](docs/PLAN.md) first — this file tells you *how* to work, not *what* to
work on.

## Before you start

1. Read `docs/PLAN.md` for the current release.
2. Read `docs/RELEASES/vX.Y.Z.md` for the release you are working on. If it does not exist,
   write it before writing code.
3. Check the requirement IDs in scope. They are in the release spec and in the SRS at
   `requirnment.md`.
4. Confirm the release's scope is frozen. If you need something outside it, add it to
   `BACKLOG.md` and stop.

## Commands

Run from the repository root. Node.js 22 or newer.

```bash
pnpm install                  # install everything (workspace root)

pnpm dev                      # run API and web dev servers locally
pnpm build                    # build all workspaces
pnpm lint                     # ESLint
pnpm lint:fix                 # ESLint with autofix
pnpm format                   # Prettier write
pnpm typecheck                # tsc --noEmit across workspaces
pnpm test                     # all tests
pnpm test:watch               # watch mode
pnpm test:coverage            # coverage, fails below 80% on business modules
pnpm test:int                 # integration: SSE, migrations, backup and restore
pnpm test:e2e                 # Playwright (from 1.0.0)
pnpm test -t 'FR-GATE-05'     # one requirement's tests

# Database
pnpm --filter api migrate              # apply migrations
pnpm --filter api migrate:status       # what is applied, what is pending
pnpm --filter api seed:dev             # small demo data
pnpm --filter api seed:perf            # 5,000 tasks / 100,000 entries
pnpm --filter api search:rebuild       # rebuild the search index
pnpm --filter api backup               # take a backup now

# Docker
docker compose up -d                    # start
docker compose logs -f pdm              # logs
docker compose down                     # stop, keep data
docker compose config                   # validate the compose file
```

**The checks that must pass before any change is proposed:** `pnpm lint`, `pnpm typecheck`,
`pnpm test`.

## Layout

```
apps/api/           Fastify API, migrations, scheduler, static file serving
  src/
    config/         Environment parsing, one zod-validated object
    db/             Connection, pragmas, migration runner
    services/       Business rules. The only place that writes to the database
    routes/         HTTP plumbing. No SQL, no business rules
    views/          SQL views for totals
    scheduler/      Reminder loop
apps/web/           Vite + React frontend
  src/
    components/     Shared UI, design tokens
    features/       One folder per domain: timer, tasks, calendar, reminders…
    lib/            Fetch client, query hooks, formatting
apps/mcp/           MCP server                            (from 0.10.0)
packages/shared/    Types and zod schemas shared by api, web and mcp
docs/               Plan, release specs, ADRs, decisions
```

## Conventions that matter here

These are the rules that keep the specific requirements in this project provable. Breaking
one is a defect, not a style choice.

1. **One write path.** Business-rule mutations happen in `apps/api/src/services/**`. Route
   handlers never write SQL. This is what makes `FR-STAT-01` (no ending a task by any
   route), `FR-GATE-08` (gate enforced in the backend) and `MCP-14` (token-scoped
   permissions) testable.
2. **Never delete.** No `delete*` function, no `DELETE` route, no `db.delete()`. Removal sets
   `archived_at` through an `archive*` service function that also writes `activity_log`.
   See [`docs/adr/0002-no-delete-and-archival.md`](docs/adr/0002-no-delete-and-archival.md).
3. **Totals are computed, never stored.** Use the views in `src/views`. If you are about to
   add a `total_seconds` column to a task, stop and read `DATA-04`.
4. **`nowMs()` is the only clock.** Nothing else calls `Date.now()`. Tests depend on this.
5. **Timestamps are epoch milliseconds**, UTC, integers. No date strings, no SQLite date
   functions in the storage path. See
   [`docs/adr/0004-time-and-duration-model.md`](docs/adr/0004-time-and-duration-model.md).
6. **The running timer is a `time_entries` row with `ended_at IS NULL`.** Never cache it in
   memory, in a cookie, or in browser storage. Never write a ticking counter.
7. **Every route declares its capabilities**, and capability checks are default deny. See
   [`docs/adr/0006-mcp-capability-map.md`](docs/adr/0006-mcp-capability-map.md).
8. **Every user-data table has `uid` and `archived_at`** from its first migration.
9. **Any list query filters `archived_at IS NULL`** unless the caller asked for archived
   items.
10. **A new runtime dependency needs an ADR first.** Target is about ten in total.
11. **A new business rule gets a test named after its requirement ID.**
12. **Migrations are plain SQL**, numbered, transactional, and take a backup first.

## Writing tests

See [`docs/TESTING.md`](docs/TESTING.md). The essentials:

- Tests live beside the code: `timer.test.ts` next to `timer.ts`.
- `describe` names the requirement: `describe('FR-TIME-04: only one timer may run')`.
- Use a temp-file or in-memory database. Never mock the database — the triggers and views
  are part of what is under test.
- Freeze the clock with `nowMs()`. Never `await new Promise(setTimeout)` in a test.
- One behaviour per test.

## Working on a release

- Branch: `feature/<release>-<short-description>`, for example
  `feature/0.3.0-timer-start-stop`.
- Commits follow Conventional Commits: `feat(timer): start and stop from the top bar
  (FR-TIME-01)`. Include the requirement ID whenever one applies.
- Update `docs/RELEASES/vX.Y.Z.md` as criteria are met. Do not mark a criterion met until
  it is verified.
- Update `CHANGELOG.md` under **Unreleased** as you go, not at the end.
- Record measured performance changes in `docs/PERF.md`, with numbers.

## Style

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Server: 2-space indent, single quotes, semicolons, trailing commas. Prettier is the
  authority; do not argue with it.
- Named exports, not default exports, except for React components.
- Prefer many small service functions over one large one. A function that touches three
  tables is three functions or a transaction.
- Comments explain *why*, never *what*. No commented-out code.
- No emojis in source. Plain language in the interface: Task, Todo, Acceptance criteria,
  Tag, Reference (`NFR-USE-02`).

## Things that will be rejected

- A delete button, a `DELETE` route, or a `db.delete()`.
- A stored total.
- A new dependency with no ADR.
- A business rule in a route handler.
- A feature that is not in the current release's spec and not in `BACKLOG.md`.
- A test with no requirement ID where one applies.
- A migration that is not additive, or that runs without a backup.
