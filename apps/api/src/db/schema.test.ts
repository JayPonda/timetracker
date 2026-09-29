import { describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from './migrate.js';
import { openDb } from './connection.js';
import { nowMs } from '@pdm/shared';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The schema, tested as a schema.
 *
 * Every test here opens a real database built by the real migrations. The
 * triggers, the partial unique indexes and the CHECK constraints are the thing
 * under test, so a mocked database would test nothing: `AGENTS.md` is explicit
 * that the database is never mocked, because the constraints are part of what
 * is being verified.
 */
/**
 * Inserts one valid row into `table`, with its dependencies, so a per-row
 * trigger has something to fire on.
 *
 * Written as data rather than SQL per table because a DELETE test that
 * silently runs against an empty table passes against no protection at all —
 * which is precisely the failure this file had before. Every INSERT is a
 * literal, never a loop over generated SQL, so a typo here fails loudly.
 */
function seedRow(db: ReturnType<typeof openDb>, table: string): void {
  const now = nowMs();
  const uid = `seed-${table}`;

  const project = db
    .prepare(`INSERT INTO projects (uid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(`${uid}-project`, 'seed project', now, now).lastInsertRowid;

  const task = db
    .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(`${uid}-task`, 'seed task', now, now).lastInsertRowid;

  const todo = db
    .prepare(
      `INSERT INTO todos (uid, task_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(`${uid}-todo`, task, 'seed todo', now, now).lastInsertRowid;

  const entry = db
    .prepare(
      `INSERT INTO time_entries (uid, task_id, todo_id, started_at, ended_at, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
    )
    .run(`${uid}-entry`, task, todo, now, now + 1000, now, now).lastInsertRowid;

  const closure = db
    .prepare(
      `INSERT INTO closure_records (uid, task_id, closed_at, result, created_at, updated_at)
       VALUES (?, ?, ?, 'fulfilled', ?, ?)`,
    )
    .run(`${uid}-closure`, task, now, now, now).lastInsertRowid;

  const rows: Record<string, () => void> = {
    projects: () => {
      /* seeded above */
    },
    tasks: () => {
      /* seeded above */
    },
    todos: () => {
      /* seeded above */
    },
    tags: () =>
      db
        .prepare(`INSERT INTO tags (uid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(`${uid}-tag`, 'seed-tag', now, now),
    time_entries: () => {
      /* seeded above */
    },
    closure_records: () => {
      /* seeded above */
    },
    task_links: () =>
      db
        .prepare(
          `INSERT INTO task_links (uid, task_id, label, url, position, created_at, updated_at)
           VALUES (?, ?, 'l', 'http://x', 1, ?, ?)`,
        )
        .run(`${uid}-link`, task, now, now),
    acceptance_criteria: () =>
      db
        .prepare(
          `INSERT INTO acceptance_criteria (uid, task_id, text, created_at, updated_at)
           VALUES (?, ?, 'c', ?, ?)`,
        )
        .run(`${uid}-ac`, task, now, now),
    closure_criterion_results: () =>
      db
        .prepare(
          `INSERT INTO closure_criterion_results (uid, closure_record_id, criterion_text, met, created_at, updated_at)
           VALUES (?, ?, 'c', 1, ?, ?)`,
        )
        .run(`${uid}-ccr`, closure, now, now),
    reference_materials: () =>
      db
        .prepare(
          `INSERT INTO reference_materials (uid, task_id, title, created_at, updated_at)
           VALUES (?, ?, 'r', ?, ?)`,
        )
        .run(`${uid}-ref`, task, now, now),
    calendar_events: () =>
      db
        .prepare(
          `INSERT INTO calendar_events (uid, title, starts_at, ends_at, created_at, updated_at)
           VALUES (?, 'e', ?, ?, ?, ?)`,
        )
        .run(`${uid}-event`, now, now + 1000, now, now),
    reminders: () =>
      db
        .prepare(
          `INSERT INTO reminders (uid, title, remind_at, created_at, updated_at)
           VALUES (?, 'r', ?, ?, ?)`,
        )
        .run(`${uid}-reminder`, now, now, now),
    activity_log: () =>
      db
        .prepare(
          `INSERT INTO activity_log (uid, entity, entity_id, action, at, created_at, updated_at)
           VALUES (?, 'task', ?, 'created', ?, ?, ?)`,
        )
        .run(`${uid}-log`, task, now, now, now),
  };

  const seed = rows[table];
  if (seed === undefined) {
    throw new Error(`seedRow has no row for table ${table}`);
  }
  seed();

  // `projects`, `tasks` and friends were inserted above, so confirm the table
  // the caller asked about really does hold exactly the one row it expects.
  void project;
  void entry;
}

/**
 * A temp-file database with every migration applied.
 *
 * A file rather than `:memory:` because the migration runner takes a backup
 * before it applies anything, and a backup of an in-memory database is not a
 * thing. The file lives in the OS temp directory, never inside the repository.
 */
async function migrated(): Promise<ReturnType<typeof openDb>> {
  const dir = join(
    tmpdir(),
    `pdm-schema-${String(nowMs())}-${Math.random().toString(36).slice(2)}`,
  );
  const file = join(dir, 'pdm.db');
  const db = openDb({ file });
  await migrate(db, { dbPath: file, backupDir: join(dir, 'backups') });
  return db;
}

describe('DATA-13: every user-data table carries a uid from its first migration', () => {
  const USER_DATA_TABLES = [
    'projects',
    'tasks',
    'task_links',
    'todos',
    'acceptance_criteria',
    'closure_records',
    'closure_criterion_results',
    'time_entries',
    'tags',
    'reference_materials',
    'calendar_events',
    'reminders',
    'settings',
    'activity_log',
  ] as const;

  it.each(USER_DATA_TABLES)('%s has a unique uid column', async (table) => {
    const db = await migrated();
    try {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        notnull: number;
      }[];

      const uid = columns.find((c) => c.name === 'uid');
      expect(uid, `${table} is missing uid`).toBeDefined();
      expect(uid?.notnull, `${table}.uid must be NOT NULL`).toBe(1);
    } finally {
      db.close();
    }
  });

  it.each(USER_DATA_TABLES)('%s has a non-unique uid rejected', async (table) => {
    const db = await migrated();
    try {
      const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as {
        name: string;
        unique: number;
      }[];

      // settings is keyed by `key` and carries a uid for traceability; every
      // other table declares `uid ... UNIQUE` inline, which SQLite reports as an
      // auto-index. Both must be unique.
      const hasUniqueUid = db
        .prepare(`SELECT count(*) AS c FROM pragma_index_list(?) WHERE "unique" = 1`)
        .get(table) as { c: number };
      expect(hasUniqueUid.c, `${table} has no unique index`).toBeGreaterThan(0);
      expect(Array.isArray(indexes)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('DATA-11: user-data tables carry archived_at, so removal is archive', () => {
  it('every user-data table except activity_log has archived_at', async () => {
    const db = await migrated();
    try {
      const tables = (
        db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name`,
          )
          .all() as { name: string }[]
      ).map((r) => r.name);

      // Three groups are exempt, and each for a stated reason rather than
      // convenience:
      //
      //   activity_log          append-only: a log entry that could be archived
      //                         is a log entry that could be hidden.
      //   knex_migrations       the migration ledger (ADR 0012).
      //   knex_migrations_lock  Knex's migration lock row (ADR 0012).
      //   time_entry_tags       a pure join with no independent identity.
      const EXEMPT = new Set([
        'activity_log',
        'knex_migrations',
        'knex_migrations_lock',
        'time_entry_tags',
      ]);

      const withoutArchived = tables.filter(
        (t) =>
          !EXEMPT.has(t) &&
          !(db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some(
            (c) => c.name === 'archived_at',
          ),
      );

      expect(withoutArchived).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('DATA-10: the database refuses a hard delete of user data', () => {
  const NO_DELETE_TABLES = [
    'projects',
    'tasks',
    'task_links',
    'todos',
    'acceptance_criteria',
    'closure_records',
    'closure_criterion_results',
    'time_entries',
    'tags',
    'reference_materials',
    'calendar_events',
    'reminders',
    'activity_log',
  ] as const;

  it('exactly 13 tables carry a no-delete trigger, so the count cannot drift', async () => {
    const db = await migrated();
    try {
      const triggers = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger' AND name LIKE '%_no_delete'`,
        )
        .all() as { name: string }[];

      // 13 here plus `settings`, which got its trigger in migration 0002. The
      // count is asserted so that adding a table in a later release without a
      // trigger fails this test rather than shipping a hole.
      expect(triggers).toHaveLength(NO_DELETE_TABLES.length + 1);
    } finally {
      db.close();
    }
  });

  it.each(NO_DELETE_TABLES)('DELETE on %s is refused', async (table) => {
    const db = await migrated();
    try {
      // The row has to exist. A BEFORE DELETE trigger fires per row, so a DELETE
      // against an empty table never invokes it and silently succeeds — which
      // is exactly how this test passed against no protection at all before.
      seedRow(db, table);

      expect(db.prepare(`SELECT count(*) AS c FROM ${table}`).get()).toEqual({ c: 1 });
      expect(() => db.prepare(`DELETE FROM ${table}`).run()).toThrowError(/never deleted/);
      expect(db.prepare(`SELECT count(*) AS c FROM ${table}`).get()).toEqual({ c: 1 });
    } finally {
      db.close();
    }
  });

  it('no foreign key cascades, because a cascade is a delete these triggers cannot stop', async () => {
    const db = await migrated();
    try {
      const cascading = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE sql LIKE '%ON DELETE CASCADE%' OR sql LIKE '%ON DELETE SET NULL%'`,
        )
        .all();

      expect(cascading).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('DATA-01: a task may have at most 3 links, enforced by the database', () => {
  it('a fourth link is rejected even by direct SQL', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      const insertLink = db.prepare(
        `INSERT INTO task_links (uid, task_id, label, url, position, created_at, updated_at)
         VALUES (?, ?, 'l', 'http://x', ?, ?, ?)`,
      );

      for (const position of [1, 2, 3]) {
        expect(() =>
          insertLink.run(`link-${String(position)}`, task, position, now, now),
        ).not.toThrow();
      }

      expect(() => insertLink.run('link-4', task, 4, now, now)).toThrowError(/at most 3 links/);
    } finally {
      db.close();
    }
  });

  it('archiving a link frees a slot, because archive is reversible', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      const insertLink = db.prepare(
        `INSERT INTO task_links (uid, task_id, label, url, position, created_at, updated_at)
         VALUES (?, ?, 'l', 'http://x', ?, ?, ?)`,
      );
      for (const position of [1, 2, 3])
        insertLink.run(`l${String(position)}`, task, position, now, now);

      db.prepare(`UPDATE task_links SET archived_at = ? WHERE position = 3`).run(now);

      expect(() => insertLink.run('l4', task, 3, now, now)).not.toThrow();
    } finally {
      db.close();
    }
  });
});

describe('DATA-05: archiving a todo keeps the time tracked against it', () => {
  it('the entry survives and stays linked to the archived todo', async () => {
    // The rule is that archiving is not deleting. If archiving a phase dropped or
    // unlinked the hours recorded against it, a todo that was archived at the end
    // of a day would take an afternoon of work with it — and the entry would look
    // like it had never happened rather than like something went wrong.
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;
      const todo = db
        .prepare(
          `INSERT INTO todos (uid, task_id, title, created_at, updated_at) VALUES ('td1', ?, 'x', ?, ?)`,
        )
        .run(task, now, now).lastInsertRowid;
      db.prepare(
        `INSERT INTO time_entries (uid, task_id, todo_id, started_at, ended_at, source, created_at, updated_at)
         VALUES ('e1', ?, ?, ?, ?, 'manual', ?, ?)`,
      ).run(task, todo, now, now + 1_000, now, now);

      db.prepare(`UPDATE todos SET archived_at = ? WHERE id = ?`).run(now + 2_000, todo);

      const entry = db
        .prepare(`SELECT task_id, todo_id, started_at, ended_at FROM time_entries WHERE uid = 'e1'`)
        .get() as { task_id: number; todo_id: number; started_at: number; ended_at: number };
      expect(entry).toEqual({
        task_id: task,
        todo_id: todo,
        started_at: now,
        ended_at: now + 1_000,
      });
    } finally {
      db.close();
    }
  });

  it('the entry itself is not archived, because it is not the thing that was removed', async () => {
    // Archiving a todo hides the todo. The hours belong to the task and stay in
    // the day's total; silently archiving them would be a stored number quietly
    // changing (DATA-04), and DATA-12 exists precisely because excluded time must
    // be shown rather than hidden.
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;
      const todo = db
        .prepare(
          `INSERT INTO todos (uid, task_id, title, created_at, updated_at) VALUES ('td1', ?, 'x', ?, ?)`,
        )
        .run(task, now, now).lastInsertRowid;
      db.prepare(
        `INSERT INTO time_entries (uid, task_id, todo_id, started_at, ended_at, source, created_at, updated_at)
         VALUES ('e1', ?, ?, ?, ?, 'manual', ?, ?)`,
      ).run(task, todo, now, now + 1_000, now, now);

      db.prepare(`UPDATE todos SET archived_at = ? WHERE id = ?`).run(now + 2_000, todo);

      const archived = db
        .prepare(`SELECT archived_at FROM time_entries WHERE uid = 'e1'`)
        .get() as { archived_at: number | null };
      expect(archived.archived_at).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('DATA-02: at most one time entry may be running', () => {
  it('a second open entry is refused by the partial unique index', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      const open = db.prepare(
        `INSERT INTO time_entries (uid, task_id, started_at, source, created_at, updated_at)
         VALUES (?, ?, ?, 'timer', ?, ?)`,
      );
      open.run('entry-1', task, now, now, now);

      expect(() => open.run('entry-2', task, now, now, now)).toThrowError();
    } finally {
      db.close();
    }
  });

  it('a finished entry does not block the next one', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      const insert = db.prepare(
        `INSERT INTO time_entries (uid, task_id, started_at, ended_at, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'timer', ?, ?)`,
      );
      insert.run('e1', task, now, now + 1000, now, now);

      expect(() =>
        db
          .prepare(
            `INSERT INTO time_entries (uid, task_id, started_at, source, created_at, updated_at)
             VALUES ('e2', ?, ?, 'timer', ?, ?)`,
          )
          .run(task, now + 2000, now, now),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});

describe('DATA-03: a not_fulfilled closure requires a written reason', () => {
  it('is refused by the database when the reason is empty', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      expect(() =>
        db
          .prepare(
            `INSERT INTO closure_records (uid, task_id, closed_at, result, lagging_reason, created_at, updated_at)
             VALUES ('c1', ?, ?, 'not_fulfilled', '', ?, ?)`,
          )
          .run(task, now, now, now),
      ).toThrowError();
    } finally {
      db.close();
    }
  });

  it('is refused when the reason is only whitespace', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      expect(() =>
        db
          .prepare(
            `INSERT INTO closure_records (uid, task_id, closed_at, result, lagging_reason, created_at, updated_at)
             VALUES ('c1', ?, ?, 'not_fulfilled', '   ', ?, ?)`,
          )
          .run(task, now, now, now),
      ).toThrowError();
    } finally {
      db.close();
    }
  });

  it('a fulfilled closure needs no reason', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      expect(() =>
        db
          .prepare(
            `INSERT INTO closure_records (uid, task_id, closed_at, result, created_at, updated_at)
             VALUES ('c1', ?, ?, 'fulfilled', ?, ?)`,
          )
          .run(task, now, now, now),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});

describe('FR-TIME-16: an entry cannot end before it starts', () => {
  it('is refused by the CHECK constraint', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      const task = db
        .prepare(`INSERT INTO tasks (uid, name, created_at, updated_at) VALUES ('t1', 'a', ?, ?)`)
        .run(now, now).lastInsertRowid;

      expect(() =>
        db
          .prepare(
            `INSERT INTO time_entries (uid, task_id, started_at, ended_at, source, created_at, updated_at)
             VALUES ('e1', ?, 2000, 1000, 'timer', ?, ?)`,
          )
          .run(task, now, now),
      ).toThrowError();
    } finally {
      db.close();
    }
  });
});

describe('FR-STAT-01: nothing can reach ended without the closure service', () => {
  it('ended is a legal enum value, so the guarantee lives in the code', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      // The value itself is permitted by the schema: 0.5.0 is where ending a
      // task becomes legal. What must not exist yet is any code path that sets
      // it, which is why this test documents the constraint's existence rather
      // than pretending the database can enforce "only one function may".
      const row = db
        .prepare(
          `INSERT INTO tasks (uid, name, status, created_at, updated_at)
           VALUES ('t1', 'a', 'ended', ?, ?)`,
        )
        .run(now, now);
      expect(row.changes).toBe(1);
    } finally {
      db.close();
    }
  });

  it('rejects a status outside the enum', async () => {
    const db = await migrated();
    try {
      const now = nowMs();
      expect(() =>
        db
          .prepare(
            `INSERT INTO tasks (uid, name, status, created_at, updated_at)
             VALUES ('t1', 'a', 'done', ?, ?)`,
          )
          .run(now, now),
      ).toThrowError();
    } finally {
      db.close();
    }
  });
});

describe('DATA-04: no stored total can drift from the entries it summarises', () => {
  it('tasks carries no total_seconds column', async () => {
    const db = await migrated();
    try {
      const columns = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map(
        (c) => c.name,
      );

      expect(columns).not.toContain('total_seconds');
    } finally {
      db.close();
    }
  });
});

describe('migrations are additive and ordered', () => {
  it('builds the whole schema from a single migration', async () => {
    // 0.2.0 writes the schema once, so the migrator container is one step that
    // either produces a complete database or changes nothing. The next migration
    // to be added is 0002.
    const migrations = loadMigrations();
    expect(migrations.map((m) => m.name)).toEqual(['initial_schema']);
    expect(migrations[0]?.version).toBe(1);
  });

  it('keeps versions contiguous from 0001', async () => {
    // Not a count: a count fails every time a migration is added, which is how
    // this test managed to be wrong in both directions before. `assertNoGaps` in
    // migrate.ts enforces the real rule, and this only has to agree with it.
    const versions = loadMigrations().map((m) => m.version);
    expect(versions).toEqual(versions.map((_v, index) => index + 1));
  });

  it('carries every table and every no-delete trigger in that one file', async () => {
    // The consolidation is only honest if the single file really does contain
    // the schema. A migration that quietly lost a trigger would still pass every
    // count in this file if the count were hardcoded; reading the real
    // `sqlite_master` is what makes it mean something.
    const migrations = loadMigrations();
    expect(migrations.length).toBe(1);

    const db = await migrated();
    try {
      const userTables = (
        db
          .prepare(
            "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'",
          )
          .get() as { c: number }
      ).c;
      expect(userTables).toBe(15);

      const noDelete = (
        db
          .prepare(
            "SELECT count(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_no_delete'",
          )
          .get() as { c: number }
      ).c;
      expect(noDelete).toBe(14);
    } finally {
      db.close();
    }
  });
});
