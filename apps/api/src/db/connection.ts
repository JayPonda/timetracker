import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { accessSync, mkdirSync, statSync } from 'node:fs';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The connection, its pragmas, and nothing else (AGENTS.md Part 5).
 *
 * `better-sqlite3` is synchronous, which is the reason this project chose it:
 * a transaction is trivially correct when there is no interleaving to reason
 * about. That property is load-bearing for the migration runner and for every
 * service, so it is not traded away for async without a new ADR.
 */

export interface OpenDbOptions {
  /** Absolute path to the database file, or `:memory:`. */
  file: string;
  /** Create the parent directory if it is missing. */
  createDirs?: boolean;
}

export function openDb({ file, createDirs = true }: OpenDbOptions): Db {
  if (createDirs && file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }

  if (file !== ':memory:') assertDataDirWritable(dirname(file));

  const db = new Database(file);

  // WAL for concurrent reader access while a write is in flight (NFR-REL-01).
  // Without it a backup or a long read blocks the whole database.
  db.pragma('journal_mode = WAL');

  // Off by default in SQLite. Every migration in this project is hand-written
  // and there is no ON DELETE CASCADE anywhere (DATA-10), so this must be ON or
  // those promises are only kept by convention.
  db.pragma('foreign_keys = ON');

  // Wait rather than fail when another connection holds the write lock.
  db.pragma('busy_timeout = 5000');

  // NORMAL is the right trade under WAL: durable across application crash, and
  // only at risk from an OS-level crash, which is a power cut on the owner's
  // laptop. FULL would cost a sync per commit for no benefit worth paying.
  db.pragma('synchronous = NORMAL');

  return db;
}

/** The pragmas this project relies on, as a table. Used by a test to assert them. */
export const REQUIRED_PRAGMAS: ReadonlyArray<{ name: string; expected: string }> = [
  { name: 'journal_mode', expected: 'wal' },
  { name: 'foreign_keys', expected: '1' },
  { name: 'busy_timeout', expected: '5000' },
  { name: 'synchronous', expected: '1' },
];

export function pragmaValue(db: Db, name: string): unknown {
  return db.pragma(name, { simple: true });
}

/** Resolves the database file inside the configured data directory. */
export function databasePath(dataDir: string): string {
  return join(dataDir, 'pdm.db');
}

/**
 * The data directory exists but this process cannot write to it.
 *
 * Raised instead of letting `better-sqlite3` fail, because the raw failure is
 * `SQLITE_CANTOPEN`, which names neither the cause nor the fix. The usual cause
 * is the container's non-root uid meeting a host directory the owner created:
 * uid 10001 sees a 0755 directory owned by the laptop's uid and gets "other"
 * permission, which is read and execute but not write.
 *
 * The alternative failure mode is quieter and worse. If the directory is not
 * writable, SQLite cannot create the file, so the app either dies at boot or —
 * on an already-open handle — keeps writing to an unlinked inode that vanishes
 * on restart, with the host left holding no database at all.
 */
export class DataDirNotWritableError extends Error {
  constructor(
    readonly dir: string,
    readonly uid: number,
  ) {
    super(
      `The data directory ${dir} is not writable by uid ${uid}. ` +
        `The container runs as uid 10001 and a host directory is normally owned by your own user, ` +
        `so it gets read-only "other" permission. Fix it with: sudo chown -R 10001:10001 ${dir}`,
    );
    this.name = 'DataDirNotWritableError';
  }
}

/**
 * Fails early and legibly when the data directory cannot be written.
 *
 * Checked with `accessSync` rather than by catching the SQLite error, so the
 * message can name the directory, the uid and the exact command. A missing
 * directory is not an error here: `openDb` creates it when asked to.
 */
function assertDataDirWritable(dir: string): void {
  let writable = true;
  try {
    if (statSync(dir).isDirectory()) accessSync(dir, constants.W_OK);
    else writable = false;
  } catch {
    // Absent, or the check itself was refused. Either way the open below will
    // fail, and a failure it can explain beats a silent one.
    writable = false;
  }

  if (!writable) throw new DataDirNotWritableError(dir, typeof process.getuid === 'function' ? process.getuid() : -1);
}
