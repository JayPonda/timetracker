import type { Database } from 'better-sqlite3';
import { backupDatabase } from './db/backup.js';
import { databasePath, openDb } from './db/connection.js';
import { createKnex } from './db/knex.js';
import { migrationStatus, seedSettings, type MigrationStatus } from './db/migrate.js';
import { loadConfig } from './config/index.js';
import { logger } from './lib/logger.js';
import { createServer } from './server.js';

/**
 * Boot. One place, called once, that does everything in the order that makes a
 * failure explainable.
 *
 * **The order matters: verify the schema before listening.** A server that accepts
 * requests against a schema it has not finished creating is worse than a server
 * that refuses to start.
 *
 * **The app does not migrate.** Migrations are applied by a separate one-shot
 * container (`pdm-migrate`), which must exit 0 before this process is started at
 * all. This process therefore only checks that nothing is pending and refuses to
 * run if something is, rather than applying it. One owner for migrations, and the
 * check that fails is a check, not a second implementation (ADR 0009, ADR 0001).
 *
 * In local development, where there is no second container, the same command the
 * migrator runs is part of `pnpm dev`, so the rule is the same everywhere.
 */

export class SchemaNotReadyError extends Error {
  readonly pending: Array<{ version: number; name: string }>;

  constructor(pending: Array<{ version: number; name: string }>) {
    const list = pending.map((p) => `${String(p.version).padStart(4, '0')}_${p.name}`).join(', ');
    super(
      `${String(pending.length)} migration(s) have not been applied: ${list}\n` +
        'The application does not apply migrations. Run: pnpm --filter api migrate',
    );
    this.name = 'SchemaNotReadyError';
    this.pending = pending;
  }
}

/**
 * DEP-09: the server refuses to run against an un-migrated schema.
 *
 * A check, not a second implementation. The migrator container owns applying
 * migrations; this only refuses to serve when it did not run, so the failure is
 * one line of output instead of a confusing query error later.
 */
export function assertSchemaReady(db: Database): MigrationStatus {
  const status = migrationStatus(db);
  if (status.pending.length > 0) throw new SchemaNotReadyError(status.pending);
  return status;
}

export async function boot(): Promise<{ close: () => Promise<void> }> {
  const config = loadConfig();

  const dbFile = databasePath(config.PDM_DATA_DIR);
  const db = openDb({ file: dbFile });

  let status: MigrationStatus;
  try {
    status = assertSchemaReady(db);
  } catch (cause) {
    db.close();
    throw cause;
  }

  seedSettings(db);

  const knex = createKnex({ file: dbFile });
  const server = createServer({ config, db, knex });

  try {
    await server.listen({ host: config.PDM_BIND_HOST, port: config.PDM_INTERNAL_PORT });
  } catch (cause) {
    await knex.destroy();
    db.close();
    throw cause;
  }

  logger.info('index.ts', 'boot', 'listening', {
    host: config.PDM_BIND_HOST,
    port: config.PDM_INTERNAL_PORT,
    time_zone: config.TZ,
    data_dir: config.PDM_DATA_DIR,
    migrations_applied: status.applied.length,
  });

  return {
    close: async () => {
      await server.close();
      // Knex first: it holds pooled connections to the same file, and closing
      // the file underneath a live pool is the kind of ordering bug that shows
      // up as an error on shutdown and nowhere else.
      await knex.destroy();
      db.close();
    },
  };
}

export { loadConfig, openDb, databasePath, backupDatabase, migrationStatus, seedSettings };
