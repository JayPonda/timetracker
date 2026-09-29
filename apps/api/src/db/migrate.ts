import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as Db } from 'better-sqlite3';
import { Umzug, type UmzugStorage } from 'umzug';
import { nowMs } from '@pdm/shared';
import { backupDatabase, migrationBackupDir, restoreDatabase } from './backup.js';

/**
 * Migration wrapper around **Umzug** (DEP-09, NFR-MAINT-02, ADR 0009).
 *
 * Umzug does the running: it globs the `.sql` files, orders them, skips what is
 * already applied, and reports progress. That is the whole of a migration
 * runner's job, and re-implementing it was our decision to stop making — see
 * ADR 0009 for why the hand-rolled runner was replaced.
 *
 * What stays here is only what Umzug cannot know about this project, and each
 * piece is a requirement rather than a convenience:
 *
 * 1. **Plain `.sql` files**, named `NNNN_name.sql`. `NFR-MAINT-02` wants a
 *    migration to be auditable by a human reading one file, so the files stay
 *    SQL and not generated code.
 * 2. **A ledger in SQLite** (`schema_migrations`), not Umzug's default JSON
 *    file. `schema_migrations` is part of the agreed data model (AGENTS.md
 *    Part 7) and is what `/health` reports, so the storage adapter below keeps
 *    it in the database.
 * 3. **A pre-migration backup**, via the online API. A migration that goes wrong
 *    must be recoverable without the owner having known to take a manual copy.
 * 4. **Restore and abort on failure**, naming the backup file. Continuing on a
 *    half-migrated database would fail later, somewhere that does not point back
 *    at the cause.
 * 5. **Immutability and contiguity checks**, run before anything is applied. A
 *    deleted or edited migration is a silent divergence between two
 *    environments, and Umzug's ledger records only that a name ran, not what it
 *    contained.
 *
 * One honest limitation: Umzug calls `up()` and then records the row, so the DDL
 * and its ledger row are two transactions. A crash in that window leaves an
 * applied migration unrecorded, and the next boot re-runs it and fails loudly.
 * That is a loud failure with a backup named in the message, which is the
 * failure mode this project prefers over a silent one.
 */

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
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

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Reads and parses the migration files, sorted by version. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const entries = readdirSync(dir)
    .map((file) => {
      const match = FILE_PATTERN.exec(file);
      if (!match) return null;
      const path = join(dir, file);
      const sql = readFileSync(path, 'utf8');
      return {
        version: Number(match[1]),
        name: match[2],
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
        path,
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

function ensureLedger(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      checksum   TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);
}

function appliedMap(db: Db): Map<number, { name: string; checksum: string }> {
  const rows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; name: string; checksum: string }>;
  return new Map(rows.map((r) => [r.version, { name: r.name, checksum: r.checksum }]));
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
 * Umzug's storage backed by the `schema_migrations` table.
 *
 * Three methods, per Umzug's `UmzugStorage` contract. `executed` returns the
 * ledger's names, which is how Umzug decides what is still pending.
 */
function ledgerStorage(db: Db): UmzugStorage<{ db: Db; manifest: Map<string, MigrationFile> }> {
  const write = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );

  return {
    async logMigration({ name, path, context }) {
      const file = context.manifest.get(path ?? '');
      if (!file) throw new MigrationError(`Umzug recorded an unknown migration: ${name}`);
      write.run(file.version, file.name, file.checksum, nowMs());
    },

    async unlogMigration({ path, context }) {
      const file = context.manifest.get(path ?? '');
      if (file) db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(file.version);
    },

    async executed() {
      const rows = db
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: number; name: string }>;
      // Umzug matches by filename; the ledger stores the slug and the version.
      return rows.map((r) => `${String(r.version).padStart(4, '0')}_${r.name}.sql`);
    },
  };
}

/** Builds the Umzug instance. The resolver is what actually runs a migration. */
function createUmzug(
  db: Db,
  dir: string,
  files: MigrationFile[],
  onBeforeApply: (file: MigrationFile) => void,
): Umzug<{ db: Db; manifest: Map<string, MigrationFile> }> {
  const manifest = new Map(files.map((f) => [f.path, f]));

  return new Umzug<{ db: Db; manifest: Map<string, MigrationFile> }>({
    migrations: {
      glob: ['*.sql', { cwd: dir }],
      resolve: ({ name, path }) => {
        const file = manifest.get(path ?? '');
        if (!file) throw new MigrationError(`Umzug offered a migration that is not in ${dir}: ${String(path)}`);

        return {
          name,
          path,
          // Synchronous SQLite, but Umzug's contract is async.
          up: async () => {
            onBeforeApply(file);

            // SQLite DDL is transactional, which is why one transaction per
            // migration gives "no partial schema" without any extra work.
            db.transaction(() => {
              db.exec(file.sql);
            })();
          },
        };
      },
    },
    context: { db, manifest },
    storage: ledgerStorage(db),
    logger: undefined,
  });
}

