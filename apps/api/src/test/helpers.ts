import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type AppConfig } from '../config/index.js';
import { databasePath, openDb } from '../db/connection.js';
import { migrate, seedSettings } from '../db/migrate.js';
import { createServer } from '../server.js';

/**
 * The test factory (docs/TESTING.md).
 *
 * `app.inject()` needs no port and no network, which is what lets the whole API
 * test suite run in-process in under a second.
 *
 * The **real database, in a temp file**. Never a mock: the pragmas, the
 * migration triggers and the `STRICT` tables are all part of what is under test,
 * and a mock would pass while the actual constraints were broken.
 */

export interface TestApp {
  app: ReturnType<typeof createServer>;
  db: ReturnType<typeof openDb>;
  config: AppConfig;
  dataDir: string;
  backupDir: string;
  cleanup: () => Promise<void>;
}

export interface TestAppOptions {
  /** Overrides merged over the defaults. Set TZ to test a zone. */
  env?: Record<string, string>;
  /** Provide an already-open database, e.g. one to close for a 503 test. */
  db?: ReturnType<typeof openDb>;
  /** Skip the migration run, to test a specific schema state. */
  skipMigrations?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const root = mkdtempSync(join(tmpdir(), 'pdm-test-'));
  const dataDir = join(root, 'data');
  const backupDir = join(root, 'backups');

  const config = loadConfig({
    NODE_ENV: 'test',
    PDM_DATA_DIR: dataDir,
    PDM_BACKUP_DIR: backupDir,
    PDM_WEB_DIR: '',
    TZ: 'UTC',
    ...options.env,
  } as NodeJS.ProcessEnv);

  const file = databasePath(dataDir);
  const ownsDb = !options.db;
  const db = options.db ?? openDb({ file });

  if (!options.skipMigrations) {
    await migrate(db, { backupDir, dbPath: file });
    seedSettings(db);
  }

  const app = createServer({ config, db });

  // `listen()` does this in production; `inject()` does not, and the static
  // plugin's `sendFile` decorator only exists once the plugin has loaded.
  await app.ready();

  return {
    app,
    db,
    config,
    dataDir,
    backupDir,
    cleanup: async () => {
      await app.close();
      if (ownsDb && db.open) db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
