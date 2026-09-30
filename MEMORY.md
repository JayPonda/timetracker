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

### Vite only exposes `VITE_`-prefixed variables to the browser bundle

Discovered 2026-09-29, while building the project logger. The obvious move — read `LOG_LEVEL`
in both apps, because it is the name the project already documents — is a trap in the
frontend. Vite substitutes only `VITE_`-prefixed variables at build time, so an unprefixed
name is `undefined` in a bundle **by construction**. It does not error; it looks configured
and quietly logs at the default, which is the worst way for a log level to fail.

The API reads `LOG_LEVEL`; the browser reads `VITE_LOG_LEVEL`. Same class, same line format,
different variable name, for a reason that will not be obvious to the next person reading it.

### An env var documented in `.env.example` still has to be passed into the container

Same session. `LOG_LEVEL` was documented and read correctly in the code, and did nothing in
Docker, because `docker-compose.yml` enumerates the environment explicitly and the variable
was not in either service's list. A variable that is not listed is not inherited, whatever
`.env` says.

**This is the class of bug that survives review and passes every test**, because every test
runs outside the container. After changing any variable in `.env.example`, check it against
both `environment:` blocks in `docker-compose.yml`, and verify with
`docker compose config | grep VAR`. Done for `LOG_LEVEL`; the other variables were already
listed.

### Prettier was removed, because it cost more to review than it was worth

On 2026-09-29 the owner asked to drop Prettier after watching it reflow 305 lines of
`ROADMAP.md` tables around a one-line edit and reformat a test file a change had never
touched. `prettier`, `eslint-config-prettier`, `.prettierrc.json`, `.prettierignore` and the
`format` / `format:check` scripts are gone. `@stylistic/eslint-plugin` now enforces the style
inside `eslint.config.js`, so `pnpm lint` is the linter and the formatter check in one command
and `pnpm lint:fix` is the formatter.

**The 53-file problem dissolved, and that is the evidence the decision was right.** Those 53
failures were overwhelmingly *markdown* — tables, and files like `VERSIONING.md` that ESLint
does not lint at all. The first `@stylistic` rule set I wrote reported **204** errors, and 197 of
them were my own two rules disagreeing with the deliberate house style: interfaces here are
written `field: Type;` and I had asked for no delimiter, and the "single quotes" rule was
complaining about multi-line template literals that have no other spelling. Both rules were
wrong, not the 197 lines. Correcting the config to match the code left **7** real problems, all
of them genuine — 5 missing trailing newlines and 2 wrong indentation inside a template literal
in `migrate.ts` — fixed in 4 lines.

**The lesson generalises beyond formatting, and it is the one worth keeping.** A rule that
disagrees with 170 lines of deliberate code is a rule to delete, not a codebase to reformat. The
cheap test is to write the rule, run it, and read the *breakdown by rule* before reaching for
`--fix`. Had I run `lint:fix` on the first config I would have committed a 197-line whitespace
commit and called it tidying. Read the histogram; the 170 was one config mistake, not 170
mistakes.

**Do not reintroduce a second formatter.** Two formatters is how the noise came back: each
rewrites what the other touched. If a style needs enforcing, it goes in `eslint.config.js`.

### `pnpm test:coverage` was never wired up, and the version matters

`@vitest/coverage-v8` was not in any `package.json`, so the script failed with
`Cannot find dependency '@vitest/coverage-v8'`. It was documented in `AGENTS.md` and
`docs/TESTING.md` as "fails below N% on business modules", which reads as a passing gate and
is not one.

The fix is `pnpm add -D -w @vitest/coverage-v8@<same major as vitest>`. **The version suffix is
not optional.** Installing the provider unpinned pulled v5 against this repo's Vitest 2.1.9 and
failed at startup with a bewildering `vitest/node does not provide an export named
'BaseCoverageProvider'`, which reads like a Vitest bug rather than a major-version mismatch. The
provider and the runner must be the same major.

It matters because the 0.2.0 Definition of Done requires coverage on
`apps/api/src/services/**` and `packages/shared`, and that box could not honestly be checked
until the provider was installed.

