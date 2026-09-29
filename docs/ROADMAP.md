# PDM Roadmap — 0.1.0 to 1.0.0

**Personal Day Manager (PDM)** · single-user, Docker-run, all data on the laptop.
Source of truth for *what gets built, in which order, and when it is finished*.

- Requirements: [`../requirnment.md`](../requirnment.md) (the SRS, 828 lines)
- Day-to-day status: [`PLAN.md`](PLAN.md)
- Reading order: [`INDEX.md`](INDEX.md)
- Version policy: [`../VERSIONING.md`](../VERSIONING.md)

Status: **plan approved by owner, nothing implemented yet.** Last updated 2026-09-28.

---

## 1. Product strategy

### 1.1 The one loop that creates the value

Every feature in the SRS exists to serve a single loop:

> start timer → work → stop → see where the time went → close the task with a quality
> check → find the lesson later

If that loop is not excellent, nothing else matters. The sequencing rule for the whole
plan is therefore:

> **time capture first, quality gate second, planning third, recall last, AI interface last.**

Nothing is allowed to delay the timer. A release that makes the timer slower, or that
serves a feature the loop does not need, is the wrong release.

### 1.2 Why this ordering, from the user's stated pain

| Pain (SRS §1.2) | Which release fixes it | User-visible change |
| --- | --- | --- |
| Entering time at end of day from memory is slow and wrong | 0.3.0, 0.4.0 | One click to start, one click to stop, Day log with copy-for-timesheet text |
| Tasks closed without meeting their acceptance criteria | 0.5.0 | Closure gate: cannot end a task without ticking ACs; unmet AC needs a written reason |
| Cannot tell where time went (task, project, tag, phase) | 0.3.0, 0.4.0 | Totals per task/todo/tag/project/phase, reports, day log grouping |
| Lessons and references lost by the end of the week | 0.8.0 | Reference materials on the task, global search under 1 second |
| No plan for the day, no nudge during the day | 0.6.0, 0.7.0 | Calendar, events, custom reminders, hourly "what am I doing?" pulse |
| Assistant cannot help recall past work | 0.10.0, 0.11.0 | MCP server, read-only first, then safe creates |

### 1.3 What the SRS gets right

The SRS is unusually complete and the build will not redesign it. Specifically:

- Every requirement has an ID (`FR-TIME-03`, `DEP-07`, `DATA-10`, `MCP-14`) so anything
  built can be traced to a requirement, a test and a release.
- MoSCoW priorities, a data model with 15 entities, business rules `BR-01`…`BR-16`.
- A hard quality rule: the closure gate is enforced in the backend, not only the UI
  (`FR-GATE-08`).
- A no-delete policy (`DATA-09`…`DATA-13`) that protects the only data the user has.
- Exit tests per release phase (§13.1) and a written AI boundary (§14).
- Concrete performance and data-volume targets (`NFR-PERF-01`…`03`).

### 1.4 What the SRS gets wrong or leaves open

Found during analysis of the SRS. Each item is **resolved in this plan** so the build
never trips on it. Full rationale lives in the ADRs.

| # | Finding | Resolution | ADR |
| --- | --- | --- | --- |
| S1 | **Conflict.** `DEP-02`/`NFR-SEC-01` require loopback-only, but the `pdm-mcp` container must reach the app over the Compose network. If the app binds `127.0.0.1` *inside* the container, inter-container calls fail. | The app binds `0.0.0.0` **inside** the container. The loopback boundary is Docker's published port: `127.0.0.1:${PDM_PORT}:8080`. The app is still unreachable from the LAN. | [0001](adr/0001-stack-and-deployment.md) |
| S2 | **Conflict.** `DATA-10` ("no cascading deletes", block `DELETE`) collides with derived data that must be rebuilt (search index) and with per-occurrence rows. | `BEFORE DELETE` triggers are installed on the 11 **user-data tables only**. System tables are exempt and listed by name in the ADR. No `ON DELETE CASCADE` anywhere; `PRAGMA foreign_keys=ON`. | [0002](adr/0002-no-delete-and-archival.md) |
| S3 | **Conflict.** `DATA-04` (totals computed from entries) vs `FR-TIME-17` (midnight-crossing entries split by day). Two rules can disagree. | One rule: a **task total** is the full entry; a **day total** is the sum of each entry's *overlap* with that local day. Day splitting is computed, never stored. | [0004](adr/0004-time-and-duration-model.md) |
| S4 | **Gap.** Nothing says what happens to a **running timer when its task or project is archived**, nor whether a **running entry can be edited**. | Archiving a task/project with a live timer stops and saves the entry first. A running entry allows todo/tag/note changes (`FR-TIME-02`) but not `started_at`/`ended_at` edits. | [0003](adr/0003-running-timer-state.md) |
| S5 | **Gap.** `DATA-13` says import merges only, but there is no stable cross-instance identity, so merging is unsafe. | Every entity gets `uid` (UUIDv7) + `archived_at`. Import = `INSERT … ON CONFLICT(uid) DO NOTHING`. Import never overwrites, never removes. | [0007](adr/0007-backup-export-import.md) |
| S6 | **Gap.** `FR-SRCH-01` needs partial, case-insensitive search across 10 entity types in under 1 second. `LIKE '%x%'` cannot do that at `NFR-PERF-02` volume. | SQLite **FTS5** over one denormalised `search_documents` table, written by the single write path, with a `rebuild` command and a CI drift test. | [0005](adr/0005-search-with-fts5.md) |
| S7 | **Gap.** About 200 "Must" requirements is not a shippable definition of 1.0. | 1.0 = all **Must** + all **Should** except an explicit deferral list. Every Should is triaged per release; Could items only if a release finishes early. | [`DEFERRED.md`](DEFERRED.md) |
| S8 | **Gap / trap.** A daily backup that copies the file would corrupt a WAL-mode database. | Backups use SQLite's online backup API / `VACUUM INTO` into `./backups`, retention `PDM_BACKUP_COUNT`, and 0.9.0's exit test includes a **restore drill** (`NFR-REL-03`). | [0007](adr/0007-backup-export-import.md) |
| S9 | Naming mismatch: repo `private-dash-board`, product Personal Day Manager. | Repo and container names stay as they are. UI and docs use "Personal Day Manager" / "PDM". | [0001](adr/0001-stack-and-deployment.md) |
| S10 | Gap risk. 15 open questions (`Q1`…`Q15`) can block work if answered late. | All 15 converted into dated, written decisions in [`DECISIONS.md`](DECISIONS.md). | [0001](adr/0001-stack-and-deployment.md) |
| S11 | Gap. `NFR-PERF-02` (5,000 tasks / 100,000 entries) is asserted but nothing measures it. | A `seed:perf` fixture generator and `docs/PERF.md` baselines, measured per release. | [`PERF.md`](PERF.md) |
| S12 | Gap. No accessibility or design-system decision, so 12 releases will drift visually. | Tailwind design tokens + a small internal component set + the `UI-12` rule (never colour alone) checked at every release. | [0001](adr/0001-stack-and-deployment.md) |

### 1.5 Sequencing principles (binding rules)

1. **No release starts before the previous exit test passes.** Not "except the quick
   one". This is the single rule that makes 1.0 reachable.
2. **The schema is written once, early.** All 15 entities land in 0.2.0 so no later
   release needs a breaking migration. Migrations stay versioned and additive.
3. **One write path.** Every business-rule mutation goes through a service function.
   Route handlers never write SQL. This is what makes `FR-STAT-01` (no ending a task by
   any route), `FR-GATE-08` (gate enforced in the backend) and `MCP-14` (token-scoped
   permissions) *provable* instead of hopeful.
4. **Nothing is ever deleted** (`BR-13`) — not in the UI, not in the API, not in the
   database. Removal sets `archived_at`.
5. **No new runtime dependency without an ADR.** Target: about 10 runtime dependencies
   for the whole product.
6. **Every release ships behind the same command.** The owner never runs a dev server.
7. **Spec before code.** Each release gets a written spec in
   [`RELEASES/`](RELEASES/) with scope, in/out, requirements, acceptance criteria, exit
   test and open questions *before* implementation starts.
