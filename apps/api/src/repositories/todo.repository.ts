import type { Knex } from 'knex';
import type { Todo } from '@pdm/shared';

/**
 * `todos` queries (`FR-TODO-01`, `FR-TODO-02`, `FR-PHASE-05`).
 *
 * Queries and nothing else (ground rule 1). What “done” means for `done_at`,
 * what an order must contain, and when a refusal is owed are
 * `todo.service.ts`.
 *
 * **The `done` flag is translated here, in one place.** The row holds `0`/`1`
 * because that is what the `CHECK` constraint can verify; the service holds a
 * boolean because that is what the owner means. A conversion repeated at every
 * call site is a conversion waiting to disagree with itself.
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type TodoRow = Todo;

interface TodoDbRow {
  readonly id: number;
  readonly uid: string;
  readonly task_id: number;
  readonly title: string;
  readonly note: string;
  readonly done: number;
  readonly done_at: number | null;
  readonly estimate_hours: number | null;
  readonly position: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

function toRow(db: TodoDbRow): TodoRow {
  return { ...db, done: db.done === 1 };
}

export interface NewTodoRow {
  readonly uid: string;
  readonly task_id: number;
  readonly title: string;
  readonly note: string;
  readonly done: boolean;
  readonly done_at: number | null;
  readonly estimate_hours: number | null;
  readonly position: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

export type TodoPatch = Partial<
  Pick<
    NewTodoRow,
    'title' | 'note' | 'done' | 'done_at' | 'estimate_hours' | 'position' | 'updated_at' | 'archived_at'
  >
>;

export interface TodoRepository {
  insert(row: NewTodoRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<TodoRow | null>;
  /** A task's todos in timeline order: position, then id. */
  listByTask(taskId: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<TodoRow[]>;
  /** Highest live position on the task, or -1 when it has no live todos. */
  maxPosition(taskId: number, executor?: Executor): Promise<number>;
  patch(id: number, patch: TodoPatch, executor?: Executor): Promise<boolean>;
}

export function createTodoRepository(knex: Knex): TodoRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  const scope = (query: Knex.QueryBuilder, includeArchived: boolean | undefined): Knex.QueryBuilder =>
    includeArchived === true ? query : query.whereNull('archived_at');

  const toDb = (patch: TodoPatch): Record<string, unknown> => ({
    ...patch,
    ...(patch.done === undefined ? {} : { done: patch.done ? 1 : 0 }),
  });

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(toDb(row)).into('todos');

      // Read back through the unique `uid`, as in the project and task
      // repositories: no driver-specific `returning()` shape to trust.
      const created = await runner.select('id').from('todos').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Todo insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(
        run(executor).select('*').from('todos').where({ id }),
        options?.includeArchived,
      ).first();
      return row === undefined ? null : toRow(row as TodoDbRow);
    },

    async listByTask(taskId, options, executor) {
      const rows = await scope(
        run(executor).select('*').from('todos').where({ task_id: taskId }),
        options?.includeArchived,
      )
        .orderBy('position', 'asc')
        .orderBy('id', 'asc');
      return (rows as TodoDbRow[]).map(toRow);
    },

    async maxPosition(taskId, executor) {
      const row = await run(executor)
        .max<{ max: number | null }[]>({ max: 'position' })
        .from('todos')
        .where({ task_id: taskId })
        .whereNull('archived_at')
        .first();
      return row?.max ?? -1;
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(toDb(patch)).from('todos').where({ id });
      return affected > 0;
    },
  };
}
