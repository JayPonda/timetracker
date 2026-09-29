import type { Database as Db } from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { nowMs } from '@pdm/shared';

/**
 * Backup and restore, built now and scheduled in 0.9.0.
 *
 * **Never copy the database file with `cp` or `fs.copyFile`.** Under WAL the
 * data lives in three files — `pdm.db`, `pdm.db-wal` and `pdm.db-shm` — and
 * copying only the first captures a torn snapshot. It looks like a successful
 * backup and is not one, which is the quietest way to lose data (ADR 0007, SRS
 * `S8`).
 *
 * `VACUUM INTO` is SQLite's own online backup: it produces a single consistent
 * file, committed atomically, while other connections may be reading and
 * writing. It is the mechanism this project uses for both the pre-migration
 * snapshot and the daily backup.
 */

export interface BackupResult {
  path: string;
}

/** Escapes a path for interpolation into SQL. Single quotes are the only risk. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface BackupOptions {
  /** Directory the backup file is written into. Created if missing. */
  destDir: string;
  /** Base filename without extension. */
  name?: string;
}

/**
 * Writes a consistent snapshot of `db` into `destDir` and returns its path.
 *
 * Uses `VACUUM INTO`, which takes a read transaction for the duration. On a
 * single-user laptop that is a few milliseconds, so it needs no scheduling.
 */
export function backupDatabase(db: Db, { destDir, name = 'pdm' }: BackupOptions): BackupResult {
  mkdirSync(destDir, { recursive: true });

  // `new Date(nowMs())` converts a known epoch value; it does not read the
  // clock. The read itself stays behind the single `nowMs()` seam, so a frozen
  // test clock also freezes the backup file name (AGENTS.md, rule 4).
  const stamp = new Date(nowMs()).toISOString().replace(/[:.]/g, '-');
  const path = join(destDir, `${name}-${stamp}.db`);

  // Fails loudly if the destination exists, rather than overwriting a good
  // backup with a partial one.
  db.exec(`VACUUM INTO ${sqlLiteral(path)}`);

  return { path };
}

/** The pre-migration snapshot directory, under the configured backup dir. */
export function migrationBackupDir(backupDir: string): string {
  return join(backupDir, 'migrations');
}

/**
 * Copies a backup file over the live database and removes the WAL sidecars.
 *
 * The sidecars must go. A stale `pdm.db-wal` left from the previous database is
 * replayed into the restored file on the next open, which quietly corrupts it.
 */
export function restoreDatabase(backupPath: string, dbPath: string): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  copyFileSync(backupPath, dbPath);
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
