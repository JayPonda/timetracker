import { loadConfig } from '../config/index.js';
import { backupDatabase } from '../db/backup.js';
import { databasePath, openDb } from '../db/connection.js';
import { logger } from '../lib/logger.js';

/** `pnpm --filter api backup` — take a backup now, same code path as the schedule. */
const config = loadConfig();
const db = openDb({ file: databasePath(config.PDM_DATA_DIR), createDirs: false });

try {
  const result = backupDatabase(db, { destDir: config.PDM_BACKUP_DIR, name: 'manual' });
  logger.info('backup.ts', 'backup', 'backup written', { path: result.path });
} finally {
  db.close();
}
