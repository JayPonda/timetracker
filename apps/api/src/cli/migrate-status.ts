import { loadConfig } from '../config/index.js';
import { databasePath, openDb } from '../db/connection.js';
import { migrationStatus } from '../db/migrate.js';
import { logger } from '../lib/logger.js';

/** `pnpm --filter api migrate:status` — applied and pending, human readable. */
const config = loadConfig();
const db = openDb({ file: databasePath(config.PDM_DATA_DIR), createDirs: false });

try {
  const status = migrationStatus(db);

  if (status.applied.length === 0) {
    logger.info('migrate-status.ts', 'status', 'no migrations applied yet');
  } else {
    logger.info('migrate-status.ts', 'status', 'applied', { count: status.applied.length });
    for (const m of status.applied) {
      logger.info(
        'migrate-status.ts',
        'status',
        `${String(m.version).padStart(4, '0')}_${m.name.padEnd(28)} ${new Date(m.applied_at).toISOString()}`,
      );
    }
  }

  if (status.pending.length > 0) {
    logger.info('migrate-status.ts', 'status', 'pending', { count: status.pending.length });
    for (const m of status.pending) {
      logger.info('migrate-status.ts', 'status', `${String(m.version).padStart(4, '0')}_${m.name}`);
    }
    process.exitCode = 1;
  } else {
    logger.info('migrate-status.ts', 'status', 'nothing pending');
  }
} finally {
  db.close();
}