**The second half of that gotcha: installing the provider was still not a gate.** The script ran
and exited 0 whatever it measured, because `vitest.config.ts` had no `coverage.thresholds`. A
report nobody fails on is a report nobody reads, and the DoD box would have been checked by
assertion — the exact thing the box was written to prevent. The `thresholds` block is now in
the root config, scoped to `services/**` and `packages/shared`, and it was verified by
temporarily raising the floor to 100% and watching the command exit 1. **Keep doing that check
after every change to the thresholds — a gate nobody has seen fail is not known to be a gate.**

**The floor is 95%, raised from 80% by owner decision on 2026-09-29, and it earned its keep
immediately.** Raising it failed the build, because `dateKeyRange` in
`packages/shared/src/time.ts` had **no test at all** — a public helper that walks a day range
by repeatedly advancing to the next local midnight, used for day-bucketed reports. It now has
six tests, including a DST transition (where a naive implementation drifts by an hour per
year) and the 4000-day bound. This is the argument for the higher number in one line: it found
untested code in the first minute, and the code was not trivial.

**Why the floor excludes `repositories/**` and `middleware/**`, deliberately.** A repository is
a query, and the rule it serves is verified by the service test that calls it. Thresholding
queries separately pushes tests to exist for coverage's sake rather than a rule's sake. They
are still in the `include` list, so a collapse is visible in the text report without being able
to fail a build on scaffolding.

**Coverage runs in CI as its own step, after `Test`, not as a flag on it.** Two reasons: a
combined step reports a coverage failure as "tests failed", which sends the next person to the
wrong file; and `pnpm test:coverage` re-runs the suite with the v8 provider loaded, so folding
it in would double the time for no gain. The job's timeout went 15 → 20 minutes to absorb the
extra run.

### The CI reporter is chosen by an environment variable, not a second script

Owner request 2026-09-29: *"only shows the test which fails … there should be a flag for ci or
silent."* The root `vitest.config.ts` now reads:

```ts
reporter: process.env['VITEST_REPORTER'] ?? (process.env['CI'] ? 'dot' : 'default')
```

`dot` prints a character per test file and expands only the failures, so a red build opens on
the cause instead of on 300 lines of passing files. `default` stays locally, where the long form
is what you want when you are watching one suite. `VITEST_REPORTER` overrides both.

**Why an env switch and not a separate `test:ci` script:** a second script is a second thing to
keep correct. It would drift — someone adds an argument to `pnpm test` and CI keeps running the
old command, and the gate stops being the gate. Here the tests, the assertions and the exit code
are identical either way, so the only difference is how much of it gets printed.

Note the spelling: `dot`, not `silent`. Vitest's `silent` reporter prints *nothing at all*,
including the failures, which is the opposite of what was asked for. `dot` is the one that shows
only what failed.

### A coverage threshold on *every* file is a threshold the team learns to ignore

`App.tsx`, `main.tsx`, `version.ts` — files whose lines are executed but whose branches are
either trivial or unreachable — can sit above or below the floor for reasons unrelated to whether
anyone wrote a test. Then a red build means "the threshold is annoying" rather than "a rule is
untested", and the one signal is gone. Scoping the floor to the directory that holds the
business rules keeps it meaningful.

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

### 2026-09-29 — Session 8: the API foundation layer, and making coverage a gate

**The owner's instruction:** continue with the 0.2.0 checklist, starting with Phase 0 — the
foundation every later service writes through.

**What landed.** The three layers now exist and are wired into `createServer`: the typed
`AppError` and its one code-to-status map, the error envelope moved out of `server.ts` into
`middleware/error.ts`, the principal seam, the services decorator, the declared-route table,
and the first repository and service pair (activity log). `packages/shared/src/uid.ts` adds
the UUIDv7 that nothing previously generated. 320 unit tests, 3 integration tests, all five
gates green.

**Four decisions worth keeping, because the code looks simpler without them:**

- **A capability declaration with an empty list is refused, not allowed.** The guard was
  `required.every(...)`, and `[].every()` is `true`, so a route declared with `capabilities: []`
  was open to everyone. The check is `required.length === 0 || missing.length > 0`. It is the
  same class of bug as an `if (!list.length)` guard on an empty list, and it would have been a
  capability hole with a test suite around it.
