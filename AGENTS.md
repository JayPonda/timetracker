# AGENTS.md

The working constitution of this repository. It tells you **how to work here** and **what is
true about this project**. `docs/PLAN.md` tells you **what to build right now**; `docs/ROADMAP.md`
tells you **what the whole project is**. This file tells you the rest, including the parts
you would otherwise have to learn by making a mistake.

Read this file completely before writing any code. It is long on purpose.

---

## Part 0 — Thirty seconds

- This is **Personal Day Manager (PDM)**: a single-user, Docker-run day manager. Time
  tracking, projects and tasks, a mandatory acceptance-criteria closure gate, a calendar,
  reminders, a knowledge library, reports, and an MCP server for an AI assistant.
- The product name is **PDM**. The repository, the folder and the container keep their
  existing names. See `docs/DECISIONS.md` `D-20`.
- **The application code does not exist yet.** Release 0.1.0 creates it. Everything below
  marked *planned* describes the agreed design, not existing files.
- **Read `docs/PLAN.md` for the current release**, then that release's spec in
  `docs/RELEASES/`. Do not start work against a blank release.
- **Nothing is ever deleted.** If you are about to write anything that removes a row, stop.
- **Business rules live in services, not in routes.** This is what makes the project's
  hardest requirements provable rather than aspirational.

---

## Part 1 — What this project is

### The product in one paragraph

An office worker works on many tasks a day and currently writes their timesheet from memory
at the end of the day, which is slow and inaccurate. PDM replaces that with one-click
start and stop. It keeps the time, groups it per task, project, tag and phase, and forces a
quality check before a task may be closed: acceptance criteria must be reviewed, and an
unmet criterion requires a written reason for the lag. It keeps lessons and references
attached to the task, and makes them findable later. It plans the day with a calendar and
reminders, including an hourly prompt that shows what is running. It runs in Docker on the
owner's laptop and sends nothing anywhere.

### The value loop everything serves

> start timer → work → stop → see where the time went → close the task with a quality check →
> find the lesson later

**This is the ordering rule for the whole project.** Time capture first, quality gate
second, planning third, recall last, AI interface last. If a change makes this loop
slower, it is the wrong change. If a feature does not serve this loop, it does not go in
before 1.0.0.

### Non-negotiable product characteristics

| Characteristic | Why it matters |
| --- | --- |
| Runs in Docker, installs nothing on the host | `DEP-01`, `C1` |
| All data on the laptop, no external services | `NFR-PRIV-01`, `C3` |
| No outgoing network request, ever — not even a CDN font or a sound file | `NFR-PRIV-01` |
| A running timer survives a refresh, a closed browser and a container restart | `FR-TIME-06` |
| Only one timer at a time | `BR-01` |
| A task cannot be ended without passing the closure gate, **in the backend** | `FR-GATE-08` |
| Nothing is ever deleted; removal is archive, and archive is reversible | `BR-13`, `DATA-09` |
| Totals are computed, never stored | `DATA-04` |
| The assistant can read and create, and can never mutate or close | `MCP-14` |
| The interface is plain: Task, Todo, Acceptance criteria, Tag, Reference | `NFR-USE-02` |

### Where to read more

| I need | Read |
| --- | --- |
| What to build right now | `docs/PLAN.md` |
| Why it is built in this order | `docs/ROADMAP.md` §1 |
| The requirements, with IDs | `requirnment.md` |
| A technical decision and its rejected alternatives | `docs/adr/` |
| A judgement call already made | `docs/DECISIONS.md` |
| What is deliberately not in 1.0.0 | `docs/DEFERRED.md` |
| What happened in earlier sessions | `MEMORY.md` |

---

## Part 2 — The twelve ground rules

These are not style preferences. Each one exists because breaking it makes a specific
requirement untestable. Breaking one is a defect.

### 1. One write path

A write travels **route → service → repository → Knex**, and only in that direction.

- A **route** does HTTP plumbing: parse, validate, authorise, call a service, shape a
  response. No SQL and no business rules.
- A **service** holds the business rule and owns the transaction. It is the only thing that
  decides what a mutation means.
- A **repository** holds the query. Knex, and nothing else. No business rules, and no
  knowledge of *why* the query runs.

The service layer is the only entry point to a write. A repository is never called from a
route, and never decides anything. **The layer was added on 2026-09-29 (`D-25`)**: `knex.ts`
and ADR 0012 both described a three-layer split that this file's layout did not contain, and
rather than delete one of them the owner confirmed three layers and the layout was corrected.

