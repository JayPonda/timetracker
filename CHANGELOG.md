# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](VERSIONING.md) — `MAJOR.MINOR.PATCH`, no `v` prefix, `vX.Y.Z` for git
tags.

Unreleased work is listed under **Unreleased**. A release moves to a version heading only
when its exit test has passed, and its git tag `vX.Y.Z` is created at the same moment.

## [Unreleased]

Nothing yet. The next entry is `0.1.0` — Foundation & runtime.

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
