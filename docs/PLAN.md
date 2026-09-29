# PDM — Working Plan

**Start here.** Read this file first in every session. It is short on purpose.

Product: **Personal Day Manager (PDM)** — a single-user, Docker-run day manager combining a
time tracker, a task and project manager with a mandatory acceptance-criteria closure gate,
a calendar, reminders, a knowledge library, reports and an MCP server for AI assistants.
All data stays on the laptop.

- Requirements: [`../requirnment.md`](../requirnment.md)
- Full plan and release ladder: [`ROADMAP.md`](ROADMAP.md)
- Version policy: [`../VERSIONING.md`](../VERSIONING.md)

---

## Where the project is right now

| Field | Value |
| --- | --- |
| Current release | **0.2.0 — Data model & core CRUD** |
| Status | **In progress.** The schema layer is done — 15 tables, `uid`/`archived_at`, the 13 no-delete triggers, the 3-link trigger, the one-timer index and the closure check constraint, asserted by 57 tests in `schema.test.ts`. The application layer is not started: no `services/`, no `views/`, no `middleware/`, no routes beyond `/health`, no web UI beyond the health shell |
| Completed releases | [`0.1.0`](RELEASES/v0.1.0.md) — Foundation & runtime, tagged `v0.1.0` 2026-09-29 |
| Spec for the current release | [`RELEASES/v0.2.0.md`](RELEASES/v0.2.0.md) — written 2026-09-29; **5 of 14 acceptance criteria done, 5 half, 4 not started** |
| Next release after that | 0.3.0 — Time tracking & timer. **Blocked**: a release does not start until the previous exit test has passed, and 0.2.0's exit test drives a UI that does not exist yet (the foundation layer landed 2026-09-29; the entity services, routes and UI are what remain) |
| Blocking questions | `OQ-1`…`OQ-8` in [`ROADMAP.md` §9](ROADMAP.md#9-open-questions-for-the-owner) — all currently using the stated default, so nothing is blocked |

## The twelve releases, in order

`0.1.0` foundation → `0.2.0` data model → `0.3.0` time tracking → `0.4.0` today and Day
log → `0.5.0` quality gate → `0.6.0` calendar → `0.7.0` reminders → `0.8.0` knowledge and
search → `0.9.0` reports and operations → `0.10.0` MCP read-only → `0.11.0` MCP create →
`1.0.0` general availability.

**Rule: a release does not start until the previous release's exit test has passed.**

## Start of session

1. Read [`../AGENTS.md`](../AGENTS.md) — the rules of this repository.
2. Read [`../MEMORY.md`](../MEMORY.md) — what earlier sessions learned, the verified
   environment, and any open threads.
3. Read the rest of this file, then the current release's spec in [`RELEASES/`](RELEASES/).
4. Check the branch: `git status`. You should be on `main` with a clean tree. If there is
   uncommitted work from a previous session, it belongs on a branch, not on `main`.

## How a release reaches `main`

```
feature/<version>-<short-description>   one feature, one branch
  → implement, committing as you go
  → pnpm lint && pnpm typecheck && pnpm test     the merge gate
  → squash-merge to main, one Conventional Commit
  → owner runs the exit test
  → tag vX.Y.Z on main
```

**Nothing is ever committed directly to `main`.** A branch is merged only after its tests
pass, so `main` always means "everything so far works". The full policy is in
[`../AGENTS.md`](../AGENTS.md) Part 8.

## Rules that apply to every session

1. **One write path.** Business-rule mutations go through service functions. Route
   handlers never write SQL. This is what makes the closure gate, the one-timer rule and
   the MCP permission limit provable.
2. **Nothing is ever deleted.** Removal sets `archived_at`. No `DELETE` in the API, no
   Delete button in the UI, database triggers block hard deletes.
3. **Spec before code.** If the current release's spec does not exist yet, write it first.
4. **Scope freezes at release start.** New findings go to [`../BACKLOG.md`](../BACKLOG.md)
   with a MoSCoW tag and a target release. They do not enter the current release.
5. **One new dependency needs one ADR.** Target is about ten runtime dependencies total.
6. **Every release ships behind `docker compose up -d`.** The owner never runs a dev
   server to review a release.
7. **Every release ends with the owner's exit test** from its spec.
8. **SRS requirement IDs are the vocabulary.** Write `FR-TIME-03` in a test name or a
   commit message, not a paraphrase.

## How to work a release

1. Read [`ROADMAP.md` §3](ROADMAP.md#3-the-release-ladder) for the release's scope.
2. Read or write [`RELEASES/vX.Y.Z.md`](RELEASES/).
3. Check the release's requirements against the SRS before writing code.
4. Implement, keeping the non-negotiable test list in [`TESTING.md`](TESTING.md) green.
5. Update [`../CHANGELOG.md`](../CHANGELOG.md), this file, and `docs/PERF.md` if a
   performance number changed.
6. Self-verify against every acceptance criterion in the spec.
7. Hand the owner the exit-test script. Do not tag until the exit test passes.

## Documentation map

| I need to… | Read |
| --- | --- |
| Know the rules of working in this repository | [`../AGENTS.md`](../AGENTS.md) |
| Know what is being built and why | [`ROADMAP.md`](ROADMAP.md) |
| Know what to build right now | this file, then [`RELEASES/`](RELEASES/) |
| Recall what earlier sessions learned | [`../MEMORY.md`](../MEMORY.md) |
| Understand a technical decision | [`adr/`](adr/) |
| Check a judgement call the SRS left open | [`DECISIONS.md`](DECISIONS.md) |
| Know what is deliberately not in 1.0 | [`DEFERRED.md`](DEFERRED.md) |
| Know how to run the tests | [`TESTING.md`](TESTING.md) |
| Know the performance budget | [`PERF.md`](PERF.md) |
| Run commands or follow conventions | [`../AGENTS.md`](../AGENTS.md) Part 4 |
| Start, stop, back up, restore, upgrade, remove | [`../README.md`](../README.md) |
| Understand a requirement ID | [`../requirnment.md`](../requirnment.md) |

## Working agreements for coding assistants

- Run the checks in [`../AGENTS.md`](../AGENTS.md) before proposing a change.
- Prefer many small service functions over clever SQL; the SQL belongs behind views.
- Every new business rule gets a test that names the requirement ID it satisfies.
- If a requirement turns out to be ambiguous, write the question into the current
  release spec rather than deciding it silently.
- If you find yourself adding a feature that is not in the current release's scope, stop
  and add it to [`../BACKLOG.md`](../BACKLOG.md).