- **The route audit runs in `onReady` and throws**, so a handler added straight to the app
  cannot ship. This has a testing cost that cost me three failures: Fastify refuses `get` and
  `addHook` on a readied instance, so such a test must own the `ready()` call. That is what
  `createTestApp({ deferReady: true })` is for, and it is why the flag exists at all.
- **`@fastify/static` needs an exemption**, or a real frontend build makes the app refuse to
  boot. It keys on `config.file` *and* `config.rootPath`, both present, and the audit also
  skips `HEAD` where `GET` is declared. The exemption is tested against a capability
  declaration that merely names a file, which is the case that would otherwise hide a hole.
- **Services are decorated on the app, not built per handler.** A handler that constructed its
  own would hold a second Knex pool and open a transaction its other writes could not join.
  `createServer` now takes the Knex instance and builds the service once, which also removed
  the unused-parameter lint error that was the visible symptom of the wrong signature.

**The one thing I should have checked first.** `pnpm test:coverage` was green *and meaningless*.
Installing `@vitest/coverage-v8` fixed the crash, but the root `vitest.config.ts` had no
`coverage.thresholds`, so the command measured the whole tree and exited 0 regardless. A DoD box
checked by assertion is exactly what the box was written to prevent. The threshold now exists,
is scoped to `services/**` and `packages/shared`, and I verified it fails by raising the floor
to 100% and watching the exit code change. **A gate that has never been seen to fail is not
known to be a gate.**

**Later the same day the owner raised the floor to 95% and asked for it in CI, plus a reporter
that shows only failures.** The floor change immediately failed, on `dateKeyRange` in
`packages/shared/src/time.ts` — a public helper with no test at all. Six tests now cover it,
including a DST transition. Measured after: services 98.7%, packages/shared 95%. The reporter
is `dot` when `CI` is set, `default` locally, overridable with `VITEST_REPORTER`.

**Coverage is 98.7% on services and 95% on packages/shared**, from one real service file and
one uncovered helper that is now tested. That number is real and it is also not much of a claim:
it is one service. The threshold matters more as the entity services arrive, and 95% is
strict enough that a new service with an untested branch will fail the build on the day it is
written rather than after it has been shipped for a month.

### 2026-09-29 — Session 7: project logger, and an audit of 0.2.0

**The owner's instruction:** one logger class for the whole project, a singleton, logging
the good path as well as the failures, driven by an env level, writing to a channel, and
one line format. Then: check 0.2.0's acceptance criteria and make the documentation current.

**The logger.** Two classes, not one shared module, because the owner's decision was that
backend and frontend have different implementations: `apps/api/src/lib/logger.ts` and
`apps/web/src/lib/logger.ts`. They deliberately share the **level names and the line
format** and nothing else. The API's timestamp comes from `nowMs()` (ground rule 4), so a
test can freeze the clock and assert an exact line; the web one uses `Date.now()` because
it has no timing behaviour to test and no other module depends on its clock. All 15 existing
`console.*` call sites were converted, so one `LOG_LEVEL` now controls the whole API.

**Two things the design forced, that are worth remembering.**

- The logger reads `process.env` itself rather than taking its level from `AppConfig`. It
  cannot do otherwise: `main.ts` reports a `ConfigError` *through* the logger, and a logger
  that depends on a successfully parsed config cannot log the failure that parsing produced.
  `configSchema` validates the same variable so a typo is also refused at boot by name.
- Errors and warnings go to **stderr**, everything else to stdout. That was my call, not the
  owner's — they said "stdout, use the console APIs", which I read as "the console, not a
  file or a remote sink". Node routes `console.warn`/`console.error` to fd 2 for free, so
  `2>errors.log` works; `docker compose logs` shows both. **If the owner wants one stream,
  this is the line to change**, and it is `CONSOLE_METHOD` in either logger.

**Routing the API through the logger had a side effect worth catching.** `server.ts` logged
"no frontend build; serving the API only" through Fastify's pino logger, which is off in
tests, so the message was silent. Through the project logger it printed on every test that
builds a server, burying real failures under dozens of identical lines. `vitest.config.ts`
now sets `LOG_LEVEL=silent` unless the environment already sets one, so
`LOG_LEVEL=debug pnpm test` still shows everything. `migrate.int.test.ts` pins `info` for
the CLI it spawns, because it asserts on the migrator's real output and silence would have
made those assertions vacuous.