This one rule is what makes three of the project's hardest requirements provable:

- `FR-STAT-01` — a task must never reach Ended by *any* route. If there is exactly one
  function that can set `status = 'ended'`, and it is the closure service, this is provable
  by reading the code. If routes each write their own UPDATE, it is a matter of trust.
- `FR-GATE-08` — the gate is enforced in the backend. Enforced means the service refuses an
  invalid closure payload, not that the interface hides a button.
- `MCP-14` — the assistant can only get and create. A capability map over routes is
  auditable; a hundred route handlers each deciding differently is not.

A function that needs to touch three tables is three functions, or one function with one
transaction. Never a compromise in between.

### 2. Never delete

No `delete*` function. No `DELETE` route. No `db.delete()`. No Delete button in the UI. No
`ON DELETE CASCADE` anywhere. Removal sets `archived_at` through an `archive*` service
function that also writes `activity_log`.

The database additionally blocks hard deletes with `BEFORE DELETE` triggers on 14 of the
15 user-data tables, so a bug cannot erase data either. The exemption is `time_entry_tags`,
a pure join with no independent identity, plus the `knex_migrations*` ledger, which is not
user data. Measured against a migrated database on 2026-09-29; this line said "13" until
then, and the count in `schema.test.ts` was right while the prose was wrong.

`DATA-09`, `DATA-10`, `BR-13`. Full reasoning and the exemption list:
`docs/adr/0002-no-delete-and-archival.md`.

### 3. Totals are computed, never stored

There is no `total_seconds` column on a task. Totals come from SQL views in
`apps/api/src/views/`. If you are about to add a total column, stop and read `DATA-04` — a
stored total is a value that can drift from the entries it summarises, and this project
will not have one of those.

### 4. `nowMs()` is the only clock

Exactly one function in the codebase reads the system clock. Nothing else calls
`Date.now()`, `new Date()` for "now", or `performance.now()`. Tests inject a fake clock
through this one seam; without it, the timer and reminder tests would be timing-dependent
and therefore useless.

### 5. Timestamps are epoch-millisecond integers, UTC

No ISO strings in the storage path. No SQLite `date()` / `datetime()` / `strftime()` in
anything that stores or filters data. Day boundaries are computed in the configured time
zone by one tested helper. `DATA-07`, `NFR-TIME-01`, `docs/adr/0004-time-and-duration-model.md`.

### 6. The running timer lives in the database

The running timer is a `time_entries` row with `ended_at IS NULL`. Not in memory, not in a
cookie, not in `localStorage`, not in a React state that another tab cannot see. Elapsed
time is always derived as `now - started_at`.

There is no ticking counter written anywhere, and no background process keeping a timer
"alive". A timer needs no process to stay running; it is a timestamp.

### 7. Every route declares its capabilities, and checks are default deny

Each route in the route table declares what it does (`task:create`, `time:write`,
`task:close`). A principal carries capabilities: the local user gets all, the MCP token gets
what Settings allows. A route whose capabilities are not in the principal's set is refused
before the handler runs. A route with no declaration is refused. This is what makes `MCP-14`
hold even if the MCP server is rewritten. `docs/adr/0006-mcp-capability-map.md`.

### 8. Every user-data table has `uid` and `archived_at` from its first migration

`uid` is a UUIDv7, unique, assigned once, never changed. It is the key that makes merge-only
import possible (`DATA-13`) and duplicate detection possible (`MCP-27`). Adding `uid` later
means touching every table, every export and every import. Add it in the migration that
creates the table. `docs/adr/0007-backup-export-import.md`.

### 9. Any list query filters `archived_at IS NULL`, unless archived items were asked for

Aggregates go through views that already filter. If you write a new query against a
user-data table, the archived filter is part of the query, not an afterthought.

### 10. A new runtime dependency needs an ADR first

The target is about ten runtime dependencies for the whole product. Each addition is
written up in `docs/adr/` with the alternatives considered and why they lost. This is a
single-user laptop app; a large dependency is a permanent maintenance and supply-chain cost
with no user-visible benefit.

### 11. A new business rule gets a test that names its requirement ID

```ts
describe('FR-GATE-05: an unmet criterion requires a lagging reason', () => { ... })
```

The test name is documentation that cannot go stale, because it is checked against the SRS
in review.

