import { loadConfig } from '../config/index.js';
import { databasePath, openDb } from '../db/connection.js';
import { migrate, seedSettings } from '../db/migrate.js';

/**
 * `pnpm --filter api migrate`, and the command the `pdm-migrate` container runs.
 *
 * In Docker this container is the **only** thing that applies migrations: the
 * `pdm` service waits for it to exit 0 (`service_completed_successfully`) and
 * refuses to start otherwise. That exit code is load-bearing, so every failure
 * path below exits non-zero with the reason on stderr — `service_completed_
 * successfully` keys on nothing else.
 *
 * Idempotent, so it is also safe to run by hand after restoring a backup, and
 * in CI.
 */
const config = loadConfig();
const file = databasePath(config.PDM_DATA_DIR);
const db = openDb({ file });

try {
  const result = await migrate(db, { backupDir: config.PDM_BACKUP_DIR, dbPath: file });

  if (result.applied.length === 0) {
    console.log(`[pdm] up to date, ${String(result.skipped.length)} migration(s) already applied`);
  } else {
    for (const m of result.applied) {
      console.log(`[pdm] applied ${String(m.version).padStart(4, '0')}_${m.name}`);
    }
  }

  const written = seedSettings(db);
  console.log(`[pdm] settings: ${String(written)} new default(s) written`);
} catch (error) {
  // A stack trace here would bury the message that names the backup file, which
  // is the line the owner actually needs.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pdm] migration failed:\n${message}`);
  db.close();
  process.exit(1);
}

db.close();