/**
 * Runs every pending migration. **Migrate before the server listens** (index.ts).
 *
 * The preflight checks run first and throw before a single statement is applied,
 * so an edited or deleted migration stops the boot with the database untouched.
 */
export async function migrate(db: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  ensureLedger(db);

  const dir = options.dir ?? MIGRATIONS_DIR;
  const files = loadMigrations(dir);
  const applied = appliedMap(db);

  assertNoEdits(files, applied);

  const result: MigrateResult = { applied: [], skipped: [], total: files.length };
  let lastBackup: string | undefined;

  const umzug = createUmzug(db, dir, files, (file) => {
    if (!options.backupDir || options.skipBackup) return;
    lastBackup = backupDatabase(db, {
      destDir: migrationBackupDir(options.backupDir),
      name: `pre-${String(file.version).padStart(4, '0')}`,
    }).path;
  });

  const alreadyApplied = files.filter((f) => applied.has(f.version));
  for (const file of alreadyApplied) {
    result.skipped.push({ version: file.version, name: file.name, status: 'skipped' });
  }

  try {
    // No `migrations` list: Umzug derives pending from the ledger via
    // `storage.executed`, which is the same skip-if-applied rule the tests pin.
    const ran = await umzug.up();
    for (const item of ran) {
      const file = files.find((f) => f.path === item.path);
      if (file) result.applied.push({ version: file.version, name: file.name, status: 'applied' });
    }
  } catch (cause) {
    throw describeFailure(cause, lastBackup, options);
  }

  return result;
}

/**
 * Names the migration that failed and the backup to recover from.
 *
 * The backup is restored over the live database when its path is known, so a
 * failed boot leaves the database as it was before the run rather than asking
 * the owner to notice and act.
 */
function describeFailure(cause: unknown, backupPath: string | undefined, options: MigrateOptions): MigrationError {
  if (cause instanceof MigrationError && cause.backupPath === undefined) return cause;

  const failed = umzugMigrationName(cause) ?? 'an unknown migration';
  const reason = rootMessage(cause);
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

/** Pulls the migration name out of Umzug's `MigrationError`, if it is one. */
function umzugMigrationName(cause: unknown): string | undefined {
  if (typeof cause === 'object' && cause !== null && 'migration' in cause) {
    const migration = (cause as { migration?: { name?: unknown } }).migration;
    if (typeof migration?.name === 'string') return migration.name;
  }
  return undefined;
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

/**
 * An applied migration is immutable. Editing one leaves the database and the
 * file describing different schemas, which is how two environments diverge
 * silently. Add a new migration instead.
 */
function assertNoEdits(files: MigrationFile[], applied: Map<number, { name: string; checksum: string }>): void {
  for (const file of files) {
    const previous = applied.get(file.version);
    if (!previous) continue;
    if (previous.checksum !== file.checksum) {
      throw new MigrationError(
        `Migration ${String(file.version).padStart(4, '0')}_${file.name} was already applied with a different checksum. ` +
          'Applied migrations are immutable; add a new migration instead of editing this one.',
      );
    }
  }
}

export interface MigrationStatus {
  applied: Array<{ version: number; name: string; applied_at: number }>;
  pending: Array<{ version: number; name: string }>;
  ok: boolean;
}

/** What `pnpm --filter api migrate:status` prints. */
export function migrationStatus(db: Db, dir: string = MIGRATIONS_DIR): MigrationStatus {
  ensureLedger(db);
  const migrations = loadMigrations(dir);
  const applied = appliedMap(db);

  const appliedAt = db
    .prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; applied_at: number }>;
  const appliedAtMap = new Map(appliedAt.map((r) => [r.version, r.applied_at]));

  return {
    applied: migrations
      .filter((m) => applied.has(m.version))
      .map((m) => ({
        version: m.version,
        name: m.name,
        applied_at: appliedAtMap.get(m.version) ?? 0,
      })),
    pending: migrations.filter((m) => !applied.has(m.version)).map((m) => ({ version: m.version, name: m.name })),
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
