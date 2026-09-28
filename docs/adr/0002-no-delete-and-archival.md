# ADR 0002: How "nothing is ever deleted" is enforced

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `DATA-05`, `DATA-09`, `DATA-10`, `DATA-11`, `DATA-12`, `BR-13`, `BR-16`,
  `FR-TAG-05`, `FR-TASK-13`, `FR-PRJ-04`, `UI-04`, `UI-06`, `UI-17`; release 0.2.0

## Context

`DATA-09` says the application and its API must have **no delete operation** for user
data; removal means setting `archived_at`. `DATA-10` goes further and says the database
must block hard deletes, with no cascading deletes and a rule that refuses `DELETE`, so
that a bug cannot erase data. `DATA-11` defines what archived means for visibility.
`BR-13` repeats it as a business rule.

This is the right instinct. The database is the only copy of this user's work history, and
the container plus the host folder is the only place it exists. But taken literally, the
requirement has three parts that can conflict with the system itself.

**Archival needs a timestamp, not a boolean.** `FR-STAT-05` wants a history of status
changes, and "archived yesterday" is different from "archived". So the column is
`archived_at` (nullable timestamp), never `archived`.

**Some tables hold no user data.** The search index, the reminder delivery ledger, the
migration log and the MCP audit log are derived or bookkeeping. The search index must be
deletable — a rebuild is defined as emptying and re-inserting it. Blocking `DELETE` on it
would make the documented recovery procedure impossible.

**Cascading deletes are a trap, not a safety net.** They make data disappear as a
side effect of an unrelated operation, which is precisely the failure the requirement is
trying to prevent. Foreign keys are kept for integrity, and removals are always explicit.

## Decision

**Thirteen user-data tables, each carrying `uid` and `archived_at`.** These are the 15
entities of SRS §9.1 minus `settings` and `activity_log`:

`projects`, `tasks`, `task_links`, `todos`, `acceptance_criteria`, `closure_records`,
`closure_criterion_results`, `time_entries`, `tags`, `time_entry_tags`, `reference_materials`,
`calendar_events`, `reminders`.

*(The list lives in one exported constant and the trigger set is generated from it, so the
constant and the triggers can never drift apart. A test enumerates all thirteen.)*

**Each of them gets a trigger that aborts `DELETE`:**

```sql
CREATE TRIGGER trg_tasks_no_delete
BEFORE DELETE ON tasks
BEGIN
  SELECT RAISE(ABORT, 'PDM: hard delete is not allowed; set archived_at instead');
END;
```

**Exempt tables**, named explicitly here and in the test: `settings`, `schema_migrations`,
`search_documents`, `reminder_deliveries`, `mcp_tokens`, `mcp_audit_log`, and the FTS5
shadow tables. `reminder_deliveries` and `mcp_audit_log` are append-only by convention
and are trimmed by retention, not by user action.

**No `ON DELETE CASCADE` anywhere.** `PRAGMA foreign_keys=ON` on every connection. A
child row therefore cannot disappear because its parent did — and it cannot, because the
parent cannot disappear either. Archiving keeps the whole graph intact and queryable.

**The service layer is the only writer.** Every removal is a function like
`archiveTask(taskId, reason)`, which sets `archived_at`, writes an `ActivityLog` row, and
refuses to act on an already-archived row. There is no `delete*` function in the codebase,
and a test greps the service exports to keep it that way.

**The API exposes no `DELETE` route for user data.** Routes are declared explicitly, so a
delete route cannot appear by accident; a test walks the route table and fails if any
`DELETE` method targets a user-data path.

**Archive is reversible in one click.** Every list that can contain archived items has a
*Show archived* toggle and a *Restore* action. Restoring clears `archived_at` and records
the event in the activity log.

**Nothing is hidden silently.** Where archived items are excluded from a total, the
excluded amount is displayed (`DATA-12`). Archiving a time entry, todo or reminder shows an
*Undo* toast for 10 seconds (`UI-06`) — an undo is a restore, never a delete.

**Bulk operations reuse the single-item functions.** There is no "archive many" SQL. A
bulk action loops the same service call inside one transaction, so a rule can never be
skipped for speed.

**Migrations are the one place tables are rebuilt.** A migration that needs a new table
shape creates a new table, copies rows, and drops the old one. The `DROP` is allowed
because the migration runner runs with triggers temporarily suspended, and every
pre-migration state is backed up first (`DEP-09`). This is the only path by which rows can
leave the database, and it is logged.

## Consequences

Easy: history is always complete and always queryable; a mistake is one click to undo; the
closure record, its criterion snapshots and the entries stay linked forever; the user's
history cannot be destroyed by a bug, a bad import or a mistaken bulk action.

Hard: database size grows monotonically. On the order of a few thousand tasks and tens of
thousands of entries over years this is irrelevant, and the online backup plus the export
keep it portable.

Hard: a query that forgets `archived_at IS NULL` will show archived items. This is handled
by having the totals and list views live in SQL views that filter, and by a lint-style
review rule that any new query touching a user-data table is checked for the filter.

Accepted: a very large `DELETE` inside a migration is possible. It is bounded by the
pre-migration backup and is recorded in the migration log.

## Alternatives considered

**A soft-delete flag plus a `deleted_at` filter in the ORM only.** Rejected: it relies on
every future query remembering a filter, and `DATA-10` explicitly asks for a database-level
rule.

**Database triggers on all tables, including derived ones.** Rejected: it makes the search
index un-rebuildable, which converts a recoverable drift bug into a manual data-recovery
incident.

**Cascading deletes with soft-delete on the parent.** Rejected: cascades destroy children,
which for this product means destroying time entries and closure snapshots.

**A full event-sourcing log instead of archive columns.** Attractive and genuinely
append-only, but it triples the read complexity for a single-user app and puts the
`NFR-PERF-01` budget at risk for no benefit the archive columns do not already give.

**Letting the user delete, but only after an export.** Rejected: `DATA-09` and `BR-13` are
unambiguous, and a delete button is the fastest way to lose work by accident.
