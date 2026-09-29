import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { loadConfig, type AppConfig } from '../config/index.js';
import { databasePath, openDb } from '../db/connection.js';
import { createKnex } from '../db/knex.js';
import { migrate, seedSettings } from '../db/migrate.js';
import { createServer } from '../server.js';
import type { PrincipalResolver } from '../middleware/principal.js';
import type { RouteDeclaration } from '../routes/table.js';

/**
 * The test factory (docs/TESTING.md).
 *
 * `app.inject()` needs no port and no network, which is what lets the whole API
 * test suite run in-process in under a second.
 *
 * The **real database, in a temp file**. Never a mock: the pragmas, the
 * migration triggers and the `STRICT` tables are all part of what is under test,
 * and a mock would pass while the actual constraints were broken.
 *
 * **Two connections to the one file**, deliberately. Migrations and the health
 * probe use better-sqlite3, because that is synchronous and a DDL transaction
 * around fifteen tables is trivially correct. Repositories use Knex. Both set the
 * same pragmas (`knex.test.ts` asserts that), so they see the same journal mode
 * and the same `foreign_keys` setting.
 */

export interface TestApp {
  app: ReturnType<typeof createServer>;
  db: ReturnType<typeof openDb>;
  knex: Knex;
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
  /**
   * Build the app but do not call `ready()`.
   *
   * For a test that has to add a route or a hook to a live instance, which
   * Fastify refuses once the instance is ready. The route audit itself is an
   * `onReady` hook, so such a test has to own the `ready()` call to observe it.
   */
  deferReady?: boolean;
  /** Install a principal that lacks a capability (criterion 12). */
  principalResolver?: PrincipalResolver;
  /**
   * Extra declared routes, guarded exactly as production routes are.
   *
   * A test cannot register a route after `createServer` returns, because Fastify
   * refuses `addHook` once the instance is ready. Passing them in here means the
   * guard under test is the real one rather than a copy.
   */
  extraRoutes?: readonly RouteDeclaration[];
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

  // Opened after the migration, so the schema exists before any pool connection
  // could query it.
  const knex = createKnex({ file });
  const app = createServer({
    config,
    db,
    knex,
    principalResolver: options.principalResolver,
    extraRoutes: options.extraRoutes,
  });

  // `listen()` does this in production; `inject()` does not, and the static
  // plugin's `sendFile` decorator only exists once the plugin has loaded.
  // This is also where the route audit runs, so a test that registers an
  // undeclared route fails here rather than silently passing.
  if (!options.deferReady) await app.ready();

  return {
    app,
    db,
    knex,
    config,
    dataDir,
    backupDir,
    cleanup: async () => {
      await app.close();
      await knex.destroy();
      if (ownsDb && db.open) db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
