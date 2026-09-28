# ADR 0004: Timestamps, durations, time zones and midnight splitting

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `DATA-04`, `DATA-07`, `FR-TIME-11`, `FR-TIME-17`, `FR-TIME-18`,
  `FR-DAY-01`, `FR-CAL-11`, `NFR-TIME-01`, `NFR-TIME-01`, `DEP-05`; releases 0.2.0–0.4.0

## Context

`NFR-TIME-01` requires time to be stored in UTC and shown in the configured time zone, with
daylight-saving changes unable to corrupt durations. `DEP-05` sets `TZ` from the
environment. `A2` says the user works in one time zone and the laptop clock is the source
of time. `DATA-07` requires durations in whole seconds. `FR-TIME-18` requires `HH:MM`
display, optionally decimal hours. `FR-CAL-11` makes the week start configurable.

The SRS also contains a genuine internal conflict, recorded as S3 in the roadmap:
`DATA-04` says a task's total is the sum of its entries, and `FR-TIME-17` says an entry
crossing midnight is one entry but is split by day in daily reports. Those two rules
disagree about the same entry unless the unit of summation is defined.

## Decision

**Storage.** Every timestamp is an `INTEGER` of **epoch milliseconds**, interpreted as UTC.
No local-time strings, no SQLite `datetime('now','localtime')` defaults anywhere, and no
SQLite date functions in the storage path. `date`, `created_at`, `updated_at`,
`archived_at`, `started_at`, `ended_at`, `done_at`, `closed_at`, `remind_at`,
`fired_at`, `planned_start`, `due_date` are all epoch milliseconds.

**Application clock.** The API reads the clock through one function, `nowMs()`, so tests
can freeze it. Nothing else in the codebase calls `Date.now()` directly.

**Durations.** `duration_seconds INTEGER` is written when an entry closes, as
`(ended_at - started_at) / 1000`, rounded to the nearest second. It is a cache, not the
truth; every total is computed from the timestamps, so DST changes cannot corrupt a
duration (`NFR-TIME-01`). A test asserts the stored value always equals the computed one.

**Rendering.** All formatting happens in the browser using `Intl.DateTimeFormat` with
`timeZone` taken from the app's settings, so the displayed zone follows `TZ` and the user's
Settings choice without a server round trip. `HH:MM` is the default display; decimal hours
are a per-user toggle (`FR-TIME-18`).

**Day boundaries** are computed server-side by one helper,
`startOfDayMs(epochMs, timeZone)`, built on `Intl.DateTimeFormat` with `formatToParts` to
find the zone's offset for that instant. About forty lines, no dependency, and unit-tested
against real DST transitions in `Asia/Kolkata`, `Europe/London` and `America/New_York`.
Using `Intl` rather than a date library means the zone rules come from the platform's
IANA database rather than a bundled copy that goes stale.

**S3 resolved — two different sums, named explicitly:**

| Figure | Rule |
| --- | --- |
| **Task total**, **project total**, **tag total** | The full entry. `SUM(duration_seconds)`. Never split. |
| **Day total** | The sum of each entry's **overlap** with that local day. An entry from 23:30 to 00:30 contributes 30 minutes to each of the two days, and 60 minutes to its task. |

A midnight-crossing entry stays **one row** in `time_entries` (`FR-TIME-17`). The split
exists only in the day-total view `v_day_totals`, computed with SQL over
`started_at`/`ended_at` and the day boundary. It is never materialised, so there is nothing
to keep in sync.

**Week boundaries** use the same helper with the configured week start, Monday by default
and Sunday as a setting (`FR-CAL-11`). Weeks are Monday-to-Sunday by default because
`Q3` sets Monday-to-Friday as the working week.

**A date without a time** — a task due date, an all-day event — is stored as the epoch
milliseconds of local midnight on that date. An all-day event is rendered from the
`all_day` flag, not from its timestamps, so a DST shift cannot move it.

**Search and sorting** on dates use the epoch column, so they are index-friendly and never
depend on string formatting.

## Consequences

Easy: durations are immune to DST because they are plain subtraction of UTC instants. Day
and week grouping is one helper with unit tests rather than scattered offset arithmetic.
Timestamps are directly comparable and indexable.

Hard: no SQL date function can be used for correctness, so anything that looks like
"group by day" has to be written in terms of the computed day boundary. `v_day_totals` is
therefore written once, carefully, with a DST test.

Hard: a date-only value and an instant are both epoch milliseconds, so the schema comment
must be explicit about which is which. Each such column is documented in the migration
that creates it.

Accepted: a laptop whose `TZ` is wrong shows day boundaries shifted. This is visible in the
top bar and in the Today page, and the Settings screen shows the resolved zone.

## Alternatives considered

**Store ISO-8601 UTC strings.** Readable in a hex editor, which is genuinely nice for a
local-first app, but it makes every comparison and range query a string comparison, breaks
`ON CONFLICT` handling of instants, and complicates arithmetic. Rejected on query
performance at the `NFR-PERF-02` volume.

**Use SQLite's built-in date functions with `TZ` set on the connection.** Convenient until a
date range crosses a DST boundary or the user's `TZ` differs from the container's. Rejected:
the correctness of the whole day-total model would then depend on an environment variable.

**A date library such as Luxon or date-fns-tz.** Reliable and short, but adds a dependency
and a second, potentially divergent, copy of the IANA rules. `Intl` is already correct and
already present. Rejected in favour of one small tested helper, per principle 5 in the
roadmap.

**Materialising per-day totals into a table for report speed.** Rejected: it is a second
source of truth that `DATA-04` exists to prevent, and the volume does not need it.