### 12. One logger, used everywhere. No `console`

Every line of application output goes through the `Logger` class, and every call site
passes its own file and function name:

```ts
logger.info('timer.service.ts', 'start', 'timer started', { task_id: 42, todo_id: 7 });
```

```text
[2026-09-29T08:26:23.571Z] [INFO] (timer.service.ts) (start) timer started task_id=42 todo_id=7
```

`[datetime] [level] (file/class) (method/function) message key=value key1=value2`

Four things follow from this, and breaking any of them costs something real:

1. **The whole application is one `LOG_LEVEL`.** Setting it reveals or silences
   everything at once. A codebase with ad-hoc `console` calls cannot answer "what
   was this process doing", because a third of its output went somewhere nobody
   looked.
2. **Every level is used, not just `error`.** `trace`, `debug` and `info` are how
   the *good* path is recorded, which is the point: a log that captures only
   failures cannot answer "what happened at 14:03, and which branch did it take".
   `info` is where a milestone belongs — boot, listen, backup written, timer
   started.
3. **The format never varies.** One shape means `grep '\[ERROR\]'`,
   `grep 'task_id=42'` and a log line from the browser and one from the container
   are read the same way.
4. **Rendering cannot throw.** A circular reference prints `[Circular]`, an
   unserialisable value `[Unserializable]`, and a channel that throws is
   swallowed. A logger that takes down its caller is worse than no log.

The API logger reads `nowMs()` for its timestamp, like everything else (ground
rule 4), so a test can freeze the clock and assert on an exact line.

**The level comes from the environment, but not from `AppConfig`.** The API reads
`LOG_LEVEL`; the browser reads `VITE_LOG_LEVEL`, because Vite only exposes
`VITE_`-prefixed variables to a bundle and an unprefixed name would be
`undefined` in the browser *by construction* — it would look configured and log
at the default. A logger that took its level from a successfully parsed config
could not log the failure that parsing produced, so it reads the variable itself
and `configSchema` validates the same one to catch a typo by name at boot.

See `apps/api/src/lib/logger.ts` and `apps/web/src/lib/logger.ts`. Two classes,
not one shared one: they run in different worlds, and what they deliberately share
is the level names and the line format.

**Renaming a path renames it everywhere, and "everywhere" is wider than the file
you edited.** Moving a route from `/tasks` to `/api/v1/tasks` rewrote the
declarations, the fetches and the tests in one pass — and left five
`logger.debug` labels reading `POST /api/tasks…` in the lines *below* each
declaration. A `sed` over declarations does not touch the string two lines down
that says the same path to a human. The consequence is not a crash: it is a
`grep 'task_id=42'` that finds nothing while the request plainly worked, which
is the failure mode ground rule 12 exists to prevent.

So: **after any bulk rename, grep the old literal again, in every file it
touched** — not only the lines the edit reports. `grep -rn "'/api/tasks" apps/`
took two seconds and found five defects that the test suite rated as green.

### 13. One helper, two callers, two answers

A predicate shared by two call sites is only correct if both callers actually
want the same answer. Check that before assuming it, because a shared helper
that has to compromise answers *wrongly* for somebody, silently, and the
compromise will be written to suit whichever caller was easier to satisfy.

The instance this project paid for, 2026-09-29: the URL scheme
(`docs/adr/0013-versioned-url-namespaces.md`) needed to ask two questions.

| Question | Answer for `/ui/v1/tasks` |
| --- | --- |
| May this URL be **declared** as a route? | **No** — pages are served by the static mount |
| May this **request** be answered with the app shell? | **Yes** — it is the UI |

One function, `isUnprefixedRouteAllowed`, served both. It had to return `true`
for the fallback and `false` for the table, so it returned `true` and the route
table quietly accepted a UI route as a declared one. The split is now
`isDeclaredRouteAllowed` and `isUiPath`, one caller each.

Why the asymmetry is right, and why it is worth the extra function: a declared
route acquires a capability guard, and **an HTML response has no principal to
guard**. Letting a page become a declared route is a category error, not a
stylistic one — it is the same reasoning that keeps business rules out of
repositories, expressed about a different layer.

Two rules follow:

- **Two questions that sound alike are not the same question.** "Can this be
  X?" and "should this be X?" diverge more often than they agree. If you find
  yourself adding a caller to an existing predicate, check whether the new caller
  wants a different answer before reusing it.
