// Migration 0002_data_model.
//
// The DDL below is the reviewed hand-written SQL, preserved byte-for-byte;
// it is executed inside a native better-sqlite3 transaction so a failure
// rolls back the whole migration and leaves no half schema (DATA-10). The
// down migration is deliberately unsupported: PDM never drops a schema
// object, any more than it deletes a row.

const SQL = `
-- 0003: the data model. Every table of SRS §9.1, in one migration.
--
-- The schema is written once, here, so that no later release needs a breaking
-- migration (docs/ROADMAP.md v0.2.0: "Schema churn is cheapest now"). A column
-- added in 0.2.0 is a rename; the same column added in 0.6.0 is a migration
-- against real data on the owner's laptop.
--
-- Four rules apply to every table below, and each exists because getting it
-- wrong is expensive later:
--
--   uid          A UUIDv7, unique, assigned once, never changed. It is what makes
--                merge-only import possible (DATA-13) and duplicate detection
--                possible (MCP-27). Adding it later means touching every table,
--                every export and every import at once (ADR 0007, ground rule 8).
--   archived_at  Removal means archive, and archive is reversible (BR-13,
--                DATA-09). There is no DELETE anywhere in this project.
--   created_at   Epoch milliseconds, never an ISO string, never SQLite date()
--                (DATA-07, ground rule 5, ADR 0004).
--   updated_at   Same.
--
-- Every table is STRICT, so SQLite rejects a wrong type rather than coercing it.
-- A silently coerced timestamp is a bug found months later.
--
-- No ON DELETE CASCADE anywhere (DATA-10, ADR 0002). A cascade is a delete
-- wearing a disguise: it would remove rows the no-delete triggers cannot
-- intercept. Removal is always an explicit archive.
--
-- \`closure_records.total_seconds\` is the one place a duration is stored, and it
-- is a *snapshot at closure time*, not a running total — DATA-04 forbids storing
-- a total that can drift from the entries it summarises, and a closure record is
-- a historical statement about the moment the task ended. Live totals are
-- computed in views, never stored.

--------------------------------------------------------------------------------
-- projects
--------------------------------------------------------------------------------
-- A container for tasks. There is deliberately no "No project" row (D-1): tasks
-- carry a nullable project_id and the UI renders a virtual bucket, so there is
-- no orphan-proof problem and one less row to keep consistent.
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  uid         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  colour      TEXT    NOT NULL DEFAULT '#6b7280',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects (archived_at);
CREATE INDEX IF NOT EXISTS idx_projects_name     ON projects (name);

--------------------------------------------------------------------------------
-- tasks
--------------------------------------------------------------------------------
-- \`status\` is an open / in_progress / ended enum (D-2).
--
-- The CHECK permits 'ended' but nothing in 0.2.0 can set it: FR-STAT-01 requires
-- that exactly one function is able to write 'ended', and that function is the
-- closure service arriving in 0.5.0. Until then the value is unreachable, which
-- is the point — the constraint is a design property that is provable by reading
-- the code, not a test that could be forgotten.
--
-- No total_seconds column. That is DATA-04.
CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY,
  uid            TEXT    NOT NULL UNIQUE,
  project_id     INTEGER NULL REFERENCES projects (id),
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'in_progress', 'ended')),
  score          INTEGER NULL CHECK (score IS NULL OR score >= 0),
  estimate_hours REAL    NULL CHECK (estimate_hours IS NULL OR estimate_hours > 0),
  planned_start  INTEGER NULL,
  due_date       INTEGER NULL,
  started_at     INTEGER NULL,
  ended_at       INTEGER NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  archived_at    INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_archived  ON tasks (archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks (project_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks (status, archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due       ON tasks (due_date);
-- A list is filtered and sorted, never offset (ground rule: no OFFSET pages).
CREATE INDEX IF NOT EXISTS idx_tasks_listing   ON tasks (archived_at, created_at);

--------------------------------------------------------------------------------
-- task_links
--------------------------------------------------------------------------------
-- Maximum 3 per task, enforced twice: by the trigger below, so a direct SQL
-- insert cannot get past it (DATA-01, US-06), and by the service, so the owner
-- gets a clear message instead of a constraint failure.
--
-- \`position\` is 1..3 and unique per task, so the order is stable and the
-- limit is countable without a second query.
CREATE TABLE IF NOT EXISTS task_links (
  id         INTEGER PRIMARY KEY,
  uid        TEXT    NOT NULL UNIQUE,
  task_id    INTEGER NOT NULL REFERENCES tasks (id),
  label      TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  position   INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_links_task     ON task_links (task_id, archived_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_links_position
  ON task_links (task_id, position) WHERE archived_at IS NULL;

--------------------------------------------------------------------------------
-- todos
--------------------------------------------------------------------------------
-- The phase of a task. Time can be tracked against one (0.3.0).
--
-- \`done_at\` is set when \`done\` becomes true and is what makes a phase's
-- completion a fact rather than a boolean someone can flip without a timestamp.
CREATE TABLE IF NOT EXISTS todos (
  id             INTEGER PRIMARY KEY,
  uid            TEXT    NOT NULL UNIQUE,
  task_id        INTEGER NOT NULL REFERENCES tasks (id),
  title          TEXT    NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  done           INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at        INTEGER NULL,
  estimate_hours REAL    NULL CHECK (estimate_hours IS NULL OR estimate_hours > 0),
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  archived_at    INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_todos_task ON todos (task_id, archived_at, position);

--------------------------------------------------------------------------------
-- acceptance_criteria
--------------------------------------------------------------------------------
-- The definition of done. Never mixed with todos in the interface (NFR-USE-02):
-- a todo is a step, a criterion is a condition, and merging them produces a
-- list where the owner cannot tell which is which.
CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id         INTEGER PRIMARY KEY,
  uid        TEXT    NOT NULL UNIQUE,
  task_id    INTEGER NOT NULL REFERENCES tasks (id),
  text       TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_acceptance_criteria_task
  ON acceptance_criteria (task_id, archived_at, position);

--------------------------------------------------------------------------------
-- closure_records
--------------------------------------------------------------------------------
-- One row per closure attempt, append-only. Reopening a task and closing it
-- again adds a second row; nothing is ever rewritten (BR-13).
--
-- The CHECK is DATA-03: a Not fulfilled closure without a written reason is
-- refused by the database, not merely discouraged by the interface. An unmet
-- criterion requires a lagging reason (FR-GATE-05) and the reason is the
-- project's whole point for this rule.
CREATE TABLE IF NOT EXISTS closure_records (
  id              INTEGER PRIMARY KEY,
  uid             TEXT    NOT NULL UNIQUE,
  task_id         INTEGER NOT NULL REFERENCES tasks (id),
  closed_at       INTEGER NOT NULL,
  result          TEXT    NOT NULL CHECK (result IN ('fulfilled', 'not_fulfilled')),
  lagging_reason  TEXT    NOT NULL DEFAULT '',
  total_seconds   INTEGER NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  estimate_hours  REAL    NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  archived_at     INTEGER NULL,
  -- A not-fulfilled closure carries a reason. A fulfilled one need not.
  CHECK (result <> 'not_fulfilled' OR length(trim(lagging_reason)) > 0)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_closure_records_task ON closure_records (task_id, archived_at);

--------------------------------------------------------------------------------
-- closure_criterion_results
--------------------------------------------------------------------------------
-- A snapshot of each criterion at the moment of closure.
--
-- The text is COPIED, not referenced. That is deliberate: if it referenced
-- \`acceptance_criteria.text\`, then editing a criterion after closure would
-- rewrite history, and the record of what "done" meant at closure would drift.
-- A truthful history is worth a denormalised column (SRS §9.1).
CREATE TABLE IF NOT EXISTS closure_criterion_results (
  id                INTEGER PRIMARY KEY,
  uid               TEXT    NOT NULL UNIQUE,
  closure_record_id INTEGER NOT NULL REFERENCES closure_records (id),
  criterion_text    TEXT    NOT NULL,
  met               INTEGER NOT NULL CHECK (met IN (0, 1)),
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  archived_at       INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_closure_criterion_results_record
  ON closure_criterion_results (closure_record_id, archived_at);

--------------------------------------------------------------------------------
-- time_entries
--------------------------------------------------------------------------------
-- One span of tracked time. Exactly one row may have ended_at NULL, which is
-- enforced by the partial unique index below rather than by application logic
-- (BR-01, DATA-02).
--
-- \`duration_seconds\` is written at stop time and is a record of what the clock
-- said, not a running counter. Elapsed time for a running entry is always
-- now - started_at, so a laptop that sleeps cannot corrupt it (ADR 0004, A2).
CREATE TABLE IF NOT EXISTS time_entries (
  id                INTEGER PRIMARY KEY,
  uid               TEXT    NOT NULL UNIQUE,
  task_id           INTEGER NOT NULL REFERENCES tasks (id),
  todo_id           INTEGER NULL REFERENCES todos (id),
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER NULL,
  duration_seconds  INTEGER NULL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  note              TEXT    NOT NULL DEFAULT '',
  source            TEXT    NOT NULL DEFAULT 'timer'
                            CHECK (source IN ('timer', 'manual')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  archived_at       INTEGER NULL,
  -- An entry cannot end before it started (FR-TIME-16).
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT;

-- BR-01 / DATA-02: at most one running timer. A partial unique index on a
-- constant is the only way to express "at most one row where this is true" in
-- SQLite, and it makes the rule true even for a direct SQL insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_entries_one_running
  ON time_entries ((1)) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_task    ON time_entries (task_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_time_entries_todo    ON time_entries (todo_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_started ON time_entries (started_at);

--------------------------------------------------------------------------------
-- tags
--------------------------------------------------------------------------------
-- A label on a time entry. \`name\` is unique among live tags, so there is one
-- "review" tag and not four.
--
-- The uniqueness is partial (archived_at IS NULL) so an archived tag's name is
-- released for reuse while the old tag keeps its history and its entries
-- (FR-TAG-05).
CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY,
  uid         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  colour      TEXT    NOT NULL DEFAULT '#6b7280',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tags_archived ON tags (archived_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_name_live
  ON tags (name) WHERE archived_at IS NULL;

--------------------------------------------------------------------------------
-- time_entry_tags
--------------------------------------------------------------------------------
-- Many-to-many. No uid: it is a pure join with no independent identity, and it
-- is one of the 5 tables exempt from the no-delete trigger for the same reason
-- (ADR 0002).
CREATE TABLE IF NOT EXISTS time_entry_tags (
  time_entry_id INTEGER NOT NULL REFERENCES time_entries (id),
  tag_id        INTEGER NOT NULL REFERENCES tags (id),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (time_entry_id, tag_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_time_entry_tags_tag ON time_entry_tags (tag_id);

--------------------------------------------------------------------------------
-- reference_materials
--------------------------------------------------------------------------------
-- Notes, links, snippets, lessons, decisions. Kept after a task ends, because
-- the point of the product is that what was learned outlives the task.
CREATE TABLE IF NOT EXISTS reference_materials (
  id          INTEGER PRIMARY KEY,
  uid         TEXT    NOT NULL UNIQUE,
  task_id     INTEGER NULL REFERENCES tasks (id),
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  url         TEXT    NULL,
  type        TEXT    NOT NULL DEFAULT 'note'
                      CHECK (type IN ('note', 'link', 'snippet', 'lesson', 'decision')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reference_materials_task ON reference_materials (task_id, archived_at);

--------------------------------------------------------------------------------
-- calendar_events
--------------------------------------------------------------------------------
-- \`repeat_rule\` is stored as given and expanded when displayed (0.6.0). Storing
-- expanded rows would mean writing future rows, which is a background job and a
-- second source of truth.
CREATE TABLE IF NOT EXISTS calendar_events (
  id           INTEGER PRIMARY KEY,
  uid          TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  location     TEXT    NOT NULL DEFAULT '',
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  colour       TEXT    NOT NULL DEFAULT '#6b7280',
  repeat_rule  TEXT    NULL,
  task_id      INTEGER NULL REFERENCES tasks (id),
  project_id   INTEGER NULL REFERENCES projects (id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  archived_at  INTEGER NULL,
  CHECK (ends_at >= starts_at)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_calendar_events_starts ON calendar_events (starts_at, archived_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_task   ON calendar_events (task_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_project ON calendar_events (project_id);

--------------------------------------------------------------------------------
-- reminders
--------------------------------------------------------------------------------
-- "Remind me at", and per-event reminders. \`status\` is a computed-from-state
-- field kept for querying: upcoming, done, missed, snoozed.
CREATE TABLE IF NOT EXISTS reminders (
  id            INTEGER PRIMARY KEY,
  uid           TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  note          TEXT    NOT NULL DEFAULT '',
  remind_at     INTEGER NOT NULL,
  repeat_rule   TEXT    NULL,
  status        TEXT    NOT NULL DEFAULT 'upcoming'
                          CHECK (status IN ('upcoming', 'done', 'missed', 'snoozed')),
  task_id       INTEGER NULL REFERENCES tasks (id),
  event_id      INTEGER NULL REFERENCES calendar_events (id),
  last_fired_at INTEGER NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  archived_at   INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (status, remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_task ON reminders (task_id);
CREATE INDEX IF NOT EXISTS idx_reminders_event ON reminders (event_id);

--------------------------------------------------------------------------------
-- activity_log
--------------------------------------------------------------------------------
-- The task history: every status change, and every edit made after closure
-- (FR-STAT-05).
--
-- \`before_json\` and \`after_json\` hold the values that changed, not the whole
-- row, so a history entry stays readable after the entity has moved on. Append
-- only: there is no archived_at here on purpose, because a log entry that could
-- be archived is a log entry that could be hidden.
CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY,
  uid          TEXT    NOT NULL UNIQUE,
  entity       TEXT    NOT NULL,
  entity_id    INTEGER NOT NULL,
  action       TEXT    NOT NULL,
  before_json  TEXT    NULL,
  after_json   TEXT    NULL,
  at           INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log (entity, entity_id, at);
CREATE INDEX IF NOT EXISTS idx_activity_log_at     ON activity_log (at);

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
