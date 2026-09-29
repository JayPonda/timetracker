import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Database as Db } from 'better-sqlite3';
import { nowMs } from '@pdm/shared';
import { backupDatabase, migrationBackupDir, restoreDatabase } from './backup.js';
import { createKnex } from './knex.js';

/**
 * Migration wrapper around **Knex** (DEP-09, NFR-MAINT-02, ADR 0012).
 *
 * Knex does the running: it lists the `.js` files, orders them, skips what is
 * already applied, records the batch, and reports progress in `[batch, log]`.
 * That is the whole of a migration runner's job, and re-implementing it is a
 * decision this project already stopped making — see ADR 0012 for why the
 * hand-rolled Umzug runner was replaced.
 *
 * What stays here is only what Knex cannot know about this project, and each
 * piece is a requirement rather than a convenience:
 *
 * 1. **A migration file is `NNNN_name.js` that execs the reviewed schema
 *    SQL.** Each file keeps the DDL byte-identical to the hand-written SQL it
 *    was generated from, so `.js` is a shape change, not a rewrite of the
 *    schema (NFR-MAINT-02).
 * 2. **One SQLite transaction per migration.** Knex is told
 *    `disableTransactions: true` — its own wrapper would make every migration
 *    one big transaction and also defeats the point of a ledger — and instead
 *    each migration opens the native better-sqlite3 connection and runs its DDL
 *    inside `conn.transaction(...)`. A failure rolls back that migration
 *    completely, and the failed migration's name never reaches `knex_migrations`.
 * 3. **The ledger in SQLite** (`knex_migrations`), which is what `/health`
 *    reports, so no second place can disagree with the database.
 * 4. **A pre-migration backup**, via the online API. A migration that goes wrong
 *    must be recoverable without the owner having known to take a manual copy.
 * 5. **Restore and abort on failure**, naming the backup file. Continuing on a
 *    half-migrated database would fail later, somewhere that does not point back
 *    at the cause.
 * 6. **A contiguity check**, run before anything is applied. A gap means a
 *    migration was deleted rather than written out of order, and deleting a
 *    migration is the one thing the no-delete policy cannot tolerate for the
 *    schema itself.
 *
 * The immutability checksum that the old runner kept is gone. The owner's
 * decision when adopting Knex (2026-09-29) was to drop that guarantee and run
 * migrations on their `IF NOT EXISTS` strengths instead; the checksum buys a
 * false sense of safety against a database `knex_migrations` does not keep.
 * See ADR 0012.
 */

export interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

export interface MigrationOutcome {
  version: number;
  name: string;
  status: 'applied' | 'skipped';
}

export interface MigrateResult {
  applied: MigrationOutcome[];
  skipped: MigrationOutcome[];
  total: number;
}

export class MigrationError extends Error {
  readonly backupPath: string | undefined;
  readonly restorePath: string | undefined;

  constructor(message: string, options: { backupPath?: string; restorePath?: string } = {}) {
    super(message);
    this.name = 'MigrationError';
    this.backupPath = options.backupPath;
    this.restorePath = options.restorePath;
  }
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.js$/;

/** Reads and parses the migration files, sorted by version. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const entries = readdirSync(dir)
    .map((file) => {
      const match = FILE_PATTERN.exec(file);
      if (!match) return null;
      return {
        version: Number(match[1]),
        name: match[2],
        path: join(dir, file),
      };
    })
    .filter((m): m is MigrationFile => m !== null)
    .sort((a, b) => a.version - b.version);

  assertNoDuplicateVersions(entries);
  assertNoGaps(entries);

  return entries;
}

function assertNoDuplicateVersions(migrations: MigrationFile[]): void {
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new MigrationError(`Two migrations share version ${m.version}: ${m.path}`);
    }
    seen.add(m.version);
  }
}

/**
 * Versions must be contiguous from 1.
 *
 * A gap usually means a migration was deleted rather than written out of order,
 * and deleting a migration is the one thing this project's no-delete policy
 * cannot tolerate for the schema itself.
 */
function assertNoGaps(migrations: MigrationFile[]): void {
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new MigrationError(
        `Migration versions must be contiguous from 0001. Found ${String(m.version).padStart(4, '0')} at position ${index + 1}. ` +
          `A gap means a migration was deleted; add a new one instead.`,
      );
    }
  });
}