- **A test that asks an awkward question is design information.** The test that
  caught this — *"refuses a UI path, because pages are served by the static mount
  not declared"* — was written before the implementation was finished and failed
  on the first run. **A failing test that encodes a rule you have not written down
  is usually the design telling you its shape**, and is worth reading as a
  question rather than debugging away.

The same instinct as ground rules 1 and 11: the guarantee belongs in one place,
and two places that need different answers get two places.

---

## Part 3 — Setup from zero

For a new machine, or a new assistant picking this up cold.

### Prerequisites

| Requirement | Version | Note |
| --- | --- | --- |
| Node.js | 22 or newer | The container pins its own; local dev can be newer |
| pnpm | 10 or newer | See the build-script note below |
| Docker Desktop or Engine | Current | Needed for the exit tests, not for unit tests |
| A C toolchain | Only if a native module must be built from source | `better-sqlite3` normally uses a prebuilt binary |
| Python 3 | Only for the same reason | Used by `node-gyp` |

### Install

```bash
git clone <repo> && cd private-dash-board
pnpm install
```

### Native modules and pnpm's build-script policy

`better-sqlite3` is a native module and its package runs an install script to place or
compile the binary. **pnpm 10 and later do not run dependency install scripts by default.**
The root `package.json` must therefore declare:

```jsonc
{
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

Without this, `pnpm install` appears to succeed and the first query fails with a missing or
invalid native binding. This is the single most likely first-day failure in this repo.

If `better-sqlite3` has no prebuilt binary for the local Node version, it compiles from
source and needs the toolchain. Both have been present on the development machine — see
`MEMORY.md` for the verified snapshot.

### Verify the install

```bash
pnpm typecheck
pnpm test
```

`pnpm test` must be green before you change anything. If it is not green on a clean
checkout, that is a defect to report, not a thing to work around.

---

## Part 4 — Commands

Run from the repository root.

```bash
# Everyday
pnpm install                  # install all workspaces
pnpm dev                      # migrate, then API and web dev servers
pnpm build                    # build all workspaces
pnpm lint                     # ESLint
pnpm lint:fix                 # ESLint with autofix
pnpm typecheck                # tsc --noEmit across workspaces

# Tests
pnpm test                     # everything, once
pnpm test:watch               # watch mode
pnpm test:coverage            # fails below the floors: 95% business, 80% plumbing
pnpm test:int                 # integration: SSE, migrations, backup and restore
pnpm test:e2e                 # Playwright (from 1.0.0)
pnpm test -t 'FR-GATE-05'     # one requirement's tests

# Database
pnpm --filter api migrate            # apply migrations
pnpm --filter api migrate:status     # applied and pending
pnpm --filter api seed:dev           # small demo data
pnpm --filter api seed:perf          # 5,000 tasks / 100,000 entries
pnpm --filter api search:rebuild     # rebuild the search index
pnpm --filter api backup             # take a backup now

# Docker
docker compose up -d                # migrate, then start
docker compose logs -f pdm          # app logs
docker compose logs pdm-migrate     # what the migration container did
docker compose down                 # stop, keep data
docker compose config               # validate the compose file
```

**Before proposing any change, these three must pass:** `pnpm lint`, `pnpm typecheck`,
`pnpm test`.

### When Docker is involved

The app serves the API and the built frontend from **one** process in **one** container.
There is no separate frontend container, no proxy, and no CORS. `pdm-mcp` is the only other
service and arrives in 0.10.0.

**Migrations run in their own container, not at boot.** `pdm-migrate` is a one-shot job
from the same image: it applies every pending migration, seeds settings, and exits. `pdm`
declares `depends_on: pdm-migrate: service_completed_successfully` and is never started
unless the migrator exited 0. Two consequences worth knowing:

- **The application refuses to boot against an un-migrated schema.** It does not apply
  migrations itself; it checks and throws `SchemaNotReadyError`. If you see that error,
  run `docker compose up -d` or `pnpm migrate`, not a manual fix.
- **A migration is baked into the image.** Adding a `.js` migration file requires
  `docker compose build` before `up`, or the container will not see it. This is deliberate:
  the schema is tied to the build that expects it.

`docker compose restart pdm` restarts only the app and does **not** re-run migrations.
Use `docker compose up -d` when the schema changes. `docs/adr/0010-migration-container.md`.

The API listens on `0.0.0.0` **inside** the container on purpose, and the published port is
bound to `127.0.0.1` on the host. Docker's port publishing is the network boundary. Do not
"fix" the bind address to `127.0.0.1` — it breaks the future MCP container's access path.
`docs/adr/0001-stack-and-deployment.md`.

---

## Part 5 — Repository layout

```
requirnment.md          The SRS. 828 lines. The source of every requirement ID.
MEMORY.md               What happened in earlier sessions, and what is true of this machine
AGENTS.md               This file
docs/                   PLAN, ROADMAP, RELEASES, adr, decisions, testing, performance

