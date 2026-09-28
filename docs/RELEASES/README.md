# Release specifications

One file per release, written **before** the release starts. A release is built against its
spec, not against a memory of the last conversation.

| Release | Name | Status | SRS phase | Spec |
| --- | --- | --- | --- | --- |
| 0.1.0 | Foundation & runtime | next | §3 | [v0.1.0.md](v0.1.0.md) |
| 0.2.0 | Data model & core CRUD | planned | §9 | — |
| 0.3.0 | Time tracking | planned | §4 | — |
| 0.4.0 | Today, Day log & where the time went | planned | §8.3, §8.4 | — |
| 0.5.0 | Quality gate | planned | §6 | — |
| 0.6.0 | Calendar & events | planned | §7.1 | — |
| 0.7.0 | Reminders & notifications | planned | §7.2, §7.3 | — |
| 0.8.0 | Knowledge & search | planned | §8.1, §8.2 | — |
| 0.9.0 | Reports, export/import & operations | planned | §8.4, §3 | — |
| 0.10.0 | MCP server: read-only | planned | §14 read | — |
| 0.11.0 | MCP server: create, audit & safety | planned | §14 write | — |
| 1.0.0 | General availability | planned | all | — |

Scope, requirements, acceptance criteria and exit tests for the whole ladder are already
written in [`../ROADMAP.md` §3](../ROADMAP.md#3-the-release-ladder). A release spec here
adds what the roadmap cannot: the concrete design of that release, its questions, and the
state of each acceptance criterion.

## Status values

| Status | Meaning |
| --- | --- |
| `not started` | No work has begun |
| `in progress` | Implementation under way |
| `in review` | Self-verified; the owner is running the exit test |
| `released` | Exit test passed, tagged |
| `carried` | Scope moved to a later release, with a note in [`../DEFERRED.md`](../DEFERRED.md) |

## Template for a new release spec

```markdown
# vX.Y.Z — <name>

- **Status:** not started
- **Target:** <release this one unblocks>
- **Started:** YYYY-MM-DD
- **Released:** —
- **Exit test passed by owner:** — (date)
- **SRS phase:** §N

## Goal
One paragraph. What the user can do after this release that they could not do before.

## In scope
Requirement IDs plus what that means concretely for this release.

## Out of scope
Everything a reader might reasonably expect to find here but will not, with the reason and
where it went.

## Design notes
The decisions specific to this release: schema, routes, components, tricky behaviour.
References to ADRs.

## Acceptance criteria
Numbered, testable, each naming the requirement IDs it satisfies. Copied verbatim from
`ROADMAP.md` §3 and extended where the release needs more detail.

## Exit test
The script the owner runs, step by step, with the expected result at each step. Ten to
fifteen minutes. This is the gate for the next release.

## Definition of Done
The checklist from `ROADMAP.md` §5.4, ticked as it is met.

## Risks
Release-specific risks and the mitigation being applied.

## Questions
Anything ambiguous found while writing this spec. Each becomes an entry in
`DECISIONS.md` or an `OQ` in the roadmap — never a silent decision in the code.
```

## Rules

1. **A spec is written first.** Implementation does not start against a blank release.
2. **Scope is frozen when the release is marked `in progress`.** Later findings go to
   [`../../BACKLOG.md`](../../BACKLOG.md) with a target release.
3. **Every acceptance criterion is checkable by someone who did not write the code** — the
   owner, using the exit test.
4. **A criterion moves only by being met, or by being carried with a written reason.** It
   is never quietly dropped.
5. **Requirements are quoted by ID from the SRS**, never paraphrased, so a mismatch between
   the spec and the SRS becomes visible in review.
6. **Each release is built on its own branch**, `feature/<version>-<short-description>`,
   and is squash-merged to `main` only after `pnpm lint`, `pnpm typecheck` and `pnpm test`
   pass. Nothing is committed directly to `main`. See the branch and merge policy in
   [`../../AGENTS.md`](../../AGENTS.md) Part 8.
7. **A release is tagged on `main`**, on the merge commit, after the owner has run the exit
   test. Never on a feature branch. See [`../../VERSIONING.md`](../../VERSIONING.md).
