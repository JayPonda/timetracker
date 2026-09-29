# Versioning

How versions are numbered, tagged and released in this project.

## The scheme

`MAJOR.MINOR.PATCH`, with no `v` prefix in prose and in file contents. Git tags carry the
prefix: `v0.3.0`. The Docker image is tagged `0.3.0` and `latest`.

The version lives in exactly one place — `version` in the root `package.json` — and is
injected into the app, the MCP server, `/health` (`DEP-06`) and the image tags. Nothing
else contains a version string, so there is nothing to keep in sync by hand.

This is enforced rather than merely intended. `apps/api/src/version.ts` is the only
reader, resolving in this order:

1. `PDM_VERSION` — a Docker build arg, so a tagged build reports its own tag.
2. The root `package.json` — read at runtime, so `pnpm dev` and a test agree.
3. `0.0.0-unknown` — visibly wrong on purpose, so a packaging mistake is noticed
   rather than believed.

`docker-compose.yml` interpolates `PDM_VERSION` into both the build arg and the
image tag, so `pdm:0.2.0` and `/health`'s `version` cannot disagree. CI resolves
`package.json`, passes it to `docker build`, and then **asserts the running
container reports it** — the check that was missing when `/health` returned a
hardcoded fallback that would have read `0.1.0` all the way to 0.12.0.

To release: bump `package.json`, tag `v<version>`, and nothing else.

## What each number means

| Number | Changes when | Example |
| --- | --- | --- |
| **MAJOR** | 1.0.0 only. Before 1.0.0 it is always 0 | — |
| **MINOR** | A release ships. In the 0.x range a minor is the unit of scope: one release from the ladder | `0.3.0` — the timer |
| **PATCH** | A fix to a shipped release, or a documentation or dependency change with no behaviour change | `0.3.1` — a fix to the pause flow |

## The pre-1.0 ladder

Before 1.0.0, the minor version **is** the release, so the version tells you which part of
the plan you are looking at.

```
0.1.0  Foundation and runtime
0.2.0  Data model and core CRUD
0.3.0  Time tracking
0.4.0  Today, Day log, where the time went
0.5.0  Quality gate
0.6.0  Calendar and events
0.7.0  Reminders and notifications
0.8.0  Knowledge and search
0.9.0  Reports, export/import, operations
0.10.0  MCP server, read-only
0.11.0  MCP server, create, audit, safety
1.0.0  General availability
```

### Why this continues past 0.9.0

`0.10.0` is greater than `0.9.0`. That is correct semver and correct for every tool that
compares versions, but people misread it. The alternative — using `0.9.1` and `0.9.2` for
the two MCP releases — would mean shipping a large feature in a patch version, which is
wrong in a different way.

**The project uses `0.10.0` and `0.11.0`.** To keep the confusion away, all twenty or so
places a version is written use the full `0.10.0` form and never a bare `0.10`. This is
recorded as open question `OQ-2` in
[`docs/ROADMAP.md`](docs/ROADMAP.md#9-open-questions-for-the-owner); switching to
`0.9.x` later would mean two version bumps and a note in the changelog, so the decision is
reversible.

## 1.0.0 and after

`1.0.0` means the SRS's **Must** requirements are all implemented and verified, the **Should**
items are done or listed in [`docs/DEFERRED.md`](docs/DEFERRED.md) with a reason, and the
traceability table in [`docs/ROADMAP.md`](docs/ROADMAP.md) §4 is complete.

After 1.0.0, MINOR is a feature release and MAJOR is reserved for a change that breaks
existing data or the API contract. Under the no-delete policy a MAJOR release is rare: data
is only ever added, so a migration is additive and a version bump is rare.

## Patch releases before 1.0.0

Two cases:

- **A fix to the current or previous release.** The old version is tagged `v0.3.1` and
  `docs/RELEASES/v0.3.0.md` gains a patch section.
- **A small planned item finishing early**, such as `FR-TIME-08` pause and resume. The
  release spec says so *before* the work starts; otherwise a small feature takes a minor
  number. `OQ-7` in the roadmap covers the pause case.

A release never goes backwards. A version is never reused.

## Cutting a release

1. All acceptance criteria in `docs/RELEASES/vX.Y.Z.md` pass.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, `pnpm build` are green.
3. Any performance change is recorded in `docs/PERF.md` with numbers.
4. The owner has run the exit test and it passed, and the date is written into the spec.
5. `CHANGELOG.md` moves the entries from **Unreleased** to `## [X.Y.Z]`, dated.
6. `docs/PLAN.md` points at the next release.
7. `package.json` version is bumped. **This is the only edit.** Nothing else carries a
   version string (see the top of this file).
8. Merge to `main`, then `git tag -a vX.Y.Z -m "X.Y.Z — name"` and push the tag.
9. Build the image from the merged `main`, which carries the bumped `package.json`:

   ```bash
   docker compose build
   docker tag pdm:X.Y.Z pdm:latest
   ```

   There is no registry to push to; the app runs on one laptop (`NFR-PRIV-01`).
   To confirm the image reports the release it came from, read it back:

   ```bash
   docker compose up -d --wait
   curl -fsS http://127.0.0.1:8080/health | grep -o '"version":"[^"]*"'
   ```

**A release is cut only from `main`, never from a feature branch.** The work happens on
`feature/<version>-<short-description>`, is squash-merged once its tests are green, and the
tag goes on the merge commit on `main`. See the branch and merge policy in
[`AGENTS.md`](AGENTS.md) Part 8.

## Backport policy

A fix that affects data safety, the no-delete policy, the capability map or the backup path
is backported to the previous released version. Everything else is fixed forward only, so
the ladder stays readable and the user is not asked to maintain two branches of an app that
runs on their own laptop.

## What a version number promises

A released version means: it starts with `docker compose up -d`, it migrates its own
schema from the previous version without data loss, and the exit test in its specification
passed on the owner's laptop. Nothing else does.