**The 0.2.0 audit, which is the more important half of this session.** The release is
**not done**, and the honest answer is that roughly a quarter of it exists:

- **Done (3 of 14 criteria):** the 13 no-delete triggers with an enumeration test
  (`DATA-10`), `uid` and `archived_at` on every user-data table (`DATA-13`/`DATA-11`), and
  the five green commands. All schema-layer, all covered by `schema.test.ts` (57 tests).
- **Half (3):** the 3-link trigger exists but no route returns 422; `todo` has a foreign key
  and `archived_at` but nothing asserts archiving keeps the entries; `project_id` is
  nullable but there is no virtual bucket.
- **Not started (8):** everything needing a service, a route or a component.

`apps/api/src/services/`, `apps/api/src/views/` and `apps/api/src/middleware/` **do not
exist**. There is no route except `/health`, and the web app is still the 0.1.0 health shell.
So archive, restore, CRUD, the activity log and the capability map have nowhere to live, and
**the 0.2.0 exit test cannot be run at all** — it creates projects and tasks through a UI
that does not exist. `docs/PLAN.md` and the release spec both still said "not started",
which is now wrong in a different direction, so both were rewritten with the real position.

**Documentation corrected, because each of these was actively misleading:**

- `LOG_LEVEL` was documented in `.env.example` and read correctly, and **did nothing in
  Docker**, because neither service listed it. This is the bug that passes every test,
  since no test runs in a container. Now passed to both containers and verified with
  `docker compose config`.
- `pnpm test:coverage` was documented in two files as "fails below 80% on business modules",
  which reads as a working gate. It had never worked: `@vitest/coverage-v8` was not installed.
  Installed in the Phase 0 session below, matched to the Vitest major — see the gotcha above.
- `docs/TESTING.md` documented `pnpm test:ui` and `pnpm perf`. Neither script exists.
- `AGENTS.md` had no mention of logging at all. It now has ground rule 12, a rejected-pattern
  row for `console` and for logging libraries, a stack-table row, and a Part 12 history entry.
- `README.md` now documents the line format and `LOG_LEVEL` under Logs.

**Verified, not assumed:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (15 files, 220 tests),
`pnpm test:int` (3 tests) and `pnpm build` all pass; `docker compose config` resolves
`LOG_LEVEL` into both services. Zero `delete*` functions, zero `DELETE` routes, zero
`ON DELETE CASCADE`; 42 test `describe` blocks name a requirement ID; nine external runtime
dependencies against a target of ten.

**Still open, deliberately not done here:** the eight unimplemented criteria, and whether the
stderr/stderr split above is what the owner wanted.

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

**Umzug, not `drizzle-kit`, and the reason matters if this is revisited.** `drizzle-kit` was
the obvious candidate — but it makes the *author* of the migration a schema object, which is
exactly the auditability trade `NFR-MAINT-02` refuses. Umzug only decides who *applies* a
migration. If 0.2.0's 15 tables make hand-writing SQL painful, the right answer is a
generated-SQL review step, not an ORM replacing the ledger.

**`drizzle-orm` was declared for 0.1.0 and never used, then dropped on 2026-09-29.** It
sat in `apps/api/package.json` with zero imports while `AGENTS.md`, `docs/ROADMAP.md` and
ADR 0009 all described it as the query layer. The owner dropped it in favour of hand-written
SQL over `better-sqlite3`, and the docs were corrected to match. Accepted cost: no
compile-time column checking, so a renamed column is a runtime error caught by tests rather
than by `tsc`. This closed the `AGENTS.md` rule 10 exception that 0.1.0 shipped with — the
first release to record an accepted deviation from its own DoD.

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

### 2026-09-29 — Session 6: Full Knex (runner + query layer)