apps/api/               Fastify REST API, migrations, scheduler, static serving   (0.1.0)
  src/
    config/             Environment parsing. One zod-validated object, read at boot.
    db/                 Connection, pragmas, migration runner, seed scripts
    repositories/       Queries only. Knex, and no business rules.
    services/           Business rules. The ONLY place that calls a repository to write.
    routes/             HTTP plumbing only. No SQL. No business rules.
    views/              SQL views for every total
    scheduler/          The reminder loop (from 0.7.0)
    middleware/         Auth, principal resolution, capability check, error envelope
apps/web/               Vite + React frontend                                     (0.1.0)
  src/
    components/         Shared UI, design tokens
    features/           One folder per domain: timer, tasks, calendar, reminders…
    lib/                Fetch client, query hooks, formatting, date helpers
apps/mcp/               MCP server                                                  (0.10.0)
packages/shared/        Types and zod schemas shared by api, web and mcp             (0.1.0)

data/                   The live database, on the owner's disk        (git-ignored)
backups/                Automatic and manual backups                 (git-ignored)
```

The **route / service / repository split is the most important structural rule in the
repository.** If
you find yourself wanting to write SQL in a route, the thing you want is a service function.

---

## Part 6 — Architecture in one page

### Stack

| Layer | Choice | Note |
| --- | --- | --- |
| Runtime | Node.js 22+, TypeScript strict everywhere | One language across the stack |
| API | Fastify | Schema validation, `app.inject()` for network-free tests |
| Database | SQLite via `better-sqlite3` | Synchronous, so transactions are trivially correct |
| Pragmas | `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL` | WAL for `NFR-REL-01` |
| Data access | Knex query builder and Knex-run migrations over `better-sqlite3` | One way to write queries, not two. `NNNN_name.js` migrations embed the reviewed SQL; the wrapper keeps backup, restore-and-abort and contiguity, and `knex_migrations` is the only ledger (ADR 0012) |
| Frontend | Vite + React + React Router + TanStack Query + Tailwind | Static build served by the same process |
| Monorepo | pnpm workspaces | `onlyBuiltDependencies` required — see Part 3 |
| Scheduler | In-process loop, 1-second tick | Writes only when it actually fires something |
| Alerts | SSE + Notifications API + in-app popup + WebAudio sound | No asset files, therefore no CDN |
| Logging | Own `Logger` class, one per app, console channel | No dependency. One `LOG_LEVEL` for the whole process, one line format (ground rule 12) |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP and stdio | Never touches the database file |
| Tests | Vitest; Playwright from 1.0.0 | `app.inject()` needs no port |

### Database invariants enforced by the schema itself

These are not application logic; they are constraints, so no bug can violate them.

| Invariant | Enforced by | Requirement |
| --- | --- | --- |
| At most one running timer | `CREATE UNIQUE INDEX ... ON time_entries((1)) WHERE ended_at IS NULL` | `DATA-02` |
| At most 3 links per task | `BEFORE INSERT` trigger on `task_links` | `DATA-01`, `BR-04` |
| No hard delete of user data | `BEFORE DELETE` trigger on 14 of 15 tables | `DATA-10` |
| No cascading delete | No `ON DELETE CASCADE` anywhere, `foreign_keys=ON` | `DATA-10` |
| A reminder occurrence is delivered once | `UNIQUE (reminder_id, occurrence_at)` on the delivery ledger | `FR-REM-10` |
| An ended task has a closure record | Enforced in the close service, in one transaction | `DATA-03` |
| A not-fulfilled closure has a reason | Check constraint on `closure_records` | `DATA-03` |
| Every row is traceable and mergeable | `uid` UUIDv7 unique on every user-data table | `DATA-13` |

### How a request flows

```
request
  → middleware: resolve principal          (local user | MCP token | none)
  → middleware: check capabilities         (default deny; declared per route)
  → route handler: parse and validate     (zod schema, shared with web and mcp)
  → service function                      (the business rule, inside a transaction)
  →     writes rows, and writes activity_log
  →     updates the search index, if the entity is searchable
  → response: shape, or a standard error envelope
