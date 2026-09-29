import { loadConfig } from '../config/index.js';
import { restoreDatabase } from '../db/backup.js';
import { databasePath } from '../db/connection.js';
import { logger } from '../lib/logger.js';

/**
 * `pnpm --filter api restore <path-to-backup>`
 *
 * Requires the path as an argument, on purpose: a restore overwrites the live
 * database, and a command that does it with no argument is a command someone
 * will run by accident.
 */
const backupPath = process.argv[2];

if (!backupPath) {
  logger.error('restore.ts', 'restore', 'Usage: pnpm --filter api restore <path-to-backup.db>');
  process.exit(1);
}

const config = loadConfig();
const target = databasePath(config.PDM_DATA_DIR);

logger.info('restore.ts', 'restore', 'restoring backup over the live database', {
  backup: backupPath,
  target,
});
restoreDatabase(backupPath, target);
logger.info(
  'restore.ts',
  'restore',
  'restored. The WAL sidecars were removed; restart the app to migrate forward.',
);
