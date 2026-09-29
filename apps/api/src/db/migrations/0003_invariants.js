// Migration 0003_invariants.
//
// The DDL below is the reviewed hand-written SQL, preserved byte-for-byte;
// it is executed inside a native better-sqlite3 transaction so a failure
// rolls back the whole migration and leaves no half schema (DATA-10). The
// down migration is deliberately unsupported: PDM never drops a schema
// object, any more than it deletes a row.

const SQL = `
-- 0004: the invariants the schema alone can enforce.
--
-- Everything here is a constraint rather than application code, and that is the
-- whole point. A rule enforced in a service can be bypassed by the next service
-- someone writes; a rule enforced in the database cannot be bypassed by any
-- process that opens the file, including a migration, a CLI, or a bug (ground
-- rule: "Database invariants enforced by the schema itself").
--
-- Each trigger is named after the requirement it serves, so a failure message
-- names the rule that was broken instead of "constraint failed".

--------------------------------------------------------------------------------
-- DATA-10: no hard delete of user data.
--
-- Thirteen tables. A \`BEFORE DELETE\` trigger on each one, so a DELETE is
-- refused by the database even if the application tries it. There is no
-- \`ON DELETE CASCADE\` anywhere in this schema, because a cascade is a delete
-- that these triggers cannot intercept (ADR 0002).
--
-- The list is enumerated by a test that asserts on the count, so a table added
-- in a later release without a trigger fails the build rather than shipping a
-- hole in the no-delete guarantee.
--
-- Exempt, and deliberately: settings is not in this list because it was given
-- its own trigger in 0002 — it is user data and it is protected, just earlier.
-- The five system tables (schema_migrations, search_documents, reminder_deliveries,
-- mcp_tokens, mcp_audit_log) are not user data and may be deleted. The
-- many-to-many \`time_entry_tags\` has no independent identity and is exempt by ADR.

CREATE TRIGGER IF NOT EXISTS trg_projects_no_delete
BEFORE DELETE ON projects
BEGIN
  SELECT RAISE(ABORT, 'projects are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_no_delete
BEFORE DELETE ON tasks
BEGIN
  SELECT RAISE(ABORT, 'tasks are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_links_no_delete
BEFORE DELETE ON task_links
BEGIN
  SELECT RAISE(ABORT, 'task links are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_todos_no_delete
BEFORE DELETE ON todos
BEGIN
  SELECT RAISE(ABORT, 'todos are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_acceptance_criteria_no_delete
BEFORE DELETE ON acceptance_criteria
BEGIN
  SELECT RAISE(ABORT, 'acceptance criteria are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_closure_records_no_delete
BEFORE DELETE ON closure_records
BEGIN
  SELECT RAISE(ABORT, 'closure records are appended, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_closure_criterion_results_no_delete
BEFORE DELETE ON closure_criterion_results
BEGIN
  SELECT RAISE(ABORT, 'closure criterion results are appended, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_time_entries_no_delete
BEFORE DELETE ON time_entries
BEGIN
  SELECT RAISE(ABORT, 'time entries are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_tags_no_delete
BEFORE DELETE ON tags
BEGIN
  SELECT RAISE(ABORT, 'tags are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_reference_materials_no_delete
BEFORE DELETE ON reference_materials
BEGIN
  SELECT RAISE(ABORT, 'reference materials are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_calendar_events_no_delete
BEFORE DELETE ON calendar_events
BEGIN
  SELECT RAISE(ABORT, 'calendar events are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_reminders_no_delete
BEFORE DELETE ON reminders
BEGIN
  SELECT RAISE(ABORT, 'reminders are archived, never deleted (DATA-10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_activity_log_no_delete
BEFORE DELETE ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'activity log entries are appended, never deleted (DATA-10)');
END;

--------------------------------------------------------------------------------
-- DATA-01 / BR-04: at most 3 links per task.
--
-- Enforced here as well as in the service, and the reason is in the acceptance
-- criteria: a direct SQL insert of a 4th link must be rejected by the database.
-- The service exists to give the owner a clear message; this exists so the rule
-- is true regardless of who is writing.
--
-- The count is of live links, so archiving a link frees a slot. That is the
-- point of archive: it is reversible, and a removed link can come back.
CREATE TRIGGER IF NOT EXISTS trg_task_links_max_three
BEFORE INSERT ON task_links
WHEN (SELECT count(*) FROM task_links
       WHERE task_id = NEW.task_id AND archived_at IS NULL) >= 3
BEGIN
  SELECT RAISE(ABORT, 'a task may have at most 3 links (DATA-01, BR-04)');
END;

--------------------------------------------------------------------------------
-- BR-13: archive is a state, not an erasure, and it is reversible.
--
-- There is nothing to enforce here beyond what the triggers above already do:
-- archiving sets \`archived_at\` and a row with a non-null \`archived_at\` is still a
-- row. The one risk worth guarding is an UPDATE that moves \`archived_at\` onto a
-- row that was never archived, silently un-archiving a deleted-looking entity —
-- so the service is the only writer of that column, and criterion 3 of the exit
-- test proves restore works.

`;

export async function up(knex) {
  const conn = await knex.client.acquireConnection();
  try {
    conn.transaction(() => {
      conn.exec(SQL);
    })();
  } finally {
    await knex.client.releaseConnection(conn);
  }
}

export async function down() {
  throw new Error('PDM migrations are additive only; there is no down migration.');
}