```

Nothing writes to the database except the service layer. Nothing decides permission except
the capability middleware. The service layer and the capability map are the two places where
a business rule can exist, and each rule belongs in exactly one of them.

---

## Part 7 — The data model

15 entities per SRS §9.1. The schema is written once, in 0.2.0, so no later release needs a
breaking migration. This is the agreed shape, not yet created.

| Table | Purpose | Notes |
| --- | --- | --- |
| `projects` | A container for tasks | Nullable `project_id` on tasks; "No project" is a virtual bucket, not a row (`D-1`) |
| `tasks` | A unit of work | `status` is an enum: `open`, `in_progress`, `ended` (`D-2`) |
| `task_links` | Up to 3 links per task | 4th refused by trigger *and* API |
| `todos` | Phases of a task | Time can be tracked against one |
| `acceptance_criteria` | Definition of done | Never mixed with todos in the interface |
| `closure_records` | One per closure attempt | Append-only; reopening adds a new one |
| `closure_criterion_results` | Snapshot of each criterion at closure | Text is copied, not referenced, so history stays truthful |
| `time_entries` | One span of tracked time | One open row at a time; archived, never deleted |
| `tags` | Labels on entries | Unique name; archived, never deleted |
| `time_entry_tags` | Many-to-many | **No `uid`, no `archived_at`, no delete trigger** — a pure join with no independent identity |
| `reference_materials` | Notes, links, snippets, lessons, decisions | Kept after a task ends |
| `calendar_events` | Events | Repeats expanded when displayed |
| `reminders` | "Remind me at", plus per-event reminders | |
| `settings` | Key and value | Written with defaults on first boot |
| `activity_log` | The task history | Every status change and every post-closure edit |

Derived and system tables, exempt from the no-delete triggers: `knex_migrations`,
`knex_migrations_lock`, `search_documents` and its FTS5 index, `reminder_deliveries`,
`mcp_tokens`, `mcp_audit_log`. Only the first two exist today; the rest arrive with
search (0.8.0), reminders (0.7.0) and the MCP server (0.10.0).

Of the 15 user-data tables, **14 carry `uid TEXT NOT NULL UNIQUE`** (`time_entry_tags` is
exempt) and **13 carry `archived_at`** (`time_entry_tags` and `activity_log` are exempt;
an append-only log that could be archived is a log that could be hidden). Every table
also carries `created_at` and `updated_at` as epoch milliseconds.

---

## Part 8 — Working on a release

### The workflow

1. Read `docs/PLAN.md`. It names the current release and its status.
2. Read that release's spec in `docs/RELEASES/`. **If it does not exist, write it before
   writing code.** The spec has scope, out-of-scope, requirements, acceptance criteria, an
   exit test, and questions.
3. Create a branch: `feature/<version>-<short-description>`.
4. Implement against the acceptance criteria, not against your own idea of the feature.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before proposing anything.
6. Update the release spec: mark criteria met as you verify them. Do not mark a criterion
   met that you have not actually checked.
7. Update `CHANGELOG.md` under **Unreleased** as you go, not at the end.
8. Record measured performance changes in `docs/PERF.md` with numbers.
9. Hand the owner the exit-test script from the spec. The next release does not start until
   it passes.

### Branch and merge policy

**Every feature gets its own branch. Nothing is ever committed directly to `main`.** A
branch is merged to `main` only after its tests pass. This is the owner's standing rule,
stated 2026-09-28, and it is not a style preference: it is what keeps `main` meaning
"everything so far works".

Branch names:

| Prefix | For |
| --- | --- |
| `feature/<version>-<short-description>` | A release's work, e.g. `feature/0.3.0-timer-start-stop` |
| `fix/<short-description>` | A fix to something already merged |
| `docs/<short-description>` | Documentation only |
| `chore/<short-description>` | Tooling, config, dependencies, CI |

The full loop, from `AGENTS.md` to `main`:

```
git switch main
git switch -c feature/0.3.0-timer-start-stop
  … implement, committing as you go with Conventional Commits …