**The owner's instruction:** Knex everywhere. The 0.2.0 repository layer already needed a
query builder; the owner chose **Full Knex** — Knex runs the migrations too, and
`knex_migrations` is the only ledger. Umzug was removed from `apps/api/package.json`
(pnpm dropped 24 transitive packages). Recorded as `D-24` and
[ADR 0012](docs/adr/0012-migration-runner-knex.md), which supersedes ADR 0009. This also
moves the data-access layer from the "hand-written SQL over `better-sqlite3`" that the
drizzle-drop entry above landed on, to Knex — the drizzle-drop still stands, Knex is just
a thin query builder over the same driver.

**What changed.** The `.sql` migration files (including `0001_schema_migrations.sql`) are
gone. Migrations are now `NNNN_name.js` ESM modules embedding the reviewed DDL
byte-identical to the source SQL (verified with a per-file diff at generation time),
renumbered, and on 2026-09-29 consolidated into a single `0001_initial_schema` (`D-26`). Each runs its DDL in
one native better-sqlite3 transaction (`disableTransactions: true` so Knex does not wrap
it), meaning a failed migration leaves no partial schema *and* no ledger row. `migrate.ts`
keeps the pre-migration `VACUUM INTO` backup, restore-and-abort naming the file, and the
contiguity check.

**The checksum dropped, and why that is safe here.** `knex_migrations` never carried a
checksum, so the immutability guarantee was ours to maintain against a ledger that could
not enforce it. Every migration is `IF NOT EXISTS`, so an edited-and-re-run migration is a
safe no-op, and the contiguity check still catches a deleted one. The owner accepted this
explicitly; the trade is written into ADR 0012 so it is never re-made silently.

**Knex quirks that cost time.**

- `migrationSource.getMigrations` must return a **Promise** — Knex's `MigrationSource`
  type expects `Promise<unknown[]>`, even though `Promise.all` wraps it at runtime. Our
  first version was sync and `tsc` complained.
- Knex only `warn`s `migration file "X" failed` and **rethrows the raw SqliteError**, so
  the runner has to track the failing file via its own `state.active` to name the backup.
- The ledger stores the **filename including `.js`** (`0001_initial_schema.js`), not just the
  slug. Keep `FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.js$/` in sync with the naming.
- After build, the Docker copy step must **mirror** (`rmSync(to)` before `cpSync`), not
  merge — stale dist files were elsewhere being copied, and since migrations are `.js` now,
  any leftover `.sql` in `dist` would confuse a future glob.

