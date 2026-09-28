# Deferred to after 1.0.0

Everything the SRS lists that is **not** going into 1.0.0, with the reason and the condition
under which it gets reconsidered. Nothing here is forgotten; each item has a trigger.

1.0.0 = every **Must** plus every **Should** except the items listed on this page. Could
items are built only if a release finishes with time to spare, and even then they are added
at the end of a release, never in the middle of one.

---

## 1. Could items from the SRS, deliberately not scheduled

| Requirement | What it is | Why not in 1.0 | Revisit when |
| --- | --- | --- | --- |
| `FR-TODO-07` | Sub-todos, one level deep | A second nesting level changes the todo table, the timeline, the timer picker and the closure gate. The user's stated need is a flat phase list. | The user reports a real task with a genuinely nested step |
| `FR-AC-06` | Named acceptance-criteria templates | `R7` predicts the gate feeling slow; templates are one mitigation, but they are not the mitigation that matters — keyboard flow in the popup is, and that ships in 0.5.0. | `R7` is reported in practice after 0.5.0 |
| `FR-TAG-06` | Bulk add or remove a tag across many entries | Entries are never deleted and tags are never removed, so this is a convenience, not a rule | A task accumulates more than about 50 entries |
| `FR-CAL-09` | Drag to move and resize events in week and day views | The most bug-prone UI in the app. Quick-create by clicking an empty slot already covers the common case (`FR-CAL-08`) | 0.6.0 ships with time to spare |
| `FR-SRCH-07` | Save a search as a named filter | Filters are already shareable as a URL, which covers the real use | The user asks for it |
| `FR-RPT-06` | Dashboard widgets on the home page | The Today page already carries the running timer, hours today, due items and the next event from 0.4.0 | Never, unless the Today page is seen as cluttered |
| `FR-REM-12` | End-of-day review prompt at 18:00 | It is a habit prompt, and `R3` already covers forgotten timers more directly | The user says an end-of-day prompt would help |
| `FR-REF-06` | Attach local files to a reference item | Adds file storage, upload, size limits, a download route and a class of backup problem, for a feature the user has not asked for | The user starts attaching documents by hand |
| `FR-TASK-14` | Duplicate a task with its todos and criteria | Export and import already cover copying between instances, and it is a 30-minute feature once those exist | 0.9.0 finishes early |
| `FR-MAINT` related | Playwright end-to-end suite for every story | Twenty-nine stories in E2E is a maintenance cost out of proportion to a single-user app. A critical-path smoke suite ships at 1.0.0 instead | A second user appears, or a regression slips through twice |
| `MCP-25` | Local semantic search for the second brain | A model, an embedding step on every write, and a lexical-versus-semantic decision, before keyword search is proven. Designed to sit beside FTS5 when it arrives | The user asks for search by meaning and keyword search has been in use a while |
| `MCP-26` | Mark a reference material as important | A ranking tweak, meaningless without semantic search (`MCP-25`) | Along with `MCP-25` |
| `NFR-SEC-05` | Local PIN or password to lock the app | `Q9` puts it out of scope for version 1. The trust boundary is the OS user account | The laptop is shared, or the user works in a shared space |

## 2. Should items under review, with a default position

These are **Should** in the SRS. Each has a default answer so the build is not blocked, and
a trigger for spending the time.

| Requirement | Default for 1.0.0 | Revisit when |
| --- | --- | --- |
| `FR-TIME-08` | **Built in 0.3.1 if 0.3.0 finishes early**, not promised. Pause ends the entry and resume starts a new one; the data model already supports it | The user interrupts work often enough to want it (`OQ-7`) |
| `FR-CAL-03` | **Repeat rules for events, built in 0.6.0** — daily, weekly with chosen weekdays, monthly, with an end date, and an edit prompt offering this one, this and following, or all. This is a real gap for a daily agenda | It becomes the top complaint about the calendar |
| `FR-VIEW-02` | **Board view with drag between Open and In progress, built in 0.5.0.** Dragging to Ended opens the closure gate rather than bypassing it (`FR-STAT-01`) | — |
| `FR-LAG-03` | **Built in 0.9.0** — fulfilled versus not-fulfilled ratio per week, month and project | — |
| `FR-DAY-05` | **Built in 0.4.0** — tasks that changed status that day | — |

## 3. Out of scope for version 1 by the SRS itself (§13.4)

Recorded so nobody re-litigates it. These are product ideas, not gaps in the plan.

Calendar sync with Google or Outlook · import from Clockify, Jira or GitHub · task
dependencies · Pomodoro mode · idle detection · mobile view · weekly email or PDF report ·
multi-user with login.

## 4. Known gaps accepted for 1.0.0

Honest limitations, stated so nobody discovers them at 1.0.0 and thinks they are bugs.

| Gap | Consequence | Why accepted |
| --- | --- | --- |
| A reminder needs the app running and a tab or window open | Missed reminders wait for the next open and appear in the Missed tab | `R2`. `DEP-04` restarts the container after a reboot, but a browser notification needs a browser. An operating-system notification from the container is deliberately not built: it would need a host-level notifier, which is exactly the host intrusion `C1` forbids |
| Backups are daily, not continuous | Up to 24 hours of work is not in the last backup | A crash inside a single user's day is rare, and hourly backups add no schema work — the count is a setting, so this is a one-line change if wanted |
| The day view is not the primary data-entry surface | Work done without a timer must be added manually | That is the product's premise: the timer is the fast path |
| `score` and `estimate` are typed by hand and go stale | Over-run figures are only as good as the estimate | Both are optional and reports only include tasks where they are set, which is the honest treatment of a manual estimate |
| No multi-user isolation | The app is single-user by construction | §1.4, `Q9`. The capability map in [ADR 0006](adr/0006-mcp-capability-map.md) keeps a future auth layer to one small change |
| Compressed backups | 14 copies of the database file rather than 14 archives | A restore procedure that is four commands a user can follow is worth more than a smaller backup directory |

## 5. How to use this file

When a deferred item comes up — in conversation, during a release, in a bug report — do one
of three things:

1. **Move it in.** Write the release spec change, note the new acceptance criteria, and
   update the traceability table in [`ROADMAP.md`](ROADMAP.md) §4.
2. **Keep it deferred, with a better reason.** Rewrite the row so the trigger is concrete.
3. **Drop it.** Say so here with the reason, so it stops resurfacing.

A deferred item is never silently re-raised as a new idea.
