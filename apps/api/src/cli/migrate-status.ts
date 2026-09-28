import { loadConfig } from '../config/index.js';
import { databasePath, openDb } from '../db/connection.js';
import { migrationStatus } from '../db/migrate.js';

/** `pnpm --filter api migrate:status` — applied and pending, human readable. */
const config = loadConfig();
const db = openDb({ file: databasePath(config.PDM_DATA_DIR), createDirs: false });

try {
  const status = migrationStatus(db);

  if (status.applied.length === 0) {
    console.log('[pdm] no migrations applied yet');
  } else {
    console.log(`[pdm] applied (${String(status.applied.length)}):`);
    for (const m of status.applied) {
      const at = new Date(m.applied_at).toISOString();
      console.log(`  ${String(m.version).padStart(4, '0')}_${m.name.padEnd(28)} ${at}`);
    }
  }

  if (status.pending.length > 0) {
    console.log(`[pdm] pending (${String(status.pending.length)}):`);
    for (const m of status.pending) {
      console.log(`  ${String(m.version).padStart(4, '0')}_${m.name}`);
    }
    process.exitCode = 1;
  } else {
    console.log('[pdm] nothing pending');
  }
} finally {
  db.close();
}
