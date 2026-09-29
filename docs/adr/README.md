# Architecture decision records

One file per decision that shapes the codebase. An ADR is written **before** the code it
governs, and is never rewritten afterwards — if a decision changes, write a new ADR that
supersedes the old one and say so here.

| ADR | Decision | Status | Release |
| --- | --- | --- | --- |
| [0001](0001-stack-and-deployment.md) | Stack and deployment shape, including the loopback conflict | Accepted | 0.1.0 |
| [0002](0002-no-delete-and-archival.md) | How "nothing is ever deleted" is enforced | Accepted | 0.2.0 |
| [0003](0003-running-timer-state.md) | The running timer is a database row, not application state | Accepted | 0.3.0 |
| [0004](0004-time-and-duration-model.md) | Timestamps, durations, time zones and midnight splitting | Accepted | 0.2.0 |
| [0005](0005-search-with-fts5.md) | Search uses SQLite FTS5 over a denormalised document table | Accepted | 0.8.0 |
| [0006](0006-mcp-capability-map.md) | The MCP permission limit is enforced in the app, default deny | Accepted | 0.10.0 |
| [0007](0007-backup-export-import.md) | Backups use the online API; import merges on a stable `uid` | Accepted | 0.9.0 |
| [0009](0009-migration-runner-umzug.md) | Migrations run through Umzug over plain SQL; the runner is a thin wrapper | Accepted | 0.1.0 |
| [0010](0010-migration-container.md) | A one-shot `pdm-migrate` container applies migrations; the server refuses to run without them | Accepted | 0.1.0 |
| [0011](0011-react19-tailwind4.md) | The frontend runs React 19 and Tailwind 4, so the roadmap's stated stack is real | Accepted | 0.1.0 |

## Format

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-NNNN
- Date: YYYY-MM-DD
- Affects: requirement IDs, release

## Context
The forces at play. What made a decision necessary.

## Decision
What we are doing, in the present tense.

## Consequences
What this makes easy, what it makes hard, and what we accept as a cost.

## Alternatives considered
Each one, and the specific reason it lost.
```

## When a new ADR is required

- A new runtime dependency.
- A change to how data is stored, deleted, or versioned.
- A change to how the app is deployed or networked.
- A change to how a business rule is enforced, where the enforcement location matters.
- Any answer to an `OQ` in [`../ROADMAP.md`](../ROADMAP.md#9-open-questions-for-the-owner)
  that alters a decision already recorded here.

An ADR is not needed for a library that only touches presentation, or for a change of
roughly ten lines inside an existing pattern.
