-- 0002: settings, created now with its defaults.
--
-- Built in 0.1.0 even though no settings screen exists yet, because every later
-- release reads settings and the Settings screen should not need a migration of
-- its own. Writing the defaults here rather than as lazy fallbacks scattered
-- through the code keeps one code path for reading a setting.
--
-- `settings` is a user-data table, so it carries `uid` and `archived_at` from
-- its first migration (AGENTS.md ground rule 8, DATA-13) and is protected by a
-- BEFORE DELETE trigger. `uid` is meaningless for a key/value row, which is the
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
