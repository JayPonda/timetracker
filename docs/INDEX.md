# Documentation index

Reading order for the whole documentation set. If you are picking up the project for the
first time, read files 1 to 4 in order, then jump to the release you are working on.

| # | File | Read it when | Length |
| --- | --- | --- | --- |
| 1 | [`../README.md`](../README.md) | You want to know what this project is and whether it runs | short |
| 2 | [`../AGENTS.md`](../AGENTS.md) | **Every session.** The rules of this repository, from setup to rejected patterns | long |
| 3 | [`PLAN.md`](PLAN.md) | **Every session.** Current release, what to do next | short |
| 4 | [`../MEMORY.md`](../MEMORY.md) | **Every session**, after AGENTS.md. What earlier sessions learned, and what is true of this machine | medium, grows |
| 5 | [`../requirnment.md`](../requirnment.md) | You need the exact wording of a requirement | long, 828 lines |
| 6 | [`ROADMAP.md`](ROADMAP.md) | You need the strategy, the twelve releases, traceability, risks | long |
| 7 | [`RELEASES/vX.Y.Z.md`](RELEASES/) | You are building a specific release | medium each |
| 8 | [`adr/`](adr/) | You want to know why a technical choice was made | one page each |
| 9 | [`DECISIONS.md`](DECISIONS.md) | The SRS left a question open and you need the answer | short |
| 10 | [`DEFERRED.md`](DEFERRED.md) | Someone asks for something that is not in 1.0 | short |
| 11 | [`TESTING.md`](TESTING.md) | You are writing tests or fixing a failing one | medium |
| 12 | [`PERF.md`](PERF.md) | You are adding something that could slow the app | short |
| 13 | [`../VERSIONING.md`](../VERSIONING.md) | You are cutting a release | short |
| 14 | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | You are about to open a branch | short |
| 15 | [`../BACKLOG.md`](../BACKLOG.md) | You found something that does not fit the current release | short |
| 16 | [`../CHANGELOG.md`](../CHANGELOG.md) | You want to know what changed and when | grows over time |

## Which document answers which question

| Question | Answer lives in |
| --- | --- |
| What is the product and how do I run it? | `README.md` |
| What are the rules of working in this repository? | `AGENTS.md` |
| What am I building right now? | `PLAN.md` |
| What did earlier sessions learn, and what is true of this machine? | `MEMORY.md` |
| Why is the timer built before the calendar? | `ROADMAP.md` §1 |
| What exactly is in 0.5.0? | `RELEASES/v0.5.0.md` |
| Why Fastify and not Express? | `adr/0001-stack-and-deployment.md` |
| How is it impossible to delete data? | `adr/0002-no-delete-and-archival.md` |
| What happens to a timer when the container restarts? | `adr/0003-running-timer-state.md` |
| How are durations and time zones handled? | `adr/0004-time-and-duration-model.md` |
| How does search stay under a second? | `adr/0005-search-with-fts5.md` |
| How is the assistant stopped from closing a task? | `adr/0006-mcp-capability-map.md` |
| How do backup and merge-only import work? | `adr/0007-backup-export-import.md` |
| Should there be two timers at once? | `DECISIONS.md` (`Q1`) |
| Why is drag-to-move not in 1.0? | `DEFERRED.md` |
| What must be tested before 1.0? | `TESTING.md` §3 |
| How fast must the task list be? | `PERF.md` |
| Is 0.10.0 valid after 0.9.0? | `VERSIONING.md` |
| Can I add this small feature while I am here? | `BACKLOG.md` and `ROADMAP.md` §1.5 rule 8 |

## Conventions used across all documents

- **Requirement IDs** are quoted exactly as in the SRS: `FR-TIME-03`, `DEP-07`, `DATA-10`,
  `MCP-14`, `NFR-PERF-01`, `UI-12`, `BR-04`, `US-07`, `Q3`.
- **Version numbers** are `MAJOR.MINOR.PATCH` with no `v` prefix in prose, and `vX.Y.Z` for
  git tags.
- **Status words** are *not started*, *in progress*, *in review* (owner running the exit
  test), *released*.
- **Dates** are `YYYY-MM-DD`.
- **Relative dates** ("the current release") always mean the value in `PLAN.md`.
