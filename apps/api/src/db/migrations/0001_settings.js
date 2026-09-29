// Migration 0001_settings.
//
// The DDL below is the reviewed hand-written SQL, preserved byte-for-byte;
// it is executed inside a native better-sqlite3 transaction so a failure
// rolls back the whole migration and leaves no half schema (DATA-10). The
// down migration is deliberately unsupported: PDM never drops a schema
// object, any more than it deletes a row.

const SQL = `
-- 0002: settings, created now with its defaults.
--
-- Built in 0.1.0 even though no settings screen exists yet, because every later
-- release reads settings and the Settings screen should not need a migration of
-- its own. Writing the defaults here rather than as lazy fallbacks scattered
-- through the code keeps one code path for reading a setting.
--
-- \`settings\` is a user-data table, so it carries \`uid\` and \`archived_at\` from
-- its first migration (AGENTS.md ground rule 8, DATA-13) and is protected by a
-- BEFORE DELETE trigger. \`uid\` is meaningless for a key/value row, which is the
-- one exemption in the ADR, and the key remains the primary key.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  uid         TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_settings_archived
  ON settings (archived_at);

-- No hard delete of user data, whatever the application code does (DATA-10).
CREATE TRIGGER IF NOT EXISTS trg_settings_no_delete
BEFORE DELETE ON settings
BEGIN
  SELECT RAISE(ABORT, 'settings rows are archived, never deleted (DATA-10)');
END;

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