git switch main
git merge --squash feature/0.3.0-timer-start-stop
git commit          # one clean Conventional Commit, requirement IDs in the message
git branch -d feature/0.3.0-timer-start-stop
```

Four rules inside that loop:

1. **No direct commits to `main`.** Not a fix, not a typo, not a doc correction. If it is
   worth changing, it is worth a branch. The two planning commits already on `main` predate
   this rule.
2. **Squash-merge, one commit per feature.** The branch's work-in-progress commits stay on
   the branch; `main` gets a single commit whose message follows the convention below. This
   keeps `main` history readable and makes each merge a reviewable unit.
3. **Merge only when green.** `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass on the
   branch before the merge. A merge to `main` that breaks the build is a rollback on
   `main`, which is worse than a fix still sitting on a branch.
4. **A release is tagged on `main`, never on a branch.** Once the owner has run the exit
   test, tag the merge commit. `VERSIONING.md` has the tag format.

One feature, one branch. A branch that grows into two unrelated features is two branches.

### Scope discipline

**Scope is frozen when a release starts.** Anything discovered mid-release goes to
`BACKLOG.md` with a MoSCoW priority and a target release. It does not enter the current
release. This is the habit that makes 1.0.0 reachable; a release that grows is a release
that slips, and twelve of them are already planned.

If a Must requirement turns out to be ambiguous, write the question into the release spec
rather than deciding it silently in code.

### Commit messages

Conventional Commits, with the requirement ID whenever one applies:

```
feat(timer): start and stop from the top bar (FR-TIME-01, FR-TIME-03)
fix(timer): reject an entry whose end is before its start (FR-TIME-16)
test(gate): confirm stays disabled without a lagging reason (FR-GATE-05)
data(db): add uid and archived_at to task_links (DATA-13)
docs(adr): record the loopback boundary decision (ADR 0001)
chore(api): add the capability map to the route table (MCP-14)
```

