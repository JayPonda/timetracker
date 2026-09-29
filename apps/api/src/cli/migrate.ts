import { loadConfig } from '../config/index.js';
import { databasePath, openDb } from '../db/connection.js';
import { migrate, seedSettings } from '../db/migrate.js';
import { logger } from '../lib/logger.js';

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
    logger.info('migrate.ts', 'migrate', 'up to date', { already_applied: result.skipped.length });
  } else {
    for (const m of result.applied) {
      logger.info('migrate.ts', 'migrate', 'migration applied', {
        migration: `${String(m.version).padStart(4, '0')}_${m.name}`,
      });
    }
  }

  const written = seedSettings(db);
  logger.info('migrate.ts', 'migrate', 'settings seeded', { defaults_written: written });
} catch (error) {
  // The message comes first and the stack after it, so the line naming the
  // backup file is not buried under a traceback.
  logger.error('migrate.ts', 'migrate', 'migration failed', { err: error });
  db.close();
  process.exit(1);
}

db.close();