8. **Scope freezes at release start.** Anything new discovered mid-release goes to
   [`../BACKLOG.md`](../BACKLOG.md) with a target release. It does not enter the current
   release.
9. **The owner is the release manager.** The owner runs the exit test. Implementation
   self-verifies; the owner's exit test is the gate for the next release.

---

## 2. Technical strategy

Full rationale per decision in the ADRs. This is the summary.

| Layer | Decision | Why, and not the alternative |
| --- | --- | --- |
| Runtime | Node.js 22+, TypeScript, one container `pdm` | One language across the stack, small image, matches SRS §3.1 (answers `Q5`) |
| API | **Fastify** + TypeScript | Schema-based validation (→ `NFR-SEC-02`), `app.inject()` for network-free tests, small and fast |
| Database | **SQLite** through `better-sqlite3`; `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL` | Synchronous driver makes transactions *trivially* correct (`DATA-08`); one file, trivial backup (`DEP-03`, `DEP-07`) |
| Data access | **Knex** query builder + `NNNN_name.js` migrations run by Knex over its `knex_migrations` ledger | One tool for the whole data layer; the JS files embed the reviewed SQL so migrations stay auditable (`NFR-MAINT-02`); pre-migration backup, restore-and-abort and contiguity stay in the wrapper ([ADR 0012](adr/0012-migration-runner-knex.md)) |
| Aggregates | **SQL views**: `v_task_totals`, `v_todo_totals`, `v_tag_totals`, `v_day_totals`, `v_project_totals` | `DATA-04`: totals are never stored, so they cannot drift, and the app code does not compute them |
| Running timer | The `time_entries` row with `ended_at IS NULL` **is** the state; elapsed = `now − started_at` | Survives refresh, browser close, container restart (`FR-TIME-06`, `FR-TIME-10`) with no extra state. Enforced by a partial unique index (`DATA-02`) |
| Time | Epoch-millisecond `INTEGER`, stored UTC; day boundaries computed in `TZ` via a small in-house `Intl` helper | DST-safe durations (`NFR-TIME-01`, `DATA-07`) with no date library dependency |
| Scheduler | In-process loop, 1-second tick, plus `reminder_deliveries` with unique key `(reminder_id, occurrence_at)` | Double-fire protection (`FR-REM-10`) becomes a DB constraint instead of app logic; a startup sweep marks missed (`FR-REM-09`) |
| Alerts | SSE stream + Notifications API + in-app popup + sound (WebAudio-generated, no asset files) | Offline-friendly, loopback-only, no external asset (`C4`, `NFR-PRIV-01`) |
| Frontend | **Vite + React 19 + React Router + TanStack Query + Tailwind v4**, hand-rolled accessible components, light/dark from the OS | Static build served by the same container → no CORS, no second container; no heavy component library |
| Monorepo | pnpm workspaces: `apps/api`, `apps/web`, `apps/mcp`, `packages/shared` (types + zod schemas shared by API and MCP) | One install, one test run, one version stamp, and strict dependency isolation that surfaces a missing `package.json` entry as an error |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP + stdio; token → principal → capability map with **default deny** | `MCP-14` is enforced in the app, so the safety limit survives even a modified MCP server (`US-25`) |
| Tests | Vitest (services, API, shared) against a temp-file SQLite, `app.inject()`; ≥80% on business-rule modules; Playwright smoke before 1.0 | `NFR-MAINT-01` |
| CI | GitHub Actions: lint, typecheck, test, build, `docker compose config`, image build | Releases are reproducible (`DEP-01`) |
| Version stamp | One `version` in the root `package.json`, injected into `/health` and both image tags | `DEP-06`, `MCP-08` |

Target runtime dependencies: `fastify`, `@fastify/static`, `@fastify/cors`, `better-sqlite3`,
`knex`, `zod`, `react`, `react-dom`, `react-router`, `@tanstack/react-query`,
`@modelcontextprotocol/sdk`. Anything else needs an ADR.

---

## 3. The release ladder

Twelve releases, mapping 1:1 onto the SRS phases so traceability is trivial.
Sizes are relative, not dates; dates are set at release start (§13.1 of the SRS).

