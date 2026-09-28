# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](VERSIONING.md) — `MAJOR.MINOR.PATCH`, no `v` prefix, `vX.Y.Z` for git
tags.

Unreleased work is listed under **Unreleased**. A release moves to a version heading only
when its exit test has passed, and its git tag `vX.Y.Z` is created at the same moment.

## [Unreleased]

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

## [0.1.0] — Foundation & runtime

Planned. Not started. See [`docs/RELEASES/v0.1.0.md`](docs/RELEASES/v0.1.0.md).
