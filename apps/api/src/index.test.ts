import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database as Db } from 'better-sqlite3';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { assertSchemaReady, SchemaNotReadyError } from './index.js';

/**
 * The migrator container owns applying migrations; the server only refuses to
 * run against a schema that is behind (ADR 0001, ADR 0009).
 */

let root: string;
let counter = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdm-ready-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function freshDb(): Db {
  counter += 1;
  return openDb({ file: join(root, `pdm-${String(counter)}.db`) });
}

describe('DEP-09: the server refuses to run against an un-migrated schema', () => {
  it('throws when migrations are pending, and names them', () => {
    const db = freshDb();

    try {
      assertSchemaReady(db);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaNotReadyError);
      const err = error as SchemaNotReadyError;
      expect(err.pending.length).toBeGreaterThan(0);
      // The message must name every migration that still has to run. Which
      // migrations those are comes from the ledger rather than from a list
      // written here, so adding a migration cannot quietly stop this test from
      // checking that it is named.
      for (const p of err.pending) {
        expect(err.message).toContain(`${String(p.version).padStart(4, '0')}_${p.name}`);
      }
    }
    db.close();
  });

  it('says how to fix it, rather than only what is wrong', () => {
    // The message is what the owner reads when a container refuses to start.
    const db = freshDb();
    expect(() => assertSchemaReady(db)).toThrow(/pnpm --filter api migrate/);
    db.close();
  });

  it('passes once the migrator has run', async () => {
    const db = freshDb();
    await migrate(db, { backupDir: join(root, 'backups') });

    const status = assertSchemaReady(db);
    expect(status.pending).toHaveLength(0);
    expect(status.applied.length).toBeGreaterThan(0);
    db.close();
  });

  it('is a check, not a second migration: refusing changes nothing', async () => {
    // The whole point of the split. A refused boot must leave the schema exactly
    // as the migrator left it, with nothing applied and no rows written.
    const db = freshDb();
    await migrate(db, { backupDir: join(root, 'backups') });
    const before = db.prepare('SELECT COUNT(*) AS n FROM knex_migrations').get() as { n: number };

    expect(() => assertSchemaReady(db)).not.toThrow();

    const after = db.prepare('SELECT COUNT(*) AS n FROM knex_migrations').get() as { n: number };
    expect(after.n).toBe(before.n);
    db.close();
  });
});
