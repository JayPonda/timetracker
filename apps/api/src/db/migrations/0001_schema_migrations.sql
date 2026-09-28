-- 0001: the migration ledger.
--
-- Deliberately NOT one of the 13 tables carrying a BEFORE DELETE trigger. The
-- ledger is system state, not user data, and a migration that needs to be
-- un-recorded must be able to remove its own row (ADR 0002, DATA-10).
--
-- `applied_at` is epoch milliseconds, like every timestamp in this project
-- (DATA-07). No ISO strings in the storage path.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  checksum    TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL
) STRICT;
