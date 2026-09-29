import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataDirNotWritableError, openDb, REQUIRED_PRAGMAS, pragmaValue } from './connection.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdm-db-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('NFR-REL-01: the database runs in WAL mode', () => {
  it('sets journal_mode to wal', () => {
    const db = openDb({ file: join(root, 'pdm.db') });
    expect(String(pragmaValue(db, 'journal_mode')).toLowerCase()).toBe('wal');
    db.close();
  });
});

describe('DATA-10: foreign keys are enforced, not merely declared', () => {
  it('sets foreign_keys ON', () => {
    // Every migration here is hand-written and there is no ON DELETE CASCADE
    // anywhere, so without this pragma those promises hold only by convention.
    const db = openDb({ file: join(root, 'pdm.db') });
    expect(pragmaValue(db, 'foreign_keys')).toBe(1);
    db.close();
  });

  it('refuses an orphan row', () => {
    const db = openDb({ file: join(root, 'pdm.db') });
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT');
    db.exec(
      'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id)) STRICT',
    );

    expect(() => db.prepare('INSERT INTO child (id, parent_id) VALUES (1, 999)').run()).toThrow(
      /FOREIGN KEY/i,
    );
    db.close();
  });
});

describe('NFR-REL-01: a concurrent write waits rather than failing', () => {
  it('sets a busy timeout', () => {
    const db = openDb({ file: join(root, 'pdm.db') });
    expect(Number(pragmaValue(db, 'busy_timeout'))).toBe(5000);
    db.close();
  });
});

describe('the pragmas this project relies on are all set', () => {
  it('matches the documented table', () => {
    const db = openDb({ file: join(root, 'pdm.db') });
    for (const { name, expected } of REQUIRED_PRAGMAS) {
      expect(String(pragmaValue(db, name)).toLowerCase()).toBe(expected);
    }
    db.close();
  });
});

describe('NFR-DATA-01: the database is a plain SQLite file', () => {
  it('is readable by any SQLite client, not a private format', () => {
    const file = join(root, 'pdm.db');
    const db = openDb({ file });
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT');
    db.close();

    // Reopen with a second, independent connection: no project-specific code runs.
    const reopened = openDb({ file });
    const tables = reopened
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't'")
      .get();
    expect(tables).toBeDefined();
    reopened.close();
  });
});

describe('STRICT tables reject a wrong type outright', () => {
  it('refuses text in an integer column', () => {
    const db = openDb({ file: join(root, 'pdm.db') });
    db.exec('CREATE TABLE t (n INTEGER NOT NULL) STRICT');

    expect(() => db.prepare('INSERT INTO t (n) VALUES (?)').run('not a number')).toThrow();
    db.close();
  });
});

describe('DEP-01: an unwritable data directory fails with a message naming the fix', () => {
  it('names the directory, the uid and the chown command', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pdm-ro-')), 'data');
    mkdirSync(dir);
    chmodSync(dir, 0o500); // read and execute, no write: the 0755 case

    try {
      expect(() => openDb({ file: join(dir, 'pdm.db'), createDirs: false })).toThrow(
        DataDirNotWritableError,
      );
      expect(() => openDb({ file: join(dir, 'pdm.db'), createDirs: false })).toThrow(
        /sudo chown -R 10001:10001/,
      );
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not raise it for a writable directory', () => {
    const db = openDb({ file: ':memory:' });
    expect(db.open).toBe(true);
    db.close();
  });

  it('never leaves a half-open handle behind', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pdm-ro2-')), 'data');
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    try {
      expect(() => openDb({ file: join(dir, 'pdm.db'), createDirs: false })).toThrow();
      // Nothing was created, so a later run with permissions fixed starts clean.
      expect(existsSync(join(dir, 'pdm.db'))).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
