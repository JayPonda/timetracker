# MEMORY.md

What happened in earlier sessions, and what is true of this machine right now.

**Read this at the start of a session** after `AGENTS.md`, especially the open threads at the
bottom. Then check `docs/PLAN.md` for the current release.

**How this file works:** unlike `AGENTS.md`, which is a stable set of rules, this file is a
running log. New sessions append to it. Rules that turn out to be durable get promoted into
`AGENTS.md`; product judgements get promoted into `docs/DECISIONS.md`; anything that is just
a fact about this checkout, this machine, or this project's history stays here.

| What a discovery is | Where it ends up |
| --- | --- |
| A rule about how to work here, durable, non-obvious, costly to get wrong | `AGENTS.md` |
| A technical decision with rejected alternatives | `docs/adr/` |
| A product judgement call | `docs/DECISIONS.md` |
| A fact about this machine, this checkout, or a one-off lesson | **this file** |
| A task for a later session | **this file**, in Open threads |

---

## Verified environment snapshot

Taken 2026-09-28 on the development machine. Re-verify anything load-bearing before relying
on it; a stale snapshot here is worse than none.

| Thing | Value | Why it matters |
| --- | --- | --- |
| OS | macOS (Darwin), Apple Silicon | `NFR-PORT-01` also requires Windows and Linux; only macOS has been exercised so far |
| Node.js | **v26.9.0** | Newer than the Node 22 the container pins. A native module built locally may not be ABI-compatible with the container's Node. This is fine — the container builds its own — but never run a local build inside the container or vice versa. |
| npm | 11.19.1 | Present, but the project standardises on pnpm |
| **pnpm** | **11.22.0** | The package manager this project uses. See the build-script gotcha below |
| corepack | **not installed** | Cannot rely on `corepack enable` to pin a pnpm version. If pinning is wanted, do it with a `packageManager` field in `package.json`, which pnpm reads itself |
| Docker | 29.7.2 | |
| Docker Compose | v5.4.0 | V2-style plugin, invoked as `docker compose`, not `docker-compose` |
| git | 2.55.0 | |
| C toolchain | Apple clang 21.0.0, GNU Make 3.81, Xcode CommandLineTools at `/Library/Developer/CommandLineTools` | Present, so `better-sqlite3` **can** compile from source if it has no prebuilt binary |
| Python 3 | 3.14.7 | Required by `node-gyp` for that same source build |

### Repository state as of 2026-09-28

- The repository already existed with a `.git` directory on branch `main`; `git init` was a
  no-op re-initialisation. First commit is `3927051`.
- The working directory is `/Users/jayponda/Drive/projects/private-dash-board` — the
  `Google Drive` path is worth remembering. Drive can hold a file that is not yet synced, and
  a database file on a synced folder invites Google Drive's own file locking to corrupt it.
  **The app's data directory should not live inside a synced folder in production.** For
  this laptop the project is a git checkout, so it is acceptable, but do not put the live
  `data/` directory there.
- The project folder name is `private-dash-board` while the product is Personal Day Manager.
  Renaming the repository is the owner's decision (`OQ-6`); do not rename unilaterally.
- `data/` and `backups/` are git-ignored from the first commit.

---

## Gotchas discovered

### pnpm 10+ blocks dependency install scripts by default

`pnpm config get onlyBuiltDependencies` currently returns `undefined` on this machine, which
means the default policy applies: **dependency lifecycle scripts do not run**.

`better-sqlite3` is a native module whose package runs an install script to place or compile
its binary. Without an explicit opt-in, `pnpm install` appears to succeed and the first
database query fails with a missing or invalid native binding. The fix is in the root
`package.json`:

```jsonc
{
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

**Remember this before the first `pnpm install` in 0.1.0.** It is the single most likely
first-day failure in this repository, and the error message points at the wrong thing. It is
now written up in `AGENTS.md` Part 3.

### Node 26 locally versus Node 22 in the container

The local Node is 26 and the container pins 22. Native modules compiled locally will not load
in the container, and the other way round. This is harmless in the normal flow — `pnpm dev`
runs everything locally, and `docker compose up` builds its own image from scratch — but it
becomes a confusing error if anyone mounts the host `node_modules` or `data/` into the
container. Do not do that.

### `docs/adr/0001` said npm, the rest of the project said pnpm

Found while writing `AGENTS.md` on 2026-09-28. ADR 0001 described an "npm workspaces
monorepo" while every command in `AGENTS.md`, `CONTRIBUTING.md` and `docs/TESTING.md` was
pnpm. Standardised on **pnpm workspaces**, with `onlyBuiltDependencies` in the root
`package.json`, and recorded as `D-21` in `docs/DECISIONS.md`. The lesson worth keeping:
when a document set is written across several sessions, package-manager and tool-invocation
naming drifts first, because each session writes from its own habits rather than from the
document set.

---

## The value loop, in one line

Everything in this project serves one loop, and the ordering of the twelve releases follows
it:

> start timer → work → stop → see where the time went → close the task with a quality check →
> find the lesson later

If a change makes that loop slower, it is the wrong change. If a feature does not serve that
loop, it does not go in before 1.0.0.

---

## Twelve conflicts and gaps found in the SRS

Found by analysing `requirnment.md` on 2026-09-28, before writing any code, so that the build
would not trip on them. Each has a resolution in `docs/ROADMAP.md` §1.4 and, where it is a
technical decision, an ADR. **Do not re-raise these as new questions** — they are answered.

| # | The conflict or gap | Where it is answered |
| --- | --- | --- |
| `S1` | Loopback-only binding (`DEP-02`, `NFR-SEC-01`) versus the MCP container needing to reach the app | ADR 0001 — bind `0.0.0.0` inside, publish on `127.0.0.1` |
| `S2` | `DATA-10`'s no-hard-delete rule versus a search index that must be rebuildable | ADR 0002 — triggers on 13 user-data tables, named exemptions |
| `S3` | `DATA-04` computed totals versus `FR-TIME-17` midnight splitting | ADR 0004 — task total and day total are two named sums |
| `S4` | No rule for a running timer when its task is archived, or for editing a running entry | ADR 0003 — archive stops the timer; running entries edit todo/tags/note only |
| `S5` | `DATA-13` merge-only import with no cross-instance identity | ADR 0007 — `uid` on every user-data table |
| `S6` | `FR-SRCH-05` sub-second search across 10 entity types is unreachable with `LIKE` | ADR 0005 — FTS5 over a denormalised document table |
| `S7` | Roughly 200 "Must" requirements is not a shippable definition of 1.0 | Roadmap — 1.0 is Must plus Should, minus a published deferral list |
| `S8` | `cp` for a daily backup would corrupt a WAL-mode database | ADR 0007 — online backup API, plus a restore drill in 0.9.0 |
| `S9` | Folder name versus product name | `D-20` — PDM in the UI, names unchanged |
| `S10` | 15 open questions that could block work | `docs/DECISIONS.md` — all 15 answered |
| `S11` | `NFR-PERF-02` asserted but never measured | `docs/PERF.md` plus a `seed:perf` fixture |
| `S12` | No accessibility or design-system decision, so twelve releases would drift | ADR 0001 plus the `UI-12` rule in `AGENTS.md` |

---

## Session log

### 2026-09-28 — Session 1: planning only, no code

**Done.**
Read all 828 lines of the SRS. Analysed it as a product owner rather than transcribing it,
and produced the whole plan: a twelve-release ladder from 0.1.0 to 1.0.0 with scope, in and
out, requirement IDs, acceptance criteria and an owner exit test for each; the twelve
conflicts and gaps above; seven ADRs; a traceability matrix from SRS phase to release to user
story; a 20-item non-negotiable test list; a risk register; a deferral list; and answers to
all 15 SRS open questions plus 20 planning decisions.

**Files created:** `README.md`, `AGENTS.md`, `MEMORY.md`, `CHANGELOG.md`, `BACKLOG.md`,
`CONTRIBUTING.md`, `VERSIONING.md`, `.gitignore`, `.env.example`, and under `docs/`:
`PLAN.md`, `ROADMAP.md`, `INDEX.md`, `DECISIONS.md`, `DEFERRED.md`, `TESTING.md`, `PERF.md`,
`RELEASES/README.md`, `RELEASES/v0.1.0.md`, `adr/README.md` and `adr/0001`–`0007`.

**Commits.**
- `3927051` `docs: plan PDM from 0.1.0 to 1.0.0 before writing any code`

**Verification performed.** All 151 relative Markdown links and all 5 anchor links across the
24 Markdown files resolve. Run the same check after editing documentation, since a broken
link in a plan document is a small trap for the next session.

**State at the end.** No application code exists. `docs/PLAN.md` points at 0.1.0, whose spec
is written and waiting. Nothing is blocked: the eight open questions all carry a stated
default.

### 2026-09-28 — Session 2: `AGENTS.md` rebuilt from the beginning, `MEMORY.md` created

**Done.**
Rewrote `AGENTS.md` in full as the project constitution rather than a command list: what the
project is, the value loop, the eleven ground rules, setup from zero including the pnpm
build-script trap, the command surface, the repository layout, the architecture, the
database invariants enforced by the schema itself, the request flow, the agreed data model,
the release workflow, testing, style, and a table of rejected patterns with the reason each
was rejected. Created this file.

**Also done.** Standardised the package manager on pnpm, which had been written as "npm
workspaces" in ADR 0001 and as pnpm everywhere else. Recorded as `D-21`.

**Lesson recorded.** `AGENTS.md` gained a closing section that says when a discovery belongs
in it and when it belongs here, so the two files do not drift into each other.

### 2026-09-28 — Session 3: the owner's working rule, feature branches

**The rule, as stated by the owner:** one feature per branch, and after the test the branch
is merged to `main`.

**Written down as a policy, not a habit**, in four places, because an unwritten workflow is
one an assistant will eventually break:

- `AGENTS.md` Part 8 gained a **Branch and merge policy** section: the four branch prefixes,
  the exact command loop, and the four rules inside it. The headline rule is *no direct
  commits to `main`*, with the merge gated on `pnpm lint && pnpm typecheck && pnpm test`
  all passing on the branch.
- `CONTRIBUTING.md` now opens with the loop, including the gate command and the squash-merge.
- `docs/RELEASES/README.md` rules gained the branch and the tag-on-`main` requirement.
- `VERSIONING.md` and `docs/PLAN.md` cross-reference it, so a session that starts at `PLAN.md`
  meets the rule in its first screen.

**Two choices made while writing it, worth keeping.** The merge is a **squash**, so `main`
gets one Conventional Commit per feature and the branch's work-in-progress commits do not
clutter the history; the alternative, merge commits, gives every mid-session commit the
status of permanent history. And the **tag goes on the merge commit on `main`**, never on a
branch, so a tag always points at something that is on the release path.

**Consequence to respect:** the first application commit must land on
`feature/0.1.0-foundation`, not on `main`. `main` currently holds the two planning commits
only, which is correct.

### 2026-09-28 — Session 4: migrations moved to Umzug

**The owner's instruction:** stop maintaining the migration runner. "If it's not violated,
then at the end migration running is not our work, it's handled by library, so ours is just
the wrapper."

**What changed.** `apps/api/src/db/migrate.ts` went from a 293-line hand-rolled runner to a
wrapper over **Umzug 3.8.3**. The SQL files are unchanged and still hand-written; the
runner is no longer ours. Recorded as `D-22` and
[ADR 0009](docs/adr/0009-migration-runner-umzug.md).

**Umzug, not `drizzle-kit`, and the reason matters if this is revisited.** `drizzle-orm` is
already the query layer, so `drizzle-kit` was the obvious candidate — but it makes the
*author* of the migration a schema object, which is exactly the auditability trade
`NFR-MAINT-02` refuses. Umzug only decides who *applies* a migration. If 0.2.0's 15 tables
make hand-writing SQL painful, the right answer is a generated-SQL review step, not an ORM
replacing the ledger.

**Two things that were not obvious and cost time.**

- Umzug's storage contract is only three methods (`logMigration`, `unlogMigration`,
  `executed`), and it keys migrations by **filename** (`0002_settings.sql`). Our ledger
  stores the **slug** and a version number. The wrapper translates through the manifest in
  `executed()`. Get this wrong and Umzug re-applies every migration on every boot, which
  fails with `UNIQUE constraint failed: schema_migrations.version` — the symptom does not
  mention filenames at all.
- Umzug's glob resolver **spreads the resolver's return value after its own `path`**, so
  returning `path: undefined` from a resolver silently clobbers a good value.

**The accepted cost, stated plainly:** Umzug calls `up()` and *then* records the row, so the
DDL and the ledger row are two transactions. A crash in that window leaves a migration
applied but unrecorded, and the next boot re-runs it and fails loudly with a named backup.
That is the project's preferred failure mode, and it is cheaper than the code it replaced.

**Verified, not assumed:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (71) and
`pnpm build` all pass; the CLI applies `0001` then `0002`, is idempotent on a second run,
and writes `pre-NNNN` backups; a deliberately broken migration rolls back with no partial
table, names its backup, and restores; the Docker image builds and reaches `healthy` with
2 migrations applied, and a container restart applies nothing new.

### 2026-09-28 — Session 5: the `pdm-migrate` container

**The owner's instruction:** a container that applies the migrations; the app starts only
after it has run and stopped. `D-23`, [ADR 0010](docs/adr/0010-migration-container.md).

**Decided together:** the app **refuses** to boot against an un-migrated schema
(`SchemaNotReadyError`) rather than still applying migrations as a safety net. One owner
for migrations. `pnpm dev` runs `pnpm --filter api migrate` first, so local and Docker
obey the same rule by different means.

**The shape that works:**

```yaml
pdm-migrate:
  <<: *pdm-common
  restart: 'no'
  command: ['node', 'api/cli/migrate.js']

