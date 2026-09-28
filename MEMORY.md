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

---

## Open threads

Things a future session should not have to rediscover. Checked and ticked when done.

- [ ] **No application code exists.** 0.1.0 is the next thing to build, and its spec is
      already written at `docs/RELEASES/v0.1.0.md`.
- [ ] **`onlyBuiltDependencies` must be added to the root `package.json` before the first
      `pnpm install`**, or `better-sqlite3` will fail at the first query. See the gotcha above.
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
