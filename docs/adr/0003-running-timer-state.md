# ADR 0003: The running timer is a database row, not application state

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `FR-TIME-03`, `FR-TIME-04`, `FR-TIME-06`, `FR-TIME-07`, `FR-TIME-09`,
  `FR-TIME-10`, `BR-01`, `BR-08`, `DATA-02`, `DATA-04`, `DATA-07`, `NFR-REL-02`,
  `NFR-TIME-01`, `R3`; release 0.3.0

## Context

`FR-TIME-06` is the requirement that shapes the whole time subsystem: a running timer must
survive a page refresh, the browser closing, and the container restarting, because the
start time is stored in the database rather than in the browser. `FR-TIME-10` adds that
after a crash the user must see the true elapsed time and be able to stop at now or at a
chosen earlier time. `DATA-02` says at most one time entry may have an empty end time at
any moment. `BR-01` says only one timer runs at a time.

`A2` states the laptop clock is the source of time. So elapsed time is
`now - started_at` computed at read time, never accumulated by a tick. A laptop that
sleeps for an hour produces one hour of elapsed time, which is correct.

Two things in the SRS are not specified and must be decided here:

**S4, part one:** what happens to a running timer when its task is archived
(`FR-TASK-13` says an archived task cannot run a timer, but says nothing about a timer
that is already running)?

**S4, part two:** `FR-TIME-15` says any entry can be edited, but `FR-TIME-02` says the
todo and tags can be changed while the timer runs. So a running entry is editable in some
fields. Which ones?

## Decision

**A running timer is a `time_entries` row with `started_at` set and `ended_at IS NULL`.**
There is no in-memory timer, no session variable, no browser state, and no separate
"current task" row. The database is the single source of truth.

**At most one, enforced by the database:**

```sql
CREATE UNIQUE INDEX idx_time_entries_single_open
  ON time_entries ((1)) WHERE ended_at IS NULL;
```

A second concurrent `start` therefore fails with a constraint violation, which the service
translates into the confirmation flow of `FR-TIME-04` rather than a raw error. The
invariant cannot be broken by a race, a retry or a bug.

**Elapsed time is always derived.** `now - started_at`, rendered as `HH:MM:SS` in the top
bar. Nothing is written while a timer runs, so nothing can drift. The browser ticks
locally for a smooth clock and re-syncs from the server every 60 seconds, on window focus
and on reconnect; the server value always wins. A clock jump on the laptop changes the
elapsed display exactly as a real clock would, which is the intended behaviour under `A2`.

**Starting on an Open task moves it to In progress in the same transaction**
(`FR-TIME-07`, `BR-08`), together with the `activity_log` row for `FR-STAT-05`.

**`startTimer` never silently discards work.** If an entry is already open, the service
returns the running entry and the route presents the confirmation dialog naming the
running task. With the "always switch automatically" setting, the service closes the open
entry at the current instant and opens the new one — both inside one transaction, so a
crash between them cannot lose either (`DATA-08`).

**A running entry may be edited only in `todo_id`, `tags` and `note`** (`FR-TIME-02`).
`started_at` and `ended_at` are not editable on an open entry, because an open entry's
start time *is* the timer. The service rejects those fields with a clear message telling
the user to stop the timer first.

**Archiving a task, project or todo with a running timer stops and saves the entry
first**, inside the same transaction as the archive. A running timer is never left
pointing at an archived parent. If the running timer belongs to a *different* task, the
archive proceeds and that timer keeps running.

**Stopping at a chosen earlier time** (`FR-TIME-10`) sets `ended_at` to the chosen instant
instead of now, which is why `ended_at` must never be "now" by construction.

**Duration is derived, not stored as truth.** `duration_seconds` is written when the entry
closes as `(ended_at - started_at)/1000` so reports do not have to subtract, but every
total reads from the timestamps. `DATA-04` requires totals to be computed from entries;
`DATA-07` requires whole seconds. A test asserts the stored duration always equals the
computed one, so a bug in either place is caught immediately.

**Forgotten timers** (`FR-TIME-09`, `R3`) are detected by a cheap query, not a scheduler:
any open entry older than the configured limit surfaces a prompt on the next poll. The
prompt offers Keep running, Stop now and Stop at a chosen time (`UI-05`), and is
dismissible — it never ends a timer by itself.

**No background job is needed to keep a timer running.** The scheduler only exists for
reminders. If the container is down for two hours, the timer is still open when it comes
back, with the correct elapsed time.

## Consequences

Easy: restart safety is free. Multi-tab consistency is free — every tab reads the same
row. The one-timer rule cannot be violated. The task's "In progress" state cannot disagree
with the timer. No polling of any background process is needed for correctness.

Hard: reading the timer costs a query, so the frontend polls roughly every 5 seconds for
the authoritative value and ticks locally between polls. On a 5,000-task database this is a
single indexed row lookup and is not a concern.

Hard: "one open entry" is a partial index, which SQLite supports but which cannot be
expressed portably. That is accepted, because the database is fixed by `DEP-03`.

Accepted: an open entry with a `started_at` in the future — a laptop clock change backwards
— would show a negative elapsed time. The UI clamps at zero and the top bar flags the
anomaly instead of hiding it.

## Alternatives considered

**A `runtime_state` key-value row holding "current task id and started at".** Rejected: a
second source of truth that can disagree with `time_entries`, and it forces the entry to be
created on stop, which loses the entry entirely if the container dies mid-work — exactly
what `FR-TIME-06` forbids.

**A server-side ticker that writes elapsed seconds every second.** Rejected: 86,400 writes
a day for no information, guaranteed drift, and it breaks under `A2` when the laptop sleeps.

**A background job in a separate container to keep the timer alive.** Rejected: the timer
needs no process to stay alive. It is a timestamp.

**Trusting the browser to hold the start time and reconcile on reload.** Rejected directly
by `FR-TIME-06`; it also fails when two tabs disagree.
