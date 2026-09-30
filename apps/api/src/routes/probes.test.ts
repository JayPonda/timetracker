import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { runProbe } from './probes.js';

/**
 * The shared probe (ADR 0013).
 *
 * The point of this file is the **two facts, not one verdict**. A single
 * `ready: boolean` would have been shorter and would have forced one of the two
 * routes to answer a question it was not asked: pending migrations make the
 * process unable to serve, but do not make it unable to report that it is alive.
 */
const opened: Database[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A real database file, migrated or not. Never a mock: the pragmas matter. */
async function database({ migrated }: { migrated: boolean }): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), 'pdm-probe-'));
  dirs.push(dir);

  const db = openDb({ file: join(dir, 'pdm.db') });
  opened.push(db);

  if (migrated) await migrate(db);
  return db;
}

describe('ADR 0013: the probe reports two facts, not one verdict', () => {
  it('reports a reachable database and no pending migrations when migrated', async () => {
    const probe = runProbe(await database({ migrated: true }));

    expect(probe.dbOk).toBe(true);
    expect(probe.migrationsPending).toBe(0);
    expect(probe.dbError).toBeUndefined();
  });

  it('reports a reachable database with migrations pending when not migrated', async () => {
    // The case that forced the split: the process is up and answering, and it
    // is also unable to serve, because the app refuses to run against an
    // un-migrated schema. `/health` reports 200 here and `/ready` reports 503.
    const probe = runProbe(await database({ migrated: false }));

    expect(probe.dbOk).toBe(true);
    expect(probe.migrationsPending).toBeGreaterThan(0);
  });

  it('reports the database as unreachable rather than throwing', async () => {
    // A probe that throws takes the process down, and the whole point of asking
    // is to report the condition instead.
    const db = await database({ migrated: true });
    db.close();

    const probe = runProbe(db);

    expect(probe.dbOk).toBe(false);
    expect(probe.dbError).toBeTruthy();
  });

  it('counts no migrations applied when the database cannot be read', async () => {
    // Zero rather than a carried-over number: reporting "3 applied, 0 pending"
    // from a closed handle would read as a healthy schema.
    const db = await database({ migrated: true });
    db.close();

    const probe = runProbe(db);

    expect(probe.migrationsApplied).toBe(0);
    expect(probe.migrationsPending).toBe(0);
  });
});
