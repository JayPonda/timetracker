import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './connection.js';
import { loadMigrations, migrate, MigrationError, migrationStatus, seedSettings } from './migrate.js';

let root: string;
let backupDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdm-migrate-'));
  backupDir = join(root, 'backups');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function freshDb(name = 'pdm.db') {
  const file = join(root, name);
  const db = openDb({ file });
  return { db, file };
}

/**
 * Writes a minimal Knex migration for the runner tests. The runner only cares
 * that a migration is a `.js` module exporting `up` and `down`; the real
 * migrations also embed the schema SQL, but these tests run synthetic DDL.
 */
function writeMigration(dir: string, name: string, sql: string): void {
  mkdirSync(dir, { recursive: true });
  const body = [
    'export async function up(knex) {',
    '  const conn = await knex.client.acquireConnection();',
    '  try {',
    `    conn.transaction(() => { conn.exec(${JSON.stringify(sql)}); })();`,
    '  } finally {',
    '    await knex.client.releaseConnection(conn);',
    '  }',
    '}',
    'export async function down() {}',
    '',
  ].join('\n');
  writeFileSync(join(dir, name), body, 'utf8');
}

describe('DEP-09: migrations run in order at boot', () => {
  it('applies every migration on a clean database', async () => {
    const { db } = freshDb();
    const result = await migrate(db, { backupDir });

    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied.map((m) => m.version)).toEqual(
      result.applied.map((_, i) => i + 1),
    );
    db.close();
  });

  it('records each migration in the ledger', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });

    const rows = db.prepare('SELECT name FROM knex_migrations ORDER BY id').all();
    expect(rows.length).toBeGreaterThan(0);
    db.close();
  });
});

describe('DEP-09: running migrations again changes nothing', () => {
  it('is idempotent', async () => {
    // The owner restarts the container more than once; a boot must not reapply.
    const { db } = freshDb();
    await migrate(db, { backupDir });
    const before = db.prepare('SELECT COUNT(*) AS n FROM knex_migrations').get() as { n: number };

    const second = await migrate(db, { backupDir });

    expect(second.applied).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
    const after = db.prepare('SELECT COUNT(*) AS n FROM knex_migrations').get() as { n: number };
    expect(after.n).toBe(before.n);
    db.close();
  });
});

describe('DEP-09: a migration is transactional', () => {
  it('rolls back completely when a migration fails', async () => {
    // Half a schema is worse than no schema: the next boot cannot tell which
    // statements landed, so the error would surface far from its cause.
    const dir = join(root, 'bad-migrations');
    writeMigration(dir, '0001_first.js', 'CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT;');
    writeMigration(
      dir,
      '0002_broken.js',
      'CREATE TABLE second (id INTEGER PRIMARY KEY) STRICT; THIS IS NOT SQL;',
    );

    const { db } = freshDb();

    await expect(migrate(db, { backupDir, dir })).rejects.toThrow(MigrationError);

    // 0001 succeeded, so it stays recorded. 0002 failed, so neither its table nor
    // its ledger row exists: a half-applied migration is the thing to avoid.
    const applied = (
      db.prepare('SELECT name FROM knex_migrations ORDER BY id').all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(applied).toEqual(['0001_first.js']);

    const second = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'second'")
      .get();
    expect(second).toBeUndefined();
    db.close();
  });

  it('names the backup file in the error so the owner can recover', async () => {
    const dir = join(root, 'bad-migrations-2');
    writeMigration(dir, '0001_ok.js', 'CREATE TABLE ok (id INTEGER PRIMARY KEY) STRICT;');
    writeMigration(dir, '0002_bad.js', 'NOT VALID SQL AT ALL;');

    const { db, file } = freshDb();

    try {
      await migrate(db, { backupDir, dir, dbPath: file });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      const message = (error as MigrationError).message;
      expect(message).toContain('0002_bad');
      expect((error as MigrationError).backupPath).toBeDefined();
    }
    db.close();
  });
});

describe('DEP-09: a backup is taken before each migration', () => {
  it('writes a pre-migration snapshot into the backup directory', async () => {
    // Copying a WAL database by hand gives a torn file, so the runner uses the
    // online API. Without this, a bad migration is unrecoverable.
    const { db } = freshDb();
    await migrate(db, { backupDir });

    const files = readdirSync(join(backupDir, 'migrations'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f: string) => f.endsWith('.db'))).toBe(true);
    db.close();
  });
});