Types: `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `chore`, `build`, `ci`, `data`
(for a migration), `security`.

---

## Part 9 — Testing

Full detail in `docs/TESTING.md`. The essentials:

- Tests live beside the code: `timer.test.ts` next to `timer.ts`.
- `describe` names the **requirement**, not the function.
- Every test gets a temp-file or in-memory database. **Never mock the database** — the
  triggers and views are part of what is under test.
- Freeze the clock through `nowMs()`. **Never `await new Promise(setTimeout)`** in a test.
- One behaviour per test. If the name contains "and", split it.
- Service unit tests for rules; `app.inject()` for routes; no network, no ports.
- Coverage floors, both enforced by `pnpm test:coverage`:
  - **≥95%** on `apps/api/src/services/**` and `packages/shared` — the business rules
  - **≥80%** on `apps/api/src/{repositories,middleware,routes,lib}/**` — the plumbing
  - Scaffolding (`App.tsx`, `main.tsx`, `version.ts`) is excluded, because a floor that
    scaffolding can break is a floor people learn to ignore.
  - **Known limitation:** a glob threshold applies to the *aggregate* of the files
    matching it, not per file. `middleware/error.ts` is at 76.47% statements today and
    the gate does not notice, because its group averages 83.05%.
- A bug fix comes with a test that fails without the fix, named after the requirement that
  was broken.

`docs/TESTING.md` §3 lists the 20 non-negotiable tests, each tied to a requirement ID and
the release that must first write it. That list, not a coverage number, is the quality bar.

---

## Part 10 — Style

- TypeScript strict mode everywhere. No `any` without a comment saying why.
- Server: 2-space indent, single quotes, semicolons, trailing commas. **ESLint is the
  authority** (`@stylistic` in `eslint.config.js`); do not argue with it. Prettier was
  removed on 2026-09-29 because it produced noise rather than consistency: it reflowed
  every table in `ROADMAP.md` — 305 changed lines around a one-line edit — and
  reformatted files a change had never touched. `pnpm lint:fix` is the formatter.
- Named exports, not default exports, except React components.
- Comments explain **why**, never **what**. No commented-out code.
- No emojis in source. Plain language in the interface — Task, Todo, Acceptance criteria,
  Tag, Reference (`NFR-USE-02`).
- Many small service functions over one large one.
- Accessibility is not optional: status and result are never communicated by colour alone
  (`UI-12`); every control is reachable and operable from the keyboard (`UI-07`).

---

## Part 11 — Rejected patterns, with the reason

Each of these has been considered and rejected. Reintroducing one is a decision that needs
an ADR, not a matter of style.

| Pattern | Why it is rejected |
| --- | --- |
| Any delete of user data, at any layer | `DATA-09`, `DATA-10`, `BR-13`. The database blocks it too. |
| A stored total, on a task or anywhere | `DATA-04`. It can drift from the entries. |
| SQL or a business rule in a route handler | Breaks `FR-STAT-01`, `FR-GATE-08` and `MCP-14` at once. |
| The running timer in memory, a cookie or browser storage | `FR-TIME-06`. It dies with the tab or the container. |
| A ticking counter or an accumulating seconds column | `A2`. The laptop clock is the source of time; sleep and clock changes would corrupt it. |
| `LIKE '%word%'` for search | `FR-SRCH-05` at `NFR-PERF-02` volume is unreachable without FTS5. |
| A separate search service, vector database, or embedding model | A second persistence target, another backup, and a tension with `NFR-PRIV-01`. |
| Copying the database file to back it up | Unsafe under WAL — the most likely way to lose data quietly. Use the online backup API. |
| Binding the API to `127.0.0.1` inside the container | Breaks the MCP container's access path. The published port is the boundary. |
| Enforcing the assistant's limits in the MCP server | `MCP-14` says "whatever the MCP server sends". The limit belongs in the app. |
| Mounting the database into the MCP container | `MCP-03`. The assistant must go through the API so the rules are enforced once. |
| A cache, a pre-aggregated rollup, or a read replica | A second source of truth. `DATA-04` exists to prevent exactly this. |
| `console.log` / `console.error` called directly | Ground rule 12. A line that bypasses the logger has no level, so no single setting can silence it, and no file or function name, so it cannot be traced |
| A logging dependency (pino, winston, bunyan) | ~50 lines and zero dependencies gets the same thing, on the level names and format this project already documents. The dependency is a permanent supply-chain cost for no user-visible gain — the same argument that removed `umzug` |
| An `OFFSET` based page | Re-reads skipped rows on every page. Use a cursor. |
| A charting library | Two or three charts, one large dependency, and the bundle is paid on every page load. |
| Pagination or caching added "just in case" | `R6` is scope. Add it when a measurement in `docs/PERF.md` says so. |

---

## Part 12 — Keeping this document current

**This file grows as the project teaches you things.** When you discover something that is
true about this project, is not obvious, and would change what a future assistant does, it
belongs here.

The test for adding something:

1. Is it **durable** — true beyond this week's task?
2. Is it **non-obvious** — would a competent developer get it wrong?
3. Would getting it wrong **cost real time or data**?

If all three, add it to the appropriate part of this file, and record the discovery in
`MEMORY.md` with the date and what triggered it.

What goes where:

| Discovery | Goes in |
| --- | --- |
| A rule about how to work here | This file, in the matching part |
| A technical decision with alternatives | `docs/adr/` |
| A judgement call about the product | `docs/DECISIONS.md` |
| What is not in 1.0.0 | `docs/DEFERRED.md` |
| A measured performance number | `docs/PERF.md` |
| **Something that happened, or a fact about this machine** | `MEMORY.md` |

Do not edit the requirement IDs, the release plan, or the acceptance criteria in this file.
Those live in the SRS, `docs/ROADMAP.md` and `docs/RELEASES/`, and duplicating them here
would create two places to keep in sync — the exact problem `DATA-04` exists to prevent.

### Version of this document

| Date | Change |
| --- | --- |
| 2026-09-29 | Removed Prettier; `@stylistic` inside ESLint does the formatting. Triggered by watching `prettier --write` reflow 305 lines of `ROADMAP.md` and reformat a test file nobody had edited. `pnpm lint:fix` replaces `pnpm format`. |
| 2026-09-28 | Rewritten in full, from the beginning, as the project constitution. Standardised on pnpm (was inconsistently documented as npm in ADR 0001). |
| 2026-09-29 | Added ground rule 13, one helper two callers two answers, after the URL scheme needed one predicate to say both yes and no. Triggered by a test asking whether a UI path may be declared as a route — it may not, and the same path must still be served, so the shared predicate had to be wrong for one caller. |
| 2026-09-29 | Added ground rule 12, the one logger, and recorded why the browser reads `VITE_LOG_LEVEL` while the API reads `LOG_LEVEL`. Triggered by adding the logger and finding that an unprefixed name in a Vite bundle is `undefined` by construction — it looks configured and logs at the default. |