| Release | Name | SRS phase | Size |
| --- | --- | --- | --- |
| [0.1.0](RELEASES/v0.1.0.md) | Foundation & runtime | §3 | M |
| [0.2.0](#v020--data-model--core-crud) | Data model & core CRUD | §9 | L |
| [0.3.0](#v030--time-tracking) | Time tracking | §4 | L |
| [0.4.0](#v040--today-day-log--where-the-time-went) | Today, Day log, where the time went | §8.3, §8.4 | M |
| [0.5.0](#v050--quality-gate) | Quality gate | §6 | L |
| [0.6.0](#v060--calendar--events) | Calendar & events | §7.1 | L |
| [0.7.0](#v070--reminders--notifications) | Reminders & notifications | §7.2, §7.3 | L |
| [0.8.0](#v080--knowledge--search) | Knowledge & search | §8.1, §8.2 | M |
| [0.9.0](#v090--reports-exportimport--operations) | Reports, export/import, operations | §8.4, §3 | M |
| [0.10.0](#v0100--mcp-server-read-only) | MCP server: read-only | §14 (read) | M |
| [0.11.0](#v0110--mcp-server-create-audit--safety) | MCP server: create, audit, safety | §14 (write) | M |
| [1.0.0](#v100--general-availability) | General availability | all | M |

### v0.1.0 — Foundation & runtime

**Goal.** The app runs in Docker on the laptop, survives restarts and rebuilds, reports
health, and can migrate its own schema.

**In scope.** Multi-stage Dockerfile; `docker-compose.yml` and `.env.example`;
`./data` and `./backups` volumes; `restart: unless-stopped`; non-root user
(`DEP-10`, `NFR-SEC-04`); `GET /health` reporting app, database, version and uptime
(`DEP-06`); migration runner that takes a backup before each migration and aborts boot on
failure (`DEP-09`, `NFR-MAINT-02`); `settings` table with defaults; React app shell —
layout, navigation, routing, light/dark theme, error boundary, 404; ESLint, Prettier,
`tsconfig`, Vitest harness; CI pipeline.

**Out of scope.** All data models, all features, MCP.

**Requirements.** `DEP-01` `DEP-02` `DEP-04` `DEP-05` `DEP-06` `DEP-09` `DEP-10` `DEP-11`,
`NFR-MAINT-02` `NFR-MAINT-03` `NFR-PORT-01` `NFR-SEC-01` `NFR-SEC-04` `NFR-TIME-01`,
`UI-09`.

**Acceptance criteria.**

1. Given a clean clone, when `docker compose up -d` runs, then the container is healthy
   within 30 seconds and nothing was installed on the host (`DEP-01`).
2. `GET /health` returns 200 with `{status:"ok", db:"ok", version:"0.1.0"}`; with an
   unwritable database path it returns 503 with `db:"error"` (`DEP-06`).
3. A file written to `./data` still exists after `docker compose down && up`, and after a
   rebuild from a freshly built image (`DEP-03`).
4. `docker compose down` keeps data; `docker compose down -v` plus deleting `./data`
   removes it (`DEP-11`).
5. Migrations run automatically at start, in order, and are idempotent. A migration that
   fails aborts boot and the pre-migration backup is restored (`DEP-09`).
6. Setting a different `PDM_PORT` in `.env` removes the port clash (`DEP-02`, `R5`).
7. From another device on the same LAN the app is not reachable (`NFR-SEC-01`).
8. `docker compose down && docker compose up -d` returns the app to the same state
   (`DEP-04`).
9. The container process is not root (`DEP-10`).
10. Light and dark themes both render and follow the OS preference by default (`UI-09`).

**Exit test (owner, ~10 minutes).** Run the compose lifecycle above on the laptop, then
open the app, toggle the theme, and confirm `/health`.

**Risks.** R1 (Docker Desktop not started after reboot) — mitigated by
`restart: unless-stopped` plus a README note.

**Questions.** None. This release is fully specified.

---

### v0.2.0 — Data model & core CRUD

**Goal.** The whole schema exists, nothing can be deleted, and projects, tasks and tags
are usable.

**In scope.** All 15 entities of SRS §9 plus `uid`, `archived_at` and `created_by`;
migrations; no-delete triggers (`DATA-10`); one-open-entry partial unique index
(`DATA-02`); maximum-3-links enforced in database and API (`DATA-01`, `BR-04`);
`ActivityLog` written by the service layer on every change (`FR-STAT-05`);
project CRUD with archive/restore (`FR-PRJ-01`…`04`); task CRUD with links, score,
estimate, dates, status, todos, acceptance criteria and reference materials
(`FR-TASK-01`…`09`, `FR-TODO-01/02`, `FR-AC-01/02`, `FR-REF-01/02`, `FR-TAG-01/02/05`);
task list with sort and filter (`FR-VIEW-01`, `FR-VIEW-03`); "Show archived" and Restore
everywhere with no Delete button (`UI-04`, `UI-17`, `DATA-11`); form validation with
preserved input (`UI-08`); API capability classification in place for MCP.

**Out of scope.** Timer, Day log, closure gate, calendar, search, reports.

**Requirements.** `DATA-01`…`DATA-13`, `FR-PRJ-01`…`04`, `FR-TASK-01`…`09`,
`FR-TODO-01/02`, `FR-AC-01/02`, `FR-REF-01/02`, `FR-TAG-01/02/05`, `FR-STAT-04/05`,
`FR-VIEW-01/03`, `BR-04`, `BR-05`, `BR-13`, `BR-16`, `UI-04`, `UI-08`, `UI-17`.

**Acceptance criteria.**

1. Adding a 4th link to a task returns 422 with a clear message, and a direct SQL insert
   of a 4th link is rejected by a database trigger (`DATA-01`, `US-06`).
2. Every user-data table but one refuses `DELETE` at the database level, proven by
   a test that enumerates all of them (`DATA-10`).
3. Archiving a project hides it and its tasks from pickers and default lists, keeps all
   data, and restoring brings everything back (`FR-PRJ-04`, `BR-16`, `US-07`).
4. Archiving a tag hides it from pickers but leaves existing entries and per-tag totals
   unchanged (`FR-TAG-05`).
5. Archiving a todo keeps its time entries linked to it, and does not archive the entry
   with it — asserted in `schema.test.ts`, and verified again through the API in 0.3.0
   (`DATA-05`, `FR-PHASE-05`).
6. Editing an Ended task is allowed and the change is recorded in history
   (`FR-TASK-12`, `FR-STAT-05`).
7. No API route accepts a delete of user data; a test scans the route table
   (`DATA-09`).
8. A task may belong to no project and shows in a virtual "No project" bucket
   (`FR-PRJ-02`).
9. Validation errors name the field and the typed value is preserved (`UI-08`).
10. Archived items appear in search-independent lists only when "Show archived" is on
    (`DATA-11`).

**Exit test (owner, ~10 minutes).** Create a project, three tasks with links, tags, todos
and acceptance criteria; try a 4th link; archive and restore a project and a tag; confirm
the history log.

**Risks.** Schema churn is cheapest now, which is exactly why the full model lands here.

**Questions.** Real "No project" row or nullable `project_id`? **Decided:** nullable
`project_id` with a virtual bucket in the UI — one less row to keep consistent.

---

### v0.3.0 — Time tracking

**Goal.** One click to start, one click to stop, totals always right, timer survives
everything.

**In scope.** Timer start/stop from the task page, task list, top bar and `Ctrl+Space`
(`FR-TIME-01`…`05`, `UI-07`); running timer persisted server-side (`FR-TIME-06`);
Open → In progress on start (`FR-TIME-07`, `BR-08`); todo and tag pickers at start and
while running (`FR-TIME-02`); one-timer rule with a confirmation naming the running task
and an "always switch" setting (`FR-TIME-04`, `BR-01`); always-visible top bar with live
`HH:MM:SS` and the running task in the tab title (`FR-TIME-05`, `UI-13`); entry list and
totals per task, todo and tag (`FR-TIME-11`…`13`, `FR-TAG-03/04`); manual entries
(`FR-TIME-14`); edit and archive entries with immediate recalculation (`FR-TIME-15`);
`end < start` rejected, overlap warned but allowed (`FR-TIME-16`); duration display
`HH:MM` plus optional decimal hours (`FR-TIME-18`); estimate versus actual on the task
(`FR-TASK-11`); forgot-timer prompt after a configurable limit, default 4 hours
(`FR-TIME-09`, `UI-05`); crash-recovery prompt with "stop now" or "stop at an earlier
time" (`FR-TIME-10`); phase timeline with bars, first/last worked and per-todo totals
(`FR-PHASE-01`…`04`); "No phase" bucket (`FR-PHASE-02`); the amount excluded by archived
entries is shown (`DATA-12`).

**Out of scope.** Pause/resume (`FR-TIME-08`, Should — 0.3.1 if the release finishes
early), calendar, closure gate.

**Requirements.** `FR-TIME-01`…`07`, `FR-TIME-09`…`16`, `FR-TIME-18`, `FR-TAG-02/03/04`,
`FR-PHASE-01`…`05`, `FR-TASK-10/11`, `BR-01`, `BR-06`, `BR-07`, `BR-08`, `DATA-02`,
`DATA-04`, `DATA-07`, `DATA-12`, `NFR-TIME-01`, `UI-05`, `UI-07`, `UI-13`.

**Acceptance criteria.**

1. Start on a task → the top bar shows it within 200 ms; Stop → an entry with correct
   start, end and duration; the task total increases by exactly that duration
   (`US-01`, `FR-TIME-03`).
2. Refresh the page, close the browser, and `docker compose restart` mid-entry → the
   timer is still running with its true elapsed time and nothing is lost
   (`US-03`, `FR-TIME-06`, `NFR-REL-02`).
3. Starting a second timer asks for confirmation naming the running task; confirming
   stops and saves the first entry, then starts the second (`FR-TIME-04`).
4. An entry with `end < start` is rejected with a message and the typed values are kept
   (`FR-TIME-16`, `UI-08`).
5. An overlapping entry shows a warning and can still be saved (`FR-TIME-16`).
6. Totals change immediately after an edit or archive; archived entries are excluded and
   the excluded amount is displayed (`FR-TIME-15`, `DATA-12`).
7. A timer past the long-timer limit prompts "Still working?" with Keep running, Stop now
   and Stop at a chosen time (`FR-TIME-09`, `UI-05`).
8. After a crash or restart the app offers Stop now or Stop at an earlier time, and the
   entry is stored with that earlier time (`FR-TIME-10`).
9. The running entry's todo and tags can be changed while it runs (`FR-TIME-02`); its
   start and end times cannot (S4).
10. Archiving a task with a running timer stops and saves the entry first (S4).
11. Elapsed time is derived from `started_at`, so a laptop sleep or a clock change cannot
    corrupt it (`NFR-TIME-01`).
12. Time tracked without a todo appears under "No phase" and is not lost
    (`FR-PHASE-02`).

**Exit test (owner, ~15 minutes).** Track time on 3 tasks with 2 todos and 3 tags for ten
minutes, `docker compose restart` mid-entry, then check every total against the wall clock.

**Risks.** Client/server clock skew — the browser ticks locally for smoothness and
re-syncs from the server every 60 seconds and on window focus; the server is always
authoritative.

---

### v0.4.0 — Today, Day log & where the time went

**Goal.** Answer "what did I work on today, and on Tuesday?" and produce the office
timesheet text.

**In scope.** Today page: quick start, running timer, events-ready agenda shell, tasks
due, entries so far, total for today (`FR-CAL-07` partial — events arrive in 0.6.0);
Day log for any date with grouping by task, project, todo or tag, per-day and grand
totals, in-place entry editing, manual entry for that date, previous/next day, week strip
with daily totals (`FR-DAY-01`…`06`); copy-for-timesheet text (`FR-DAY-03`, `Q8`); tasks
whose status changed that day (`FR-DAY-05`); first report: time grouped by project, task,
tag or phase with date, project and tag filters, table plus chart (`FR-RPT-01/02`);
midnight-split day totals (`FR-TIME-17`, S3).

**Out of scope.** Full report page, CSV export, lagging report.

**Requirements.** `FR-CAL-07`, `FR-DAY-01`…`06`, `FR-TIME-17`, `FR-RPT-01/02`,
`FR-TASK-10`, `NFR-PERF-01`, `NFR-USE-01`.

**Acceptance criteria.**

1. Pick any past date → the tasks worked, their entries, their totals and the day's grand
   total (`US-17`, `FR-DAY-01`).
2. The copy action produces `Task — HH:MM — description`, one per line, plus a day total
   line, ready to paste into a timesheet (`FR-DAY-03`).
3. An entry from 23:30 to 00:30 appears on both days with 30 minutes each, while the task
   total is 60 minutes (`FR-TIME-17`, S3).
4. Grouping by project, todo or tag works and the tag totals for the day are shown
   (`FR-DAY-02`).
5. An entry can be edited in place and a manual entry added for that date from the day
   view (`FR-DAY-04`).
6. From a cold start on the Today page, a timer can be started within two clicks
   (`NFR-USE-01`).
7. The week strip shows a daily total for each of the seven days (`FR-DAY-06`).

**Exit test.** The SRS Phase 1 exit test: stop and recreate the container with a timer
running, data and timer survive, and the Day log copy text works.

**Notes.** Completes **SRS Phase 1**.

---

### v0.5.0 — Quality gate

**Goal.** The differentiator: a task cannot be ended without an acceptance-criteria
review, and an unmet criterion needs a written reason.

**In scope.** Todo list with reorder, done flag, completed date and estimate
(`FR-TODO-01`…`05`); a clearly separate acceptance-criteria checklist with reorder and
archive (`FR-AC-01`…`04`); **closure gate popup** — modal titled with the task name,
every criterion unchecked, task summary shown, Confirm and Cancel, mandatory "Why is
this task lagging?" with a configurable minimum length, default 10 characters, when any
criterion is unticked, Confirm disabled until valid, keyboard friendly
(`FR-GATE-01`…`07`, `FR-GATE-10`, `UI-01`); backend-enforced gate on the single close
endpoint, inside one transaction (`FR-GATE-08`, `BR-02`, `BR-03`, `DATA-03`, `DATA-08`);
closure records and criterion snapshots, reopen produces a new record
(`FR-GATE-07/09`, `BR-10`); status lifecycle rules with no route able to bypass
(`FR-STAT-01`…`03`); ending a task stops its running timer first (`FR-STAT-02`); no timer
on Ended tasks, manual entries allowed with a warning (`FR-STAT-03`, `BR-09`); lagging
report and closure result shown on the task and in lists (`FR-LAG-01/02`); score and
estimate versus actual on task and project (`FR-TASK-06/11`, `FR-PHASE-04`); a task with
no criteria cannot be ended (`FR-AC-05`, `FR-GATE-02`).

**Out of scope.** Acceptance-criteria templates (`FR-AC-06`, Could), board drag-to-Ended
(`FR-VIEW-02`, Should), sub-todos (`FR-TODO-07`, Could).

**Requirements.** `FR-TODO-01`…`06`, `FR-AC-01`…`05`, `FR-GATE-01`…`10`, `FR-STAT-01`…`05`,
`FR-LAG-01/02`, `FR-TASK-06/11/12`, `FR-PHASE-04`, `BR-02`, `BR-03`, `BR-08`, `BR-09`,
`BR-10`, `DATA-03`, `DATA-08`, `UI-01`, `UI-12`.

**Acceptance criteria.**

1. End task → the popup lists every acceptance criterion, all unchecked, and the task
   stays In progress until Confirm (`US-10`).
2. A task with no criteria → the popup explains and offers Add criteria; the task stays
   open (`US-13`, `FR-AC-05`, `FR-GATE-02`).
3. All criteria ticked → the task is Ended and stored as Fulfilled with a closure record
   snapshotting total time and estimate (`US-11`, `FR-GATE-04/07`).
4. One criterion unticked → the lagging-reason box appears; Confirm is disabled at 9
   characters and enabled at 10; the result is Not fulfilled with the unmet criteria and
   the reason (`US-12`, `FR-GATE-05`, `BR-03`).
5. A direct API call that tries to set status `ended` is **refused**; only the close
   endpoint with a valid payload works (`FR-GATE-08`, `FR-STAT-01`).
6. Bulk actions, import and drag-and-drop all route through the same service function and
   cannot skip the gate (`FR-STAT-01`).
7. Cancel at any step leaves the task In progress and keeps the already-saved timer entry
   (SRS §6.3 step 6).
8. Reopen and end again → two closure records, both visible, the earlier one unchanged
   (`FR-GATE-09`, `BR-10`).
9. Editing or archiving a criterion after a closure is recorded in history so the closure
   record stays truthful (`FR-AC-04`).
10. Ticking every todo does not end the task by itself; the app may suggest "All todos
    done, end task?" (`FR-TODO-06`).
11. A manual entry on an Ended task is allowed and shows a warning (`BR-09`).
12. Space ticks a criterion, Enter confirms when valid, Esc cancels (`FR-GATE-10`).
13. The lagging report lists every Not-fulfilled task with its reason, filterable by
    project and date (`FR-LAG-01`).
14. Status is always shown as a colour **and** a text label (`UI-12`).

**Exit test.** The SRS Phase 2 exit test: a task cannot be ended by any route without the
gate, in the interface and in the API, and the lagging reason is enforced.

**Risks.** `R7` — the gate will feel slow on a small task. Mitigation shipped in this
release: keyboard-first popup, all criteria visible at once, no extra clicks before the
popup.

---

### v0.6.0 — Calendar & events

**Goal.** Plan the day.

**In scope.** Month, week and day views with Today, previous/next and a date picker
(`FR-CAL-01`); event create, edit and archive with title, date, start, end or all-day,
description, location or link, colour and optional linked task or project
(`FR-CAL-02`); quick create by clicking or dragging an empty slot (`FR-CAL-08`); overlap
warning that still allows saving (`FR-CAL-10`); week starts Monday, changeable to Sunday
(`FR-CAL-11`); task due dates and planned start dates on the calendar (`FR-CAL-06`);
time entries as read-only, hideable blocks (`FR-CAL-05`); Today agenda fully wired to
events and due reminders (`FR-CAL-07` complete); per-event reminder data model
(`FR-CAL-04` schema — firing lands in 0.7.0).

**Out of scope.** Repeat rules (`FR-CAL-03`, Should — candidate for 0.6.1), drag to move
and resize (`FR-CAL-09`, Could).

**Requirements.** `FR-CAL-01/02/04/05/06/07/08/10/11`.

**Acceptance criteria.**

1. Create an event for tomorrow 10:00 → it shows in month, week and day views and on the
   Today page (`US-19`, `FR-CAL-01/02/07`).
2. Clicking an empty slot in week or day view opens quick-create prefilled with that time
   (`FR-CAL-08`).
3. An overlapping event warns but can still be saved (`FR-CAL-10`).
4. Time entries appear as read-only blocks, can be clicked to open the entry, and can be
   hidden (`FR-CAL-05`).
5. Task due dates and planned start dates appear on the calendar and are visually
   distinct from events (`FR-CAL-06`).
6. Changing the week start to Sunday re-renders every view correctly (`FR-CAL-11`).
7. Archiving an event keeps it in the archive and restores cleanly (`FR-CAL-02`).

**Risks.** Calendar drag and drop is the most bug-prone UI in the app. It is built once,
with mouse-only paths tested, and is Could priority so it can slip without blocking 1.0.

---

### v0.7.0 — Reminders & notifications

**Goal.** The hourly "what am I doing?" pulse, plus "remind me at".

**In scope.** Reminder create, edit, disable, archive with title, note, `remind_at`, linked
task or event, and repeat rules including every N hours or days (`FR-REM-01/02/04`);
Upcoming, Done and Missed tabs (`FR-REM-04`); on due, an in-app popup plus a browser
notification with sound and the actions Done, Snooze (5, 10, 30 minutes or custom) and
Open task (`FR-REM-03`, `UI-02`); **hourly reminder** with configurable hour, minute,
working hours and days — default 09:00–18:00, Monday to Friday — on/off, sound, and
pause-for-today (`FR-REM-05/08`, `BR-12`, `Q3`, `Q4`); the hourly popup shows the running
task, todo and elapsed time, or "No timer running" with a Start button and recent tasks
(`FR-REM-06`, `UI-03`); quick note "What did you do this hour?" appended to the running
entry (`FR-REM-07`); reminders that fired while the browser was closed or the laptop
asleep appear as Missed with the original time (`FR-REM-09`); **no occurrence fires
twice**, including across a restart or with two tabs open (`FR-REM-10`); Settings shows
the notification permission state with a Test notification button, and falls back to an
in-app banner with instructions when notifications are blocked (`FR-REM-13/14`, §7.3);
reminders for tasks at a time and before the due date (`FR-REM-11`, Should).

**Out of scope.** End-of-day review prompt (`FR-REM-12`, Could).

**Requirements.** `FR-REM-01`…`11`, `FR-REM-13`, `FR-REM-14`, `FR-CAL-04` (firing),
`BR-12`, `NFR-PERF-04`, `NFR-REL-02`, `UI-02`, `UI-03`, `R2`, `R3`.

**Acceptance criteria.**

1. A reminder set for 15:30 shows a popup and a notification with sound within 30 seconds
   of due time, with Done and Snooze (`NFR-PERF-04`, `US-20`, `FR-REM-03`).
2. The hourly reminder at the top of the hour inside working hours shows the running task
   and its elapsed time; with no timer running it shows the warning and a Start button
   plus recent tasks (`US-21`, `FR-REM-05/06`).
3. Outside working hours, at the weekend, or while paused for today, no hourly popup
   fires (`BR-12`, `FR-REM-08`).
4. With the browser closed at reminder time, the reminder appears in **Missed** with its
   original time on next open (`FR-REM-09`).
5. Two tabs open plus a container restart → each occurrence is delivered exactly once,
   proven by a test on `reminder_deliveries` (`FR-REM-10`).
6. Notifications blocked → in-app banner and sound, plus instructions on how to enable
   notifications (`FR-REM-14`).
7. Snooze 10 → the reminder fires again in 10 minutes, once (`FR-REM-03`).
8. The quick note is saved to the running entry, or to a new manual entry when nothing is
   running (`FR-REM-07`).
9. Reminders can be edited, disabled, archived and restored; the tabs show the right
   items (`FR-REM-04`).
10. The Test notification button reports the current permission state
    (`FR-REM-13`).

**Exit test.** The SRS Phase 3 exit test: a reminder fires within 30 seconds, and missed
ones show after reopening.

**Risks.** `R2` — browser closed or laptop asleep at reminder time. Mitigated by the
Missed tab, on-open catch-up, and a README instruction to install the app as its own
window and keep it open.

---

### v0.8.0 — Knowledge & search

**Goal.** The second brain: find anything in under a second.

**In scope.** Reference material create, edit and archive per task, with title, body
(basic formatting and code blocks), optional URL and type — note, link, snippet, lesson
learned, decision — surviving task end and archive (`FR-REF-01`…`03`, `FR-REF-05`); a
library of all reference materials filterable by project, type and keyword
(`FR-REF-04`); **FTS5 global search** on `Ctrl+K` across task name, description, links,
todos, acceptance criteria, lagging reasons, reference materials, entry notes, projects,
tags and events, case-insensitive with partial-word matching, matched text highlighted,
each result showing project, status and total time (`FR-SRCH-01`, `FR-SRCH-04`,
`FR-SRCH-05`); filters for project, status, tag and closure result plus a timeline with
Today, Yesterday, This week, This month and Custom presets (`FR-SRCH-02`); a choice of
what the date range targets — created, started, ended, due, or when time was worked
(`FR-SRCH-03`); archived items only when "Show archived" is on (`DATA-11`); sort by
relevance, date or time spent (`FR-SRCH-06`, Should).

**Out of scope.** Saved searches (`FR-SRCH-07`, Could), semantic search (`MCP-25`,
Could), file attachments (`FR-REF-06`, Could).

**Requirements.** `FR-REF-01`…`05`, `FR-SRCH-01`…`06`, `DATA-11`, `NFR-PERF-02`.

**Acceptance criteria.**

1. `Ctrl+K` → search a word that appears only in a lagging reason and in a reference
   note → both are returned with the term highlighted (`FR-SRCH-01/04`).
2. Partial-word search for `ref` finds `reference` (`FR-SRCH-05`).
3. Search plus project plus a date range combine and narrow the results (`US-16`,
   `FR-SRCH-02`).
4. The date range can be aimed at created, started, ended, due or time-worked
   (`FR-SRCH-03`).
5. On the performance fixture of 5,000 tasks and 100,000 entries, the first page of
   results returns in under 1 second (`FR-SRCH-05`), measured and recorded in
   [`PERF.md`](PERF.md).
6. An archived task is hidden from search until "Show archived" is on, and its reference
   materials remain findable (`DATA-11`, `FR-REF-05`).
7. Reference items show their task and project in results (`FR-REF-03`).
8. Rebuilding the search index from the source tables produces the same result set; a CI
   test asserts no drift (S6).

**Risks.** Full-text index drift is the classic failure mode of this design. Mitigation:
the single write path, a `search:rebuild` command, and the drift test.

---

### v0.9.0 — Reports, export/import & operations

**Goal.** Prove the data is safe, and make reporting real.

**In scope.** Full reports: total time for a period grouped by project, task, tag or
phase, as table and chart (`FR-RPT-01`); combined filters of date range, project, tag and
task status (`FR-RPT-02`); estimate versus actual per task, project and period plus total
score for ended tasks (`FR-RPT-03`); CSV export and a print stylesheet (`FR-RPT-04`);
weekly summary of hours per day, top projects, top tags, tasks ended and tasks lagging
(`FR-RPT-05`); fulfilled versus not-fulfilled ratio per week, month and project
(`FR-LAG-03`, Could); **export all data as JSON plus CSV for time entries and import a
previous export, merge only** (`DEP-08`, `DATA-13`); online backup to `./backups` with
retention and a manual Backup now button (`DEP-07`); **restore drill** performed and
recorded (`NFR-REL-03`); Settings complete: hourly reminder hours and days, notification
test, score scale, week start, backup count, long-timer limit, time zone, theme; lagging
report filters (`FR-LAG-01` complete); performance pass on the fixture set
(`NFR-PERF-01`…`03`); README covering install, start, stop, backup, restore, upgrade and
removal (`NFR-MAINT-03`, `DEP-11`).

**Out of scope.** Dashboard home widgets (`FR-RPT-06`, Could).

**Requirements.** `FR-RPT-01`…`05`, `FR-LAG-01/03`, `DEP-07`, `DEP-08`, `DEP-11`,
`NFR-PERF-01/02/03`, `NFR-REL-01/03`, `NFR-DATA-01`, `NFR-MAINT-03`, `DATA-13`.

**Acceptance criteria.**

1. Export → import into an empty database → every project, task, entry, reference and
   closure record returns with identical `uid`s and **no duplicates** (`DEP-08`,
   `DATA-13`).
2. Import into a database that already holds the same records adds nothing and overwrites
   nothing (`DATA-13`).
3. A daily backup file exists; the 15th backup rotates out the oldest; `./backups` holds
   14 by default (`DEP-07`, `Q14`).
4. **Restore drill:** a backup file replaces `./data/pdm.db`, the app restarts and totals
   match the pre-backup state. Performed and recorded in the release notes
   (`NFR-REL-03`).
5. With 5,000 tasks and 100,000 entries: task list, task page, Day log and reports each
   respond in under 2 seconds; start and stop in under 300 ms (`NFR-PERF-01/02`).
6. Idle memory stays under 300 MB (`NFR-PERF-03`).
7. A report exports to CSV that opens correctly in a spreadsheet, and the print view is
   legible (`FR-RPT-04`).
8. The weekly summary shows hours per day, top projects, top tags, tasks ended and tasks
   lagging (`FR-RPT-05`).
9. The README documents install, start, stop, backup, restore, upgrade and removal
   (`NFR-MAINT-03`).
10. Data is readable outside the app: the SQLite file, the JSON export and the CSV export
    are all open formats (`NFR-DATA-01`).

**Notes.** Completes **SRS Phase 4**.

---

### v0.10.0 — MCP server: read-only

**Goal.** The assistant can read the whole app, and it can be proven that it cannot
change anything.

**In scope.** The `pdm-mcp` container started by the same `docker compose up -d`
(`MCP-01`); Streamable HTTP on loopback, default port 8765 from `.env`, plus a stdio mode
for clients that launch the server themselves (`MCP-02`, `MCP-05`); an access token
generated at first start, stored hashed on the data volume, shown once, regenerable with
old tokens invalidated (`MCP-04`); the app API classifying every route by capability and
applying **default deny** to the MCP principal (`MCP-14`); read tools `get_running_timer`,
`list_time_entries`, `get_day_log`, `get_task`, `list_tasks`, `list_projects`,
`get_project_summary`, `list_tags`, `list_events`, `get_agenda`, `list_reminders`,
`list_references`, `search`, `get_time_report`, `get_lagging_tasks`,
`get_weekly_summary`, `get_estimate_history` (`MCP-09`); resources `pdm://today`,
`pdm://day/{date}`, `pdm://task/{id}`, `pdm://project/{id}`, `pdm://references`
(`MCP-10`, §14.5); tasks addressed by id or by name, with ambiguity returning the
candidates instead of guessing (`MCP-10`); compact structured results with limits and
paging, plus a plain-language summary line (`MCP-11/12`); refusal tests for every mutating
route (`US-25`); health and version reporting with actionable error messages
(`MCP-08`); README section with copy-ready client configuration (`MCP-07`).

**Out of scope.** All create tools (0.11.0), prompts (0.11.0), audit page (0.11.0).

**Requirements.** `MCP-01`…`12`, `MCP-14`, `MCP-15`, `MCP-16`, `MCP-21`, `US-23`, `US-24`.

**Acceptance criteria.**

1. From a real MCP client, `get_day_log` for a date with entries returns tasks, entries,
   totals and timesheet-ready text (`US-24`, `MCP-11`).
2. **No tool exists to start or stop a timer, or to add, edit or archive an entry**, and
   asking the assistant for one returns a clear explanation (`US-23`, `MCP-15/16`).
3. A direct API call carrying the MCP token attempting `PATCH /api/tasks/:id` is refused
   with 403, and `POST /api/timer/stop` is refused — automated test (`US-25`, `MCP-14`).
4. `get_task("Refactor billing")` with two matching tasks returns both candidates and
   does not guess (`MCP-10`).
5. A request without a token, or with a revoked token, is refused (`MCP-04`).
6. A query that would return thousands of entries returns a bounded page with a
   continuation hint (`MCP-11`).
7. Every tool returns a plain-language summary line alongside the structured data
   (`MCP-12`).
8. The MCP server makes no outgoing network call other than to the app (`MCP-21`).
9. The README contains a copy-ready configuration block for a common client
   (`MCP-07`).

**Exit test.** Connect a real MCP client and ask "what did I do on Tuesday" and "find past
work about X".

**Risks.** Token setup friction — mitigated by a copy-ready configuration JSON in
Settings, and a regenerate button.

---

### v0.11.0 — MCP server: create, audit & safety

**Goal.** The assistant plans and takes notes; it still cannot touch state that matters.

**In scope.** Create tools: `create_task` — name, description, up to 3 links, project,
score, estimate, due date, **todos and acceptance criteria in one call**, atomic with
rollback, starting Open — plus `create_project`, `create_tag`, `create_event`,
`create_reminder` and `add_reference` (`MCP-09`, `MCP-13`); duplicate detection returning
the existing item instead of creating a second one (`MCP-27`, `US-27`); access modes Read
only, Read and create (default) and Off, plus per-tool switches (`MCP-17`, `US-28`);
`created_by` with tool name and timestamp on every MCP-created item, a badge in lists and
the item, and an **Audit page** (`MCP-18`, `UI-15/16`, `US-29`); assistant text validated
and escaped like any user input, with tool descriptions stating that retrieved content is
data and never instructions (`MCP-20`); rate limiting at 60 calls per minute and refusal
of oversized input (`MCP-19`); prompts `find_similar_work`, `timesheet_summary`,
`plan_my_day`, `end_of_day_review`, `weekly_review`, `capture_lesson`,
`task_retrospective` (§14.5); the `pdm://lagging` resource; second-brain requirements
`MCP-22`, `MCP-23`, `MCP-24`.

**Out of scope.** Semantic search (`MCP-25`, Could), marking a reference as important
(`MCP-26`, Could).

**Requirements.** `MCP-09`, `MCP-13`, `MCP-15`, `MCP-17`…`20`, `MCP-22`…`24`, `MCP-27`,
`UI-15`, `UI-16`, `US-27`, `US-28`, `US-29`, `Q11`, `Q12`.

**Acceptance criteria.**

1. "Create a task *Fix login redirect* in project X with 3 todos and 2 acceptance
   criteria" produces one Open task containing everything, badged *created by assistant*;
   repeating the request does not create a duplicate (`US-27`, `MCP-13`, `MCP-27`).
2. If any part is invalid — for example 4 links — nothing is created (`MCP-13`).
3. Mode Read only → `create_task` is refused with a clear message; mode Off → every call
   is refused (`US-28`, `MCP-17`).
4. The Audit page lists every MCP-created item with tool and time, filterable; removing an
   item there means archiving it and is done by the user (`MCP-18`, `UI-15`).
5. A task description containing injected instructions is returned as data and never
   changes assistant behaviour (`MCP-20`).
6. The 61st call in a minute is refused, and a 2 MB input is refused (`MCP-19`).
7. The assistant still cannot add todos or acceptance criteria to an **existing** task;
   they can only be supplied at creation (`Q11`, `MCP-15`).
8. `find_similar_work` returns related tasks, lessons and their estimate versus actual
   (`US-26`, `MCP-24`).

**Risks.** Scope pressure — this is the most "nice to have" area for a single user, but it
is a stated goal (`G7`), so it stays in 1.0 behind the access-mode kill switch.

---

### v1.0.0 — General availability

**Goal.** Everything above is stable, verified and documented. **No new features.**

**In scope.** Full requirement audit: every Must traced to a passing test or a documented
deferral; all Should closed or explicitly deferred; performance budget verified on the
fixture set; accessibility pass — status never by colour alone (`UI-12`), focus order,
dialogs, labels; security pass — input validation and escaping, http and https links only
(`NFR-SEC-03`), non-root, loopback-only (`NFR-SEC-01`…`04`); browser matrix, latest two
of Chrome, Edge and Firefox (`NFR-COMP-01`); Playwright smoke covering the critical paths
of all 29 user stories; README plus restore drill plus `CHANGELOG.md`; `v1.0.0` tags and
image tags; first-run seed data.

**Out of scope.** Multi-user and login, cloud sync, mobile, invoicing, Jira / Google
Calendar / Clockify integration, semantic search, file attachments, Pomodoro, sub-todos —
and any Should or Could listed in [`DEFERRED.md`](DEFERRED.md).

**Acceptance criteria.**

1. **Every Must requirement in the SRS maps to a test or a documented reason.** The
   traceability table below is complete. This is the definition of 1.0.
2. All 29 user stories pass their Given/When/Then as automated tests or scripted manual
   checks.
3. A clean machine, `docker compose up -d`, then a guided ten-minute first run with no
   help from the author.
4. A full stop, backup, restore and verify cycle is performed and recorded
   (`NFR-REL-03`).
5. Upgrading 0.11.0 → 1.0.0 with data in place runs migrations and loses nothing
   (`DEP-09`).
6. No console errors on the main screens; start/stop, search and the closure gate are
   fully operable from the keyboard (`UI-07`).
7. Idle resource use stays small and pages stay under the recorded performance budget
   (`NFR-PERF-01`, `NFR-PERF-03`).

---

## 4. Requirement traceability (SRS → release)

| SRS section | Requirements | Releases |
| --- | --- | --- |
| §3 Architecture and Docker | `DEP-01`…`DEP-11` | 0.1.0, hardened 0.9.0, audited 1.0.0 |
| §4.1 Timer | `FR-TIME-01`…`10` | 0.3.0 (`FR-TIME-08` in 0.3.1) |
| §4.2 Time entries | `FR-TIME-11`…`18` | 0.3.0, `FR-TIME-17` in 0.4.0 |
| §4.3 Tags | `FR-TAG-01`…`06` | 0.2.0 (`01`, `02`, `05`), 0.3.0 (`03`, `04`) |
| §4.4 Phase tracking | `FR-PHASE-01`…`05` | 0.3.0 |
| §5.1 Projects | `FR-PRJ-01`…`06` | 0.2.0 (`FR-PRJ-06` in 0.3.0 with entries) |
| §5.2 Task fields | `FR-TASK-01`…`14` | 0.2.0, `FR-TASK-14` Could |
| §5.3 Status lifecycle | `FR-STAT-01`…`05` | 0.2.0 (`04`, `05`), 0.5.0 (`01`…`03`) |
| §5.4 Views | `FR-VIEW-01`…`03` | 0.2.0 (`01`, `03`), `FR-VIEW-02` Could |
| §6.1 Todos | `FR-TODO-01`…`07` | 0.2.0 (`01`, `02`), 0.5.0 (`03`…`06`) |
| §6.2 Acceptance criteria | `FR-AC-01`…`06` | 0.2.0 (`01`, `02`), 0.5.0 (`03`…`05`) |
| §6.3 Closure gate | `FR-GATE-01`…`10` | 0.5.0 |
| §6.4 Lagging reporting | `FR-LAG-01`…`03` | 0.5.0 (`01`, `02`), 0.9.0 (`03`) |
| §7.1 Calendar and events | `FR-CAL-01`…`11` | 0.6.0, agenda in 0.4.0, firing 0.7.0 |
| §7.2 Reminders | `FR-REM-01`…`12` | 0.7.0, `FR-REM-12` Could |
| §7.3 Notification behaviour | `FR-REM-13`, `FR-REM-14` | 0.7.0 |
| §8.1 Reference materials | `FR-REF-01`…`06` | 0.2.0 (`01`, `02`), 0.8.0 (`03`…`05`) |
| §8.2 Search | `FR-SRCH-01`…`07` | 0.8.0, `FR-SRCH-07` Could |
| §8.3 Work log for any day | `FR-DAY-01`…`06` | 0.4.0 |
| §8.4 Reports | `FR-RPT-01`…`06` | 0.4.0 (`01`, `02`), 0.9.0 (`03`…`05`) |
| §9 Data model and rules | `DATA-01`…`13` | 0.2.0 (schema, `01`…`11`), 0.8.0 (`11` in search), 0.9.0 (`12`, `13`) |
| §10 User interface | `UI-01`…`UI-17` | 0.1.0 (`09`), 0.2.0 (`04`, `08`, `17`), 0.3.0 (`05`, `07`, `13`), 0.5.0 (`01`, `12`), 0.7.0 (`02`, `03`), 0.11.0 (`15`, `16`), audited 1.0.0 (`06`, `10`, `11`) |
| §11.1 Non-functional | `NFR-*` | 0.1.0 (infra), each release for its own, 1.0.0 for the audit |
| §11.2 Business rules | `BR-01`…`16` | 0.2.0–0.11.0 per release |
| §12.1 User stories | `US-01`…`22` | 0.2.0–0.9.0 |
| §14 MCP server | `MCP-01`…`27` | 0.10.0 (read), 0.11.0 (create, safety) |
| §14.9 Acceptance tests | `US-23`…`29` | 0.10.0, 0.11.0 |

### 4.1 Story-to-release index

| Story | Release | Story | Release |
| --- | --- | --- | --- |
| `US-01` start/stop a timer | 0.3.0 | `US-16` search by keyword, project, timeline | 0.8.0 |
| `US-02` pick todo and tags on start | 0.3.0 | `US-17` today or any past day | 0.4.0 |
| `US-03` timer survives refresh/restart | 0.3.0 | `US-18` phase timeline | 0.3.0 |
| `US-04` all entries and total of a task | 0.3.0 | `US-19` calendar with events | 0.6.0 |
| `US-05` add, edit, archive entries | 0.3.0 | `US-20` remind me at a time | 0.7.0 |
| `US-06` task with 3 links | 0.2.0 | `US-21` hourly reminder | 0.7.0 |
| `US-07` group tasks into projects | 0.2.0 | `US-22` data safe in Docker | 0.1.0, 0.9.0 |
| `US-08` time per tag for a task | 0.3.0 | `US-23` keep time tracking manual | 0.10.0 |
| `US-09` todo list and AC checklist | 0.2.0, 0.5.0 | `US-24` ask what I did on any day | 0.10.0 |
| `US-10` cannot end without AC review | 0.5.0 | `US-25` assistant cannot change or close | 0.10.0 |
| `US-11` end with all criteria met | 0.5.0 | `US-26` ask about past work and lessons | 0.11.0 |
| `US-12` explain why a task lagged | 0.5.0 | `US-27` assistant creates planning items | 0.11.0 |
| `US-13` cannot close without criteria | 0.5.0 | `US-28` restrict or switch off the assistant | 0.11.0 |
| `US-14` score, estimate vs actual | 0.5.0 | `US-29` review what the assistant created | 0.11.0 |
| `US-15` reference materials | 0.2.0, 0.8.0 | | |

---

## 5. Quality strategy

### 5.1 Test pyramid

| Layer | What | Tool | Where |
| --- | --- | --- | --- |
| Service / business rules | Timer, totals, closure gate, reminders, archive rules, import merge | Vitest against a temp-file SQLite | 80% coverage target on business modules (`NFR-MAINT-01`) |
| API contracts | Every route: status codes, validation, capability denial | Vitest + `app.inject()` (no network) | 100% of routes have at least one test |
| Integration | SSE stream, migration runner, backup and restore | Vitest with a real file and a real port | From 0.7.0, 0.9.0 |
| End to end | Critical paths of all 29 stories | Playwright | 1.0.0, then per release on the previous exit test |
| Manual | Owner exit test script | Written per release | Every release, before the next starts |

### 5.2 The non-negotiable test list

These must exist and pass before 1.0.0. Each names the requirement it protects.

1. Only one timer can run; starting another saves the first (`BR-01`, `FR-TIME-04`).
2. A running timer survives page reload, browser close and container restart
   (`FR-TIME-06`, `FR-TIME-10`).
3. An entry with `end < start` is rejected (`FR-TIME-16`).
4. Overlapping entries warn but are allowed (`FR-TIME-16`).
5. Totals recalculate immediately on edit and archive; archived entries excluded and the
   excluded amount shown (`FR-TIME-15`, `DATA-12`).
6. A fourth task link is refused by the API **and** the database (`DATA-01`).
7. No user-data table accepts a hard delete, verified by enumerating all 13
   (`DATA-10`).
8. No API route exposes a delete of user data (`DATA-09`).
9. Ending a task by any route without a valid closure payload is impossible
   (`FR-STAT-01`, `FR-GATE-08`).
10. An unmet criterion without a lagging reason cannot be confirmed, at the UI and the
    API level (`FR-GATE-05`, `BR-03`).
11. Closure records are append-only across reopen cycles (`FR-GATE-09`, `BR-10`).
12. A reminder occurrence can never be delivered twice, including across restart and two
    tabs (`FR-REM-10`).
13. Reminders missed while closed are shown as Missed with the original time
    (`FR-REM-09`).
14. The hourly reminder fires only inside configured working hours and days (`BR-12`).
15. A day total splits an entry at local midnight while the task total does not
    (`FR-TIME-17`, S3).
16. The MCP token cannot mutate, close, archive or delete anything, by any route
    (`MCP-14`, `US-25`).
17. `create_task` is atomic — an invalid part creates nothing (`MCP-13`).
18. `create_task` is duplicate-safe (`MCP-27`, `US-27`).
19. Import merges and never overwrites or removes (`DATA-13`).
20. A backup taken with the online API restores to an identical state (`NFR-REL-03`).

### 5.3 Fixtures

- `seed:dev` — small, realistic demo data: 2 projects, 6 tasks, todos, criteria, references,
  tags, a week of entries, events and reminders. Used for development and demos.
- `seed:perf` — 5,000 tasks and 100,000 time entries (`NFR-PERF-02`). Used to measure and
  record baselines in [`PERF.md`](PERF.md).
- `seed:firstrun` — what a brand-new install shows on 1.0.0.

### 5.4 Definition of Done (every release)

- [ ] Every acceptance criterion in the release spec passes
- [ ] Lint, typecheck and tests green
- [ ] Coverage on business-rule modules at or above 80%
- [ ] README, `CHANGELOG.md` and `docs/PLAN.md` updated
- [ ] Migrations versioned, reversible, backed up before running
- [ ] Owner ran the exit test and it passed
- [ ] `vX.Y.Z` git tag created, image tagged `X.Y.Z`
- [ ] No open Critical or High bug
- [ ] Nothing new in scope: discoveries went to `BACKLOG.md`

### 5.5 Change control

- Scope is frozen when a release starts. New ideas go to [`../BACKLOG.md`](../BACKLOG.md)
  with a MoSCoW tag and a target release.
- A requirement may be **deferred** to a later release with a note in
  [`DEFERRED.md`](DEFERRED.md) and a reason. It is never silently dropped.
- Changing a rule that an already-shipped release depends on needs an ADR update and a
  migration note.

---

## 6. Risk register

The SRS lists `R1`…`R7`. These are the project risks identified while planning.

| ID | Risk | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| `PR-1` | Scope: roughly 200 Must requirements across 12 releases | Never reaches 1.0 | One write path, no speculative UI, published deferral list, 1.0 = Must + Should only, scope freeze per release | Owner |
| `PR-2` | The no-delete policy is over-engineered into friction | The user avoids the app | Archive everywhere, no Delete button anywhere, Undo toast (`UI-06`), one-click restore | Implementation |
| `PR-3` | SQLite write contention between the app and the scheduler loop | Delayed reminders, `SQLITE_BUSY` | Single writer, short transactions, `busy_timeout=5000`, the scheduler tick writes only when it actually fires | Implementation |
| `PR-4` | Full-text index drift | Search returns stale results | Single write path, `search:rebuild` command, CI drift test | Implementation |
| `PR-5` | Browser notification permission friction | Reminders silently never delivered | In-app popup is the primary channel, banner fallback, permission state and Test button in Settings, README instruction to install the app as its own window | Implementation |
| `PR-6` | MCP token setup friction | The MCP feature goes unused | Copy-ready configuration JSON in Settings, regenerate button, refusal messages that explain the rule | Implementation |
| `PR-7` | Self-host dependency drift (Node, Docker, base image) | The build breaks months later | Minimal dependencies, pinned base image, CI builds the real image on every change | Implementation |
| `PR-8` | Score and estimate are typed by hand and go stale | The field becomes noise | Both optional; reports only include tasks where they are set | Owner |
| `PR-9` | The single-user assumption breaks if the app is ever exposed | Data risk | The default-deny capability map makes a future auth layer a small, isolated change | Implementation |
| `PR-10` | Calendar and reminder logic is the most bug-prone area | Late defects in 0.6.0/0.7.0 | Unique-occurrence delivery key, computed occurrence expansion, deterministic day-boundary helpers with unit tests | Implementation |
| `PR-11` | The owner is the only tester, and testing stops between releases | Defects accumulate | The exit-test script is written at release start and is part of the Definition of Done | Owner |

---

## 7. Documents

| Path | Purpose |
| --- | --- |
| [`PLAN.md`](PLAN.md) | Day-to-day entry point: current release, rules, where to read next |
| [`INDEX.md`](INDEX.md) | Reading order for the whole documentation set |
| [`RELEASES/`](RELEASES/) | One spec per release: scope, in/out, requirements, acceptance criteria, exit test, questions |
| [`adr/`](adr/) | Architecture decision records, one per decision in §2 |
| [`DECISIONS.md`](DECISIONS.md) | The SRS open questions `Q1`…`Q15` turned into written decisions |
| [`DEFERRED.md`](DEFERRED.md) | Should and Could items consciously deferred from 1.0 |
| [`TESTING.md`](TESTING.md) | Test strategy, the non-negotiable list, fixtures, how to run |
| [`PERF.md`](PERF.md) | Performance budget and measured baselines per release |
| [`../README.md`](../README.md) | Project overview and status (full ops docs land in 0.1.0 and 0.9.0) |
| [`../AGENTS.md`](../AGENTS.md) | Commands and conventions for coding assistants and contributors |
| [`../VERSIONING.md`](../VERSIONING.md) | How versions are numbered, tagged and released |
| [`../BACKLOG.md`](../BACKLOG.md) | Everything found after a release started |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Keep a Changelog format, one entry per release |

---

## 8. Decisions already taken

Taken to unblock the build. All are recorded in [`DECISIONS.md`](DECISIONS.md); changing
one needs an ADR update.

1. `project_id` is nullable and "No project" is a virtual bucket, not a row.
2. `status` is a database-level enum: `open`, `in_progress`, `ended`.
3. `score` is a nullable number; the scale label is a setting (`Q2`).
4. Backend Fastify + Drizzle; frontend Vite + React + Tailwind; one container serves the
   API and the static build.
5. The in-app popup is the primary notification channel; the browser notification is the
   enhancement; the sound is generated with WebAudio so there are no asset files and no
   CDN.
6. Timestamps are epoch milliseconds in UTC; durations are whole seconds (`DATA-07`); day
   boundaries are computed in the configured `TZ`.
7. MCP HTTP is published on loopback but the README recommends stdio for daily use; only
   the app port is always published.
8. 1.0.0 = all Must plus all Should except the items in [`DEFERRED.md`](DEFERRED.md);
   Could items only if a release finishes early.
9. The product is called **Personal Day Manager (PDM)** in the UI and docs; the repository
   and container names stay as they are (S9).

---

## 9. Open questions for the owner

Answers to these change the plan. Until answered, the stated default is used.

| # | Question | Default being used | Affects |
| --- | --- | --- | --- |
| `OQ-1` | Is the MCP server in scope for 1.0.0, or should 1.0.0 stop at 0.9.0? | **In scope** — the ladder is built so MCP can be dropped without affecting 0.1.0–0.9.0 | 1.0.0 definition |
| `OQ-2` | Version numbering after 0.9.0: `0.10.0`/`0.11.0` (correct semver, easily misread) or `0.9.1`/`0.9.2`? | **`0.10.0` and `0.11.0`**, documented in `VERSIONING.md` | Tagging |
| `OQ-3` | Who tags a release: the implementation self-verifies and tags, or does the owner review a running app first? | **Implementation self-verifies, tags, and hands over a ten-minute exit-test script; the owner steps in only if an exit test fails** | Release flow |
| `OQ-4` | May 0.9.0's restore drill touch the real database in `./data`, or only a copy? | **A copy only; the real database is touched only on explicit instruction** | 0.9.0 |
| `OQ-5` | What exact text format does the office timesheet need (`Q8`)? | `Task — HH:MM — description` per line, then a day total line | 0.4.0 |
| `OQ-6` | Confirm the UI name "Personal Day Manager (PDM)" while the repository stays `private-dash-board` | **Confirmed as the default** | UI, docs |
| `OQ-7` | Should `FR-TIME-08` (pause and resume) land in 0.3.0 or as 0.3.1? | **0.3.1, only if 0.3.0 finishes early** | 0.3.0 |
| `OQ-8` | Should reminders fire while the app is closed by any means other than the Missed tab — for example a container-side notification? | **No. The Missed tab plus on-open catch-up is the accepted answer to `R2`** | 0.7.0 |