pdm:
  <<: *pdm-common
  depends_on:
    pdm-migrate: { condition: service_completed_successfully, restart: false }
```

`restart: false` on the dependency is what makes `docker compose restart pdm` restart only
the app. Without it, restarting the app re-runs migrations. Verified by comparing the
migrator container's `StartedAt` before and after.

**Two things that surprised me, and both are the kind of thing that wastes an hour.**

- **The migrator's exit code is the entire contract.** `service_completed_successfully`
  reads the exit code and nothing else, so a failed migration was showing a stack trace
  and, worse, any path that returned 0 would have started the app anyway. The CLI now
  catches, prints the message that names the backup file, and `process.exit(1)`. There is
  an integration test that runs the CLI as a **child process** and asserts its exit code,
  because calling `migrate()` directly would pass while the container started regardless.
- **A migration is baked into the image.** My first attempt to test a broken migration
  failed open: the container never saw the new `.sql` file, so it reported "up to date" and
  started happily. `docker compose build` before `up` when the schema changes. This is
  correct and intentional — the schema is tied to the build that expects it — but it makes
  "I added a migration and nothing happened" a very quiet failure.

**The SQLite point the owner got right:** SQLite is a file, not a service, so the migrator
has no database to wait for. What it needs is *exclusive* access during DDL, and the
ordering provides it. It also makes the restore-on-failure path safer than before: nothing
holds `/data` open while a backup is copied over the live database.

**Verified in Docker, not assumed:** migrator exits 0 → app healthy; a deliberately broken
`0003` → migrator exits 1 and `pdm` is left in `created`, never `running`, nothing
listening; force-starting `pdm` past its dependency → it refuses with
`1 migration(s) have not been applied: 0003_broken` and exits 1; a real `ALTER TABLE`
`0003` over existing data → applied, `theme=system` and all 7 settings rows intact;
`restart pdm` → migrator not re-run.

### 2026-09-28 — Session 6: the clean-checkout gate that only failed when I tested it

**The bug:** `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` were all green in
the working tree. On a clean copy they were not. `tsc -b` failed with
`TS2307: Cannot find module '@pdm/shared'` in three files.

**Why:** `packages/shared/package.json` points `main`, `types` and `exports` at `./dist`,
and `dist` is git-ignored. So on a fresh clone it does not exist until something builds
it. `pnpm build` happened to work because `pnpm -r build` walks the workspace in
dependency order, and `pnpm dev` worked because I had already added a shared build to it.
`typecheck` and `test` were bare `tsc -b` and bare `vitest run`, so they assumed a build
had already happened. They inherited a green result from my earlier builds.

**The lesson, which is the second time this has bitten this repo:** a gate that only ever
runs in a dirty tree is not a gate. I had run `pnpm lint && pnpm typecheck && pnpm test`
many times and reported them green. The only reason this surfaced is that acceptance
criterion 14 says *"from a clean install"*, so I built a clean copy from
`git ls-files -co --exclude-standard` and ran the gates there. Do that once per release
before claiming a gate passed.

**Fix:** `typecheck`, `test`, `test:watch`, `test:coverage` and `test:int` now build
`@pdm/shared` first, the same way `dev` and `build` already did. The alternative was
TypeScript project references with `composite: true`, which is the more correct answer but
also means `noEmit: false` and `declaration: true` in the base config, and it touches the
Docker build. Noted in `BACKLOG.md` as a cleanup, not done now.

Verified in a fresh `/tmp` copy: `pnpm install --frozen-lockfile`, then lint, typecheck,
78 tests, build and 3 integration tests all pass with no `dist` present beforehand.

### 2026-09-28 — Session 7: a database that kept vanishing, and three wrong diagnoses

**What happened.** The 0.1.0 owner exit test could not be trusted. A fresh
`rm -rf data && mkdir data && docker compose up -d` failed roughly two runs in three with
`SQLITE_CANTOPEN`, and the migrator exited 1, so the app never started. Intermittently,
`docker compose ps` showed both services stuck in `Created` with an empty migrator log.

Worse, at one point the running app was healthy while `ls /data` inside the container
returned nothing and the process held `/data/pdm.db (deleted)`. The live database was an
unlinked inode. A restart would have destroyed it and the host would have held nothing.

**I got the cause wrong twice, and both wrong answers were plausible enough to act on.**

1. *Google Drive.* The repository is at `/Users/jayponda/Drive/...`, and `MEMORY.md` had
   already warned that live SQLite data must not live in a synced folder. I moved the
   volumes to `~/.local/share/pdm` and was about to call it fixed. Then the failure
   reproduced from a local temp path, so that was not it either.
2. *Permissions.* The container runs as uid 10001 and a host directory is owned by the
   laptop's uid 501, so "other" gets read and execute but not write. `chmod 777` made one
   run pass, and a 0755 directory then made another pass. It was never the permissions.

**What it actually was.** Docker Desktop's host file-sharing layer. Same image, same
command, changing only where `/data` came from:

| where `/data` comes from | result |
| --- | --- |
| bind mount, repository folder | 1 of 5 migrated |
| bind mount, local temp path | 2 of 5 migrated |
| Docker-managed named volume | **6 of 6 migrated** |

The clue that settled it: `accessSync('/data', W_OK)` succeeded while SQLite still could
not create a file in the directory. A directory that is stat-able, searchable and reported
writable, yet rejects `open()` for creation, is not a permission problem. It is a broken
filesystem view.

**The fix is the smaller change, not the larger one.** Two lines in `docker-compose.yml`
replacing two bind mounts with two named volumes. There is no host path to create, own or
`chown`, so the whole failure class is gone rather than documented around. Acceptance
criteria 3, 4, 10 and 17 and the exit test were updated, because they named `./data` and
the data is no longer there. The database is still a plain SQLite file —
`docker compose cp pdm:/data/pdm.db ./copy.db` opens it in any client, verified.

**The lesson, and it is the third time this has happened in this project:** a green test
run is evidence about the state you ran it in, and I had twice reported a green Docker
setup that failed on the next fresh run. Measure the operation you are about to document,
repeatedly, in the state the owner will actually be in. A single passing run proves
nothing about an intermittent fault — it is exactly what an intermittent fault looks like
when you are lucky. `pnpm test` is deterministic; `docker compose up` on this machine was
not, and only repeated runs said so.

Also fixed here: three violations of the `nowMs()`-only rule (`Date.now()` twice in
`/health`, `new Date()` in the backup filename), and criterion 11, which was not met — the
web app had never made a single API call and `App.tsx` claimed otherwise in a comment.

---

## Open threads

Things a future session should not have to rediscover. Checked and ticked when done.

- [x] **0.1.0 application code exists on `feature/0.1.0-foundation`, still uncommitted.**
      The spec is `docs/RELEASES/v0.1.0.md`; its status row is still `not started` and needs
      updating. Still outstanding for the release: CI workflow, `.env.example` and README
      operations, a container-reachability integration test, digest-pinning the base image,
      and live health rendering in the web shell. **Not yet merged to `main`, and not tagged.**
- [x] **`better-sqlite3` builds correctly**: `onlyBuiltDependencies` and `allowBuilds` are set
      in `pnpm-workspace.yaml` (pnpm 11 ignores a `pnpm` field in `package.json`). Note the
      docs still describe the old `package.json` form in places.
- [ ] **Eight open questions** (`OQ-1`…`OQ-8` in `docs/ROADMAP.md` §9) all have stated
      defaults so nothing is blocked. The two worth an answer when convenient: `OQ-1`, is
      MCP in scope for 1.0.0; `OQ-5`, the real office timesheet text format.
- [ ] **The owner runs every exit test.** Implementation self-verifies; the release does not
      move until the owner has run the script from the release spec.
- [ ] **The restore drill in 0.9.0 works on a copy of the real data**, and the real database
      is touched only on the owner's explicit instruction (`OQ-4`).
- [ ] **Only macOS has been exercised.** `NFR-PORT-01` requires Windows, macOS and Linux. Linux
      needs a documented one-time ownership fix for the mounted volume, because the container
      runs as a non-root user and a fresh host folder will be root-owned.
- [ ] **No release has been tagged yet.** The first is `v0.1.0`, and the rules are in
      `VERSIONING.md`.

## If you remember one thing

**Nothing is ever deleted, and business rules live in services, not in routes.** Every hard
guarantee in this project — the one-timer rule, the closure gate, the assistant's inability
to change anything — comes from those two sentences. Break either one and the SRS's
strongest requirements become things you hope are true rather than things you can test.
