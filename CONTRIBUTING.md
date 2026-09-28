# Contributing

This is a single-user, private project. Contribution means working on a release from the
plan, not proposing a new feature.

## Where to start

1. Read [`docs/PLAN.md`](docs/PLAN.md). It names the current release.
2. Read that release's specification in [`docs/RELEASES/`](docs/RELEASES/).
3. Read [`AGENTS.md`](AGENTS.md) for the commands and the conventions that make the specific
   requirements in this project provable.

If the current release's specification does not exist yet, write it before writing code.

## Working on a release

```bash
git switch -c feature/0.3.0-timer-start-stop
```

Commits follow Conventional Commits, with the requirement ID whenever one applies:

```
feat(timer): start and stop from the top bar (FR-TIME-01, FR-TIME-03)
fix(timer): reject an entry whose end is before its start (FR-TIME-16)
test(gate): assert Confirm stays disabled without a lagging reason (FR-GATE-05)
docs(adr): record the loopback boundary decision (ADR 0001)
chore(db): add uid to task_links (DATA-13)
```

Types: `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `chore`, `build`, `ci`, `data`
(for a migration), `security`.

## Before you open a pull request

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass
- [ ] New business rules have tests that name the requirement ID
- [ ] Business-module coverage is at or above 80%
- [ ] No `delete*` function, no `DELETE` route, no `db.delete()`
- [ ] No business rule in a route handler
- [ ] No new runtime dependency, or an ADR explaining it
- [ ] A migration is additive, transactional, and takes a backup first
- [ ] Anything out of scope is in [`BACKLOG.md`](BACKLOG.md), not in your diff
- [ ] `docs/RELEASES/vX.Y.Z.md` updated for what you completed
- [ ] `CHANGELOG.md` updated under **Unreleased**

## The rules that are not negotiable

These are the ones that make the SRS's promises provable rather than aspirational. Breaking
one is a defect, not a preference.

1. **One write path.** Business rules go in `apps/api/src/services`. Route handlers do
   plumbing. This is what proves that no route can end a task without the closure gate
   (`FR-STAT-01`, `FR-GATE-08`) and that the assistant cannot mutate anything (`MCP-14`).
2. **Never delete.** Removal sets `archived_at`. The database blocks hard deletes. There is
   no Delete button.
3. **Totals are computed, never stored** (`DATA-04`). If a total could drift, it is a bug.
4. **`nowMs()` is the only clock.** Tests depend on it.
5. **The running timer lives in the database**, not in memory, a cookie, or browser storage.
6. **Every route declares capabilities**, and checks default deny.
7. **Every list query filters `archived_at IS NULL`** unless archived items were requested.

## Review

- One release, one branch, one pull request. Not three features in one.
- Reviewers read the acceptance criteria in the release spec first, then the diff.
- A requirement that turns out to be ambiguous gets written into the spec as a question, not
  decided silently in the code.
- Disagreement about a design decision goes in an ADR, not in a comment thread.

## Reporting a defect

Include the version, what you did, what you expected, what happened, and the relevant
lines of `docker compose logs pdm`. If it is a data-loss or timer defect, say so in the
first line — that changes the priority.
