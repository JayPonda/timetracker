# Decisions

Every judgement call that would otherwise be made silently, recorded once. The SRS left 15
open questions (`Q1`…`Q15`); all 15 are answered here so the build is never blocked waiting
for an answer. Where an answer changes something already written, the affected document is
named.

| # | Question | Decision | Affects | Date |
| --- | --- | --- | --- | --- |
| `Q1` | Should two timers be allowed to run at once? | **No. One at a time**, enforced by a partial unique index in the database, not only in the interface. Starting another saves the running entry first. | `BR-01`, `FR-TIME-04`, [ADR 0003](adr/0003-running-timer-state.md) | 2026-09-28 |
| `Q2` | What does the score mean, and on what scale? | **A free number with an optional scale label set in Settings** — story points, 1 to 10, or priority. Score is nullable; the app never interprets it, it only sorts by it and totals it. | `FR-TASK-06`, `FR-RPT-03` | 2026-09-28 |
| `Q3` | What are the working hours and days for the hourly reminder? | **09:00 to 18:00, Monday to Friday**, configurable in Settings, pausable for today. | `FR-REM-05`, `FR-REM-08`, `BR-12` | 2026-09-28 |
| `Q4` | Must the hourly reminder ring at exactly :00 or at another minute? | **At :00 by default**, with a configurable minute offset in Settings, because a round number competes with every other notification the laptop gives. | `FR-REM-05` | 2026-09-28 |
| `Q5` | Which backend language? | **Node.js with TypeScript and SQLite**, as the SRS proposes. Fastify, Drizzle ORM, better-sqlite3. | [ADR 0001](adr/0001-stack-and-deployment.md) | 2026-09-28 |
| `Q6` | Should an Ended task allow adding manual time later? | **Yes, with a visible warning.** This is the common correction case, and blocking it would push the user to reopen a task just to record ten minutes. The entry is marked as a post-closure correction. | `BR-09`, `FR-STAT-03` | 2026-09-28 |
| `Q7` | Do you want acceptance-criteria templates? | **Deferred as Could** (`FR-AC-06`). A named set of criteria applied when creating a task. Revisit if `R7` — the gate feeling slow — is reported after 0.5.0 ships. | `FR-AC-06`, `R7`, [`DEFERRED.md`](DEFERRED.md) | 2026-09-28 |
| `Q8` | What format does the office timesheet need? | `Task — HH:MM — description`, one per line, grouped by task with its total, then a day total line. The format is a setting with this as the default, so a different office format is a text change, not a code change. | `FR-DAY-03` | 2026-09-28 |
| `Q9` | Should a local password protect the app? | **No in version 1**, as the SRS assumes. The trust boundary is the OS user account on a loopback-only app. MCP has its own bearer token, which is the only secret in the system. | `NFR-SEC-05` | 2026-09-28 |
| `Q10` | Which MCP clients will be used? | **Any client supporting Streamable HTTP or stdio** — Claude Desktop and Claude Code named in the SRS. The README provides copy-ready configuration for both plus a generic client. | `MCP-06`, `MCP-07` | 2026-09-28 |
| `Q11` | May the assistant add todos or acceptance criteria to an existing task? | **No.** That is an update to a task, which the boundary forbids. They may be supplied only at creation, in the same call. | `MCP-15`, `Q11`, `MCP-13` | 2026-09-28 |
| `Q12` | May the assistant create tags on the fly? | **Yes, create only.** Tag creation is low-risk, reduces typing, and a tag can be archived by the user at any time. | `MCP-09`, `Q12` | 2026-09-28 |
| `Q13` | Do you want semantic search later? | **Keyword search first.** Semantic search stays an optional, local, later addition beside FTS5 rather than a replacement for it. | `MCP-25`, `FR-SRCH`, [ADR 0005](adr/0005-search-with-fts5.md) | 2026-09-28 |
| `Q14` | Is removing old backup files acceptable, since that deletes files? | **Yes.** Only backup copies rotate. The retention code refuses to delete any file in `./backups` that does not match the backup naming pattern, so the folder is never a general delete path. | `DEP-07`, [ADR 0007](adr/0007-backup-export-import.md) | 2026-09-28 |
| `Q15` | May the owner restore an archived item? | **Yes, by the user only.** One click from any list, with the action recorded in the activity log. The assistant has no route that can restore or archive anything. | `DATA-11`, `BR-13`, `MCP-15` | 2026-09-28 |

## Decisions taken while planning, not asked by the SRS

These came out of analysing the SRS rather than out of it. Each one resolves a conflict or
a gap, and each is written up as an ADR or a roadmap finding.

