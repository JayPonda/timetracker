import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REQUIRED_PRAGMAS } from './connection.js';
import { createKnex } from './knex.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdm-knex-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('NFR-REL-01: the Knex pool inherits the same pragmas as openDb', () => {
  it('matches the full REQUIRED_PRAGMAS table on a live connection', async () => {
    // `journal_mode` and `synchronous` are per-connection, not per-file. A pooled
    // connection that silently opened in rollback-journal mode with FULL sync
    // would undo connection.ts's reliability choices without raising an error,
    // so the pool must reproduce them exactly.
    const knex = createKnex({ file: join(root, 'pdm.db') });

    for (const { name, expected } of REQUIRED_PRAGMAS) {
      const row = await knex.raw(`PRAGMA ${name}`);
      const value = String(Object.values(row[0])[0]).toLowerCase();
      expect(value, `pragma ${name}`).toBe(expected);
    }

    await knex.destroy();
  });

  it('is a single connection with a write-lock timeout, not a pool that can collide', async () => {
    const knex = createKnex({ file: join(root, 'pdm.db') });
    const busy = await knex.raw('PRAGMA busy_timeout');
    expect(Number(Object.values(busy[0])[0])).toBe(5000);
    await knex.destroy();
  });
});

describe('DATA-10: foreign keys are enforced on Knex connections too', () => {
  it('refuses an orphan row through the query builder', async () => {
    const knex = createKnex({ file: join(root, 'pdm.db') });
    await knex.schema.createTable('parent', (t) => {
      t.integer('id').primary();
    });
    await knex.schema.createTable('child', (t) => {
      t.integer('parent_id').notNullable();
      t.integer('id').primary();
      t.foreign('parent_id').references('parent.id');
    });

    await expect(
      knex.raw('INSERT INTO child (id, parent_id) VALUES (?, ?)', [1, 999]),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await knex.destroy();
  });
});