describe('NFR-MAINT-02: migration versions are contiguous', () => {
  it('rejects a gap, because a gap means a migration was deleted', async () => {
    const dir = join(root, 'gap');
    writeMigration(dir, '0001_one.js', 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;');
    writeMigration(dir, '0003_three.js', 'CREATE TABLE three (id INTEGER PRIMARY KEY) STRICT;');

    const { db } = freshDb();
    await expect(migrate(db, { backupDir, dir })).rejects.toThrow(/contiguous/i);
    db.close();
  });
});

describe('DEP-09: migrate:status reports applied and pending', () => {
  it('shows nothing pending after a full run', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });

    const status = migrationStatus(db);
    expect(status.pending).toHaveLength(0);
    expect(status.applied.length).toBeGreaterThan(0);
    db.close();
  });

  it('shows a pending migration on a clean database', () => {
    const { db } = freshDb();
    const status = migrationStatus(db);
    expect(status.pending.length).toBeGreaterThan(0);
    expect(status.applied).toHaveLength(0);
    db.close();
  });
});

describe('DATA-10: the no-delete trigger blocks a hard delete of settings', () => {
  it('refuses DELETE and points at the archive policy', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });
    seedSettings(db);

    expect(() => db.prepare('DELETE FROM settings').run()).toThrow(/never deleted/i);

    const row = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(row.n).toBeGreaterThan(0);
    db.close();
  });

  it('allows archiving instead', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });
    seedSettings(db);

    db.prepare('UPDATE settings SET archived_at = 1 WHERE key = ?').run('theme');
    const row = db.prepare('SELECT archived_at FROM settings WHERE key = ?').get('theme') as {
      archived_at: number | null;
    };
    expect(row.archived_at).toBe(1);
    db.close();
  });
});

describe('0.1.0: settings defaults are written on first boot', () => {
  it('writes the defaults', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });
    seedSettings(db);

    const keys = (db.prepare('SELECT key FROM settings ORDER BY key').all() as Array<{ key: string }>).map(
      (r) => r.key,
    );
    expect(keys).toContain('time_zone');
    expect(keys).toContain('theme');
    db.close();
  });

  it('is idempotent, so it is safe on every boot', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });

    expect(seedSettings(db)).toBeGreaterThan(0);
    expect(seedSettings(db)).toBe(0);
    db.close();
  });

  it('gives every row a uid, so a future export can merge it', async () => {
    const { db } = freshDb();
    await migrate(db, { backupDir });
    seedSettings(db);

    const row = db.prepare('SELECT uid FROM settings LIMIT 1').get() as { uid: string };
    expect(row.uid).toMatch(/^[0-9a-f-]{36}$/i);
    db.close();
  });
});

describe('NFR-MAINT-02: the migration files themselves are auditable', () => {
  it('are Knex migrations with the schema SQL embedded, in numeric order', async () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    for (const [index, m] of migrations.entries()) {
      expect(m.version).toBe(index + 1);
      const module = (await import(pathToFileURL(m.path).href)) as {
        up: unknown;
        down: unknown;
      };
      expect(typeof module.up).toBe('function');
      expect(typeof module.down).toBe('function');
      const source = readFileSync(m.path, 'utf8');
      expect(source).toMatch(/CREATE (TABLE|TRIGGER|INDEX)/);
    }
  });
});