| # | Decision | Why | Recorded in |
| --- | --- | --- | --- |
| `D-1` | A task may have **no** project; `project_id` is nullable and "No project" is a virtual bucket, not a row. | One less row to keep consistent, and it makes "unassigned" unambiguous | Roadmap §8, release 0.2.0 |
| `D-2` | `status` is a database-level enum of `open`, `in_progress`, `ended`. | `DATA-03` makes the status and the closure record interdependent; a constraint keeps them from drifting | Release 0.2.0 |
| `D-3` | Every user-data row carries `uid` (UUIDv7) and `archived_at` from the first migration. | Required for merge-only import (`DATA-13`) and cheap now, expensive later | [ADR 0007](adr/0007-backup-export-import.md) |
| `D-4` | Timestamps are epoch-millisecond integers in UTC; durations are whole seconds; day boundaries are computed in `TZ`. | `NFR-TIME-01`, `DATA-07`; resolves S3 | [ADR 0004](adr/0004-time-and-duration-model.md) |
| `D-5` | A running timer is a `time_entries` row with a null end, and elapsed time is always derived. | `FR-TIME-06`, `FR-TIME-10`, `DATA-02`, `A2` | [ADR 0003](adr/0003-running-timer-state.md) |
| `D-6` | Archiving a task or project with a running timer stops and saves the entry first. | Closes gap S4: `FR-TASK-13` does not cover a live timer | [ADR 0003](adr/0003-running-timer-state.md) |
| `D-7` | A running entry allows todo, tag and note edits, but not `started_at` or `ended_at`. | Resolves gap S4: `FR-TIME-02` permits some edits, `FR-TIME-15` does not say which | [ADR 0003](adr/0003-running-timer-state.md) |
| `D-8` | The app binds `0.0.0.0` inside the container; the published port on `127.0.0.1` is the boundary. | Resolves conflict S1 between `DEP-02`/`NFR-SEC-01` and `MCP-01` | [ADR 0001](adr/0001-stack-and-deployment.md) |
| `D-9` | The in-app popup is the primary reminder channel; the browser notification is an enhancement; sound is generated with WebAudio. | `C4` names browser notifications as the channel, but a blocked permission must not lose a reminder; no asset file also means no CDN | Release 0.7.0 |
| `D-10` | Deletion is blocked by database triggers on 13 user-data tables, with a named exemption list for derived tables. | Resolves conflict S2 between `DATA-10` and a rebuildable search index | [ADR 0002](adr/0002-no-delete-and-archival.md) |
| `D-11` | Every API route declares capabilities; a principal's capabilities are checked with default deny. | Makes `MCP-14` enforceable in the app rather than in the MCP container | [ADR 0006](adr/0006-mcp-capability-map.md) |
| `D-12` | The reminder fire ledger has a unique key of `(reminder_id, occurrence_at)`. | Turns `FR-REM-10` into a database constraint rather than application logic | Release 0.7.0 |
| `D-13` | The MCP database is not mounted into the MCP container, so the assistant has no path to the file. | Enforces `MCP-03` structurally, not by convention | [ADR 0006](adr/0006-mcp-capability-map.md) |
| `D-14` | Search is FTS5 over one denormalised document table, written by the service layer, with a rebuild command. | Resolves gap S6: `FR-SRCH-05` is unreachable with `LIKE` at `NFR-PERF-02` volume | [ADR 0005](adr/0005-search-with-fts5.md) |
| `D-15` | Reminder sounds are synthesised in the browser, so there is no static audio asset. | Keeps `NFR-PRIV-01` absolute: not even a CDN for a sound file | Release 0.7.0 |
| `D-16` | An import skips rows with a null `ended_at`, so it can never introduce a second running timer. | Keeps the one-open-entry invariant of `DATA-02` intact across an import | [ADR 0007](adr/0007-backup-export-import.md) |
| `D-17` | A task's total and a day's total are two differently-named sums of the same entries, defined once. | Resolves conflict S3 between `DATA-04` and `FR-TIME-17` | [ADR 0004](adr/0004-time-and-duration-model.md) |
| `D-18` | Navigation for unbuilt features is visible but disabled, with the release named. | A 0.1.0 shell that looks like 1.0.0 trains the owner to expect features that do not exist | Release 0.1.0 |
| `D-19` | Version numbering continues past 0.9.0 as 0.10.0 and 0.11.0. | Correct semver; a patch bump for a feature release would be wrong | [`../VERSIONING.md`](../VERSIONING.md), `OQ-2` |
| `D-20` | The product is Personal Day Manager (PDM) in the UI and docs; repository and container names are unchanged. | Resolves S9; renaming the repository is the owner's call, not the build's | Roadmap §8, `OQ-6` |

## How a decision gets changed

1. Write the new decision here with today's date and the reason.
2. If it contradicts an existing decision, mark the old row **superseded by** and keep it.
3. If an ADR governs it, add a new ADR that supersedes the old one, and update
   [`adr/README.md`](adr/README.md).
4. If code has already shipped on the old decision, add a migration and note it in
   `CHANGELOG.md`.
