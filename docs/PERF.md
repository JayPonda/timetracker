# Performance

What "fast enough" means for this app, and what has actually been measured. A number that
has not been measured is a target, not a result.

## 1. The budgets, from the SRS

| ID | Budget | Applies to | Release that first depends on it |
| --- | --- | --- | --- |
| `NFR-PERF-01` | Pages load in under **2 s**; start, stop and save respond in under **300 ms** | Everything, on the owner's laptop | 0.3.0 |
| `NFR-PERF-02` | Stay responsive with **5,000 tasks and 100,000 time entries** | Lists, day log, reports, search | 0.8.0 |
| `NFR-PERF-03` | Idle use under **300 MB** memory, negligible CPU | Always | 0.1.0 |
| `NFR-PERF-04` | A reminder shows within **30 s** of its due time while the app is open | Scheduler and SSE | 0.7.0 |
| `FR-SRCH-05` | First page of search results in under **1 s** | Search | 0.8.0 |
| `DEP-06` | `/health` fast enough for a Docker health check interval | Runtime | 0.1.0 |

## 2. How these are measured

| Scenario | Method | Script |
| --- | --- | --- |
| Page load | Navigation timing in the browser, median of 5 runs, cold cache | `pnpm perf` |
| Start, stop, save | Server-side duration of the request, plus the time to the visual confirmation, median of 20 runs | `pnpm perf` |
| List, day log, report | Server-side query duration, first page | `pnpm perf` |
| Search | Server-side query duration for the first page, worst of 20 queries | `pnpm perf` |
| Reminder latency | Time from due time to the SSE frame reaching the browser, measured in the browser | manual, 0.7.0 |
| Idle memory | Container RSS after 10 minutes with no interaction | `docker stats` |
| Database | `EXPLAIN QUERY PLAN` checked for the six hot queries; any full scan on a user-data table is a defect | `pnpm perf --explain` |

The fixture is `seed:perf`: 5,000 tasks, 100,000 time entries, 10,000 todos, 5,000
acceptance criteria, 5,000 closure records, 1,000 reference materials, 20,000 tags on
entries, 500 events and 500 reminders. Deterministic, so a number is comparable to last
week's.

## 3. Results

| Release | Date | Fixture | Scenario | Measured | Budget | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1.0 | — | — | — | — | — | not measured yet |

Filled in as each release is verified. A release that misses a budget either fixes it or
records the miss here with the reason and the user-visible effect — it does not quietly
move on.

## 4. Design choices that exist to protect these budgets

Recorded so the performance work is not repeated by accident later.

- **Totals are SQL views, never stored columns** (`DATA-04`). A view is as fast as the query
  behind it, and cannot drift.
- **Indexes are decided in 0.2.0, with the schema.** Every foreign key is indexed, plus
  `time_entries(started_at)`, `time_entries(ended_at)`,
  `time_entries(ended_at) WHERE ended_at IS NULL`, `activity_log(entity, entity_id, at)`,
  and a partial index excluding archived rows from the common list queries.
- **Lists are paged with a cursor, not an offset.** An offset scan re-reads the skipped rows
  on every page, which is exactly how a 100,000-entry table becomes slow.
- **Day boundaries are computed, not materialised** ([ADR 0004](adr/0004-time-and-duration-model.md)),
  and `v_day_totals` is written once with an index on the day boundary column.
- **The running timer costs one indexed row lookup**, polled every 5 seconds, with local
  ticking in between ([ADR 0003](adr/0003-running-timer-state.md)). No process holds it in
  memory, so polling is cheap and restart-safe.
- **The scheduler tick writes nothing** unless it is actually firing a reminder, so the
  1-second tick does not contend for the write lock.
- **Search is FTS5 over a denormalised document table** ([ADR 0005](adr/0005-search-with-fts5.md)),
  so filters are indexed columns rather than joins.
- **The frontend is a static build** with no runtime framework on the server and no CDN
  round trips, so a page load is one HTML file, one JS bundle and one CSS file.
- **Charts are hand-drawn SVG or canvas.** A charting library is a large dependency for the
  two or three charts this app needs, and the bundle is paid on every page load.

## 5. Known performance risks

| Risk | Where it bites | Mitigation |
| --- | --- | --- |
| Tag filtering across `time_entry_tags` | 0.3.0 | Index `(tag_id, time_entry_id)`; denormalise tag ids onto search documents in 0.8.0 |
| A day log with hundreds of entries | 0.4.0 | Group in SQL, page the entry list within a day, never load a year at once |
| Reports over a multi-year range | 0.9.0 | Require a date range, default to the current month, aggregate in SQL |
| Search index write amplification on bulk edits | 0.8.0 | Batch the index update inside the same transaction; a single task edit touches a handful of chunks |
| SSE connections accumulating | 0.7.0 | One stream per tab, heartbeat every 25 seconds, a hard cap with the oldest dropped |
| Frontend bundle growth across twelve releases | all | No charting or rich-text library; measure bundle size in CI and fail on a large jump |

## 6. What is not optimised, and why

- **No read replica, no cache layer.** One user, one process, one database file. A cache
  would be a second source of truth — the exact thing `DATA-04` exists to prevent.
- **No virtualised lists until measured.** They add complexity and accessibility cost. If
  `seed:perf` shows a long list stuttering, they are added to that list and only that one.
- **No pre-aggregated report tables.** See above; a rollup is a second source of truth.
- **No image optimisation.** The app has almost no images, and `NFR-PRIV-01` means no
  external font or asset service.