**Verified, not assumed:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (13 files, 168
tests) and `pnpm --filter api build` all pass; the built CLI applies `0001`–`0003` to a
copy of the **real 0.1.0 volume** (all rows and 7 settings preserved), records them in
`knex_migrations`, and is idempotent on a second run ("up to date, 3 migration(s)
already applied", exit 0).

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
- [ ] **0.2.0 has its foundation but not its entities.** The schema is complete and tested, and
      the three layers now exist: `apps/api/src/{lib,middleware,routes,repositories,services}/`,
      with the error envelope, the principal seam, the declared-route table, the activity log
      and the first service. Still missing: `apps/api/src/views/`, the entity services
      (project, task, todo, tag, link, acceptance criteria), every route but `/health`, and the
      whole web UI beyond the 0.1.0 health shell. **5 of 14 acceptance criteria are done, 5 are
      half, 4 are not started. The exit test still cannot be run**, because it drives a UI.
      Full breakdown in [`docs/RELEASES/v0.2.0.md`](docs/RELEASES/v0.2.0.md). The next session
      that touches 0.2.0 should start with the entity services and routes, not more foundation.
- [x] **`pnpm test:coverage` works *and* gates.** `@vitest/coverage-v8@2.1.9` installed as a root
      devDependency on 2026-09-29, matched to the repo's Vitest major. Installed unpinned it
      pulls v5 and dies with `vitest/node does not provide an export named
      'BaseCoverageProvider'`. The **95%** floor (raised from 80% by owner decision) is a
      `thresholds` block in `vitest.config.ts`, so the command fails below it — verified by raising it to 100% and
      watching it exit 1. Services 98.7%, packages/shared 95%. Raising the floor from 80% to
      95% exposed `dateKeyRange` in `time.ts` having no test at all; it has six now.
- [x] **CI runs `pnpm test:coverage` as its own step** after `Test`, and the reporter is `dot`
      when `CI` is set, `default` locally, `VITEST_REPORTER` to override. `dot`, not `silent` —
      `silent` prints the failures too, which is the opposite of the point. The `gates` job
      timeout went 15 → 20 min to absorb the extra suite run.
- [ ] **A route audit that runs in `onReady` cannot be tested against a `ready` app.** Fastify
      refuses `app.get(...)` and `app.addHook(...)` on an instance that has been readied —
      `Fastify instance is already listening. Cannot add route!` — so a test that wants to
      register an undeclared route and observe the audit failing has to own the `ready()`
      call itself. `createTestApp({ deferReady: true })` is the seam. Cost me three test
      failures that were all the same mistake, in three different forms.
- [ ] **`@fastify/static` registers routes the audit would otherwise reject.** One route per
      built file, with no capability declaration, so a real frontend build would make the app
      refuse to boot. The exemption keys on `config.file` and `config.rootPath`, both present,
      and the audit also skips `HEAD` when `GET` is declared. Do not "simplify" this away: the
      test that covers it is in `routes/table.test.ts`.
- [ ] **The stderr/stdout split in the logger is my call, not the owner's.** `warn` and
      `error` go to `console.warn`/`console.error` (fd 2), everything else to stdout. If the
      owner wants one stream, it is `CONSOLE_METHOD` in `apps/api/src/lib/logger.ts` and the
      same constant in `apps/web/src/lib/logger.ts`.
- [ ] **`pnpm test:ui` and `pnpm perf` were documented in `docs/TESTING.md` but do not
      exist.** Removed from the doc on 2026-09-29. If either was meant to exist, it needs
      writing; nothing references them.
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

## Lessons from 2026-09-29 (the Docker verification)

- [x] **The image bakes in the migrations, so `docker compose up` alone migrates nothing
      new.** The container was still on the old migration files after a new one was
      written, and `/health` reported `pending: 0` and was wrong — the pending count is
      computed against the container's own migrations directory, so a stale image reports
      "nothing pending" while the database is out of date. `pending: 0` proves nothing
      about whether the build is current. **Always `docker compose build` then
      `docker compose up -d`.**
- [x] **Never run a probe that writes against the live data volume.** A `DELETE` test
      inserted `probe-1` into the real `tasks` table, and because the no-delete trigger
      refused the cleanup, the row stayed. It had to be archived rather than deleted,
      because the rule that blocked the cleanup is the same rule that says a row is never
      removed. A probe that cannot run against a temp database should not touch the
      owner's data at all.
- [x] **A clean run is not an upgrade.** Every test migrated an empty file, which is why
      a dead 0.1.0 ledger survived a release whose spec said it was gone. Fixed by
      deciding not to support the upgrade at all (`D-26`), not by patching it.
- [x] **The migrator's contract is now verified end to end,** including the failure path:
      a deliberately broken migration exits 1, names itself and the SQL error, restores
      its backup, rolls back the partial schema, and `pdm` does not start.
- [x] **The three migrations are now one, `0001_initial_schema`.** They carried version
      numbers in their own comments (`-- 0002:`, `-- 0003:`, `-- 0004:`) that no longer
      matched their filenames after the `D-24` renumbering. Nobody had opened them since.
      **The next migration is `0002`.**

- [x] **2026-09-30: the project domain is usable end to end.** Repository, service,
      declared routes and `/projects` screen are done; archive/restore write history in
      the same transaction; default lists hide archived rows. Tasks, tags and the exit
      test remain unbuilt.
- [x] **Do not trust Knex `.returning()` to have one shape.** With `better-sqlite3`
      it returned an object where a number was expected, so the first project insert
      produced `entity_id: NaN` in `activity_log`. The repository now reads the new id
      back through the row's unique `uid` in the same transaction.
- [x] **Docker Desktop was not running for the final project-slice check.** Local
      gates are green (`370` unit, `3` integration, coverage, build, compose config),
      but the rebuilt container serving `/projects` still needs one `docker compose
      build && up` verification when the daemon is back.

## If you remember one thing

**Nothing is ever deleted, and business rules live in services, not in routes.** Every hard
guarantee in this project — the one-timer rule, the closure gate, the assistant's inability
to change anything — comes from those two sentences. Break either one and the SRS's
strongest requirements become things you hope are true rather than things you can test.