/** Knex creates its own ledger (`knex_migrations`) on first run. */
function tableExists(db: Db, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

/**
 * The ledger as recorded by Knex, keyed by version. Parsed from each row's
 * filename (`0001_settings.js`), because `version` is not a column Knex keeps.
 */
function readLedgerByVersion(db: Db): Map<number, number> {
  if (!tableExists(db, 'knex_migrations')) return new Map();
  const rows = db
    .prepare('SELECT name, migration_time FROM knex_migrations')
    .all() as Array<{ name: string; migration_time: number }>;

  const byVersion = new Map<number, number>();
  for (const row of rows) {
    const match = FILE_PATTERN.exec(row.name);
    if (match) byVersion.set(Number(match[1]), Number(row.migration_time));
  }
  return byVersion;
}

export interface MigrateOptions {
  /** Backup directory. Pre-migration snapshots go in its `migrations/` subdir. */
  backupDir?: string;
  /** Skip the pre-migration backup. Tests only; production must not set this. */
  skipBackup?: boolean;
  /** Migrations directory override, for tests. */
  dir?: string;
  /** Live database path, so a failed migration can restore the backup over it. */
  dbPath?: string;
}

/**
 * Runs every pending migration. **Migrate before the server listens** (index.ts).
 *
 * The preflight checks run first and throw before a single statement is applied,
 * so a deleted or out-of-order migration stops the boot with the database
 * untouched.
 */
export async function migrate(db: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const files = loadMigrations(dir);

  const dbPath = options.dbPath ?? db.name;
  if (dbPath === ':memory:') {
    throw new MigrationError(
      'Migrations need a file database; an in-memory database cannot be migrated.',
    );
  }

  const result: MigrateResult = { applied: [], skipped: [], total: files.length };
  const state: { active?: MigrationFile; lastBackup?: string } = {};
  const appliedBefore = readLedgerByVersion(db);

  for (const file of files) {
    if (appliedBefore.has(file.version)) {
      result.skipped.push({ version: file.version, name: file.name, status: 'skipped' });
    }
  }

  const knex = createKnex({ file: dbPath });

  const migrationSource = {
    async getMigrations() {
      return files.map((file) => basename(file.path));
    },
    getMigrationName(name: string) {
      return name;
    },
    async getMigration(name: string) {
      const file = files.find((f) => basename(f.path) === name);
      if (!file) throw new MigrationError(`No migration in ${dir} matches ${name}`);
      // `.js` is ESM and the file carries its own up/down. The runner wraps `up`
      // so the backup happens and the failed migration is named by point.
      const module = (await import(pathToFileURL(file.path).toString())) as {
        up: (knex: unknown) => Promise<void>;
        down: (knex: unknown) => Promise<void>;
      };
      return {
        up: async (knex: unknown) => {
          state.active = file;
          if (options.backupDir && !options.skipBackup) {
            state.lastBackup = backupDatabase(db, {
              destDir: migrationBackupDir(options.backupDir),
              name: `pre-${String(file.version).padStart(4, '0')}_${file.name}`,
            }).path;
          }
          return module.up(knex);
        },
        down: (knex: unknown) => module.down(knex),
      };
    },
  };

  try {
    const [, log] = await knex.migrate.latest({ migrationSource, disableTransactions: true });
    for (const name of log) {
      const file = files.find((f) => basename(f.path) === name);
      if (file) result.applied.push({ version: file.version, name: file.name, status: 'applied' });
    }
  } catch (cause) {
    await knex.destroy();
    throw describeFailure(cause, state, options);
  }

  await knex.destroy();
  return result;
}

/**
 * Names the migration that failed and the backup to recover from.
 *
 * The backup is restored over the live database when its path is known, so a
 * failed boot leaves the database as it was before the run rather than asking
 * the owner to notice and act.
 */
function describeFailure(cause: unknown, state: { active?: MigrationFile; lastBackup?: string }, options: MigrateOptions): MigrationError {
  if (cause instanceof MigrationError && cause.backupPath === undefined) return cause;

  const active = state.active;
  const failed = active ? `${String(active.version).padStart(4, '0')}_${active.name}` : 'an unknown migration';
  const reason = rootMessage(cause);
  const backupPath = state.lastBackup;
  const restorePath = backupPath ? safeRestore(backupPath, options) : undefined;

  const where = backupPath
    ? `The pre-migration backup is at ${backupPath}${
        restorePath ? ' and has been restored over the database.' : `; restore it with: pnpm --filter api restore ${backupPath}`
      }`
    : 'No pre-migration backup was taken for this run.';

  return new MigrationError(
    `Migration ${failed} failed and was rolled back: ${reason}\n${where}\n` +
      'The boot is aborted rather than continuing on a partially migrated schema.',
    { backupPath, restorePath },
  );
}

function rootMessage(cause: unknown): string {
  if (cause instanceof Error) {
    const inner = (cause as { cause?: unknown }).cause;
    return inner instanceof Error ? `${cause.message}: ${inner.message}` : cause.message;
  }
  return String(cause);
}

function safeRestore(backupPath: string, options: MigrateOptions): string | undefined {
  if (!options.backupDir) return undefined;
  const dbPath = options.dbPath;
  if (!dbPath) return undefined;
  try {
    restoreDatabase(backupPath, dbPath);
    return dbPath;
  } catch {
    // The error message already names the backup file, which is what the owner
    // needs. A failed auto-restore is reported by that path, not swallowed.
    return undefined;
  }
}

export interface MigrationStatus {
  applied: Array<{ version: number; name: string; applied_at: number }>;
  pending: Array<{ version: number; name: string }>;
  ok: boolean;
}

/** What `pnpm --filter api migrate:status` prints. */
export function migrationStatus(db: Db, dir: string = MIGRATIONS_DIR): MigrationStatus {
  const migrations = loadMigrations(dir);
  const appliedAt = readLedgerByVersion(db);

  return {
    applied: migrations
      .filter((m) => appliedAt.has(m.version))
      .map((m) => ({
        version: m.version,
        name: m.name,
        applied_at: appliedAt.get(m.version) ?? 0,
      })),
    pending: migrations.filter((m) => !appliedAt.has(m.version)).map((m) => ({ version: m.version, name: m.name })),
    ok: true,
  };
}

/**
 * Writes the default settings rows. Idempotent, so it runs on every boot.
 *
 * Defaults live here and nowhere else, so there is one code path for reading a
 * setting rather than a fallback at each call site (0.1.0 design notes).
 */
export function seedSettings(db: Db, now: number = nowMs()): number {
  const insert = db.prepare(
    `INSERT INTO settings (key, value, uid, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT (key) DO NOTHING`,
  );

  const defaults: ReadonlyArray<readonly [string, string]> = [
    ['time_zone', process.env.TZ ?? 'UTC'],
    ['week_starts_on', '1'],
    ['theme', 'system'],
    ['hourly_prompt_enabled', '1'],
    ['hourly_prompt_minutes', '60'],
    ['daily_backup_enabled', '1'],
    ['backup_count', String(process.env.PDM_BACKUP_COUNT ?? '14')],
  ];

  let written = 0;
  const run = db.transaction(() => {
    for (const [key, value] of defaults) {
      const result = insert.run(key, value, randomUUID(), now, now);
      written += result.changes;
    }
  });
  run();

  return written;
}