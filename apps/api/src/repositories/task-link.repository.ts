import type { Knex } from 'knex';
import type { TaskLink } from '@pdm/shared';

/**
 * `task_links` queries (`FR-TASK-03`, `DATA-01`, `BR-04`).
 *
 * Queries and nothing else (ground rule 1). The 3-link limit, the slot
 * assignment and the refusals are `task-link.service.ts`; the trigger behind
 * this table enforces the same limit for writers who never call the service.
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type TaskLinkRow = TaskLink;

export interface NewTaskLinkRow {
  readonly uid: string;
  readonly task_id: number;
  readonly label: string;
  readonly url: string;
  readonly position: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

export type TaskLinkPatch = Partial<
  Pick<NewTaskLinkRow, 'label' | 'url' | 'position' | 'updated_at' | 'archived_at'>
>;

export interface TaskLinkRepository {
  insert(row: NewTaskLinkRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<TaskLinkRow | null>;
  /** A task's links in slot order: position, then id. */
  listByTask(taskId: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<TaskLinkRow[]>;
  /** Positions held by live links. The service assigns the smallest free slot. */
  livePositions(taskId: number, executor?: Executor): Promise<number[]>;
  patch(id: number, patch: TaskLinkPatch, executor?: Executor): Promise<boolean>;
}

export function createTaskLinkRepository(knex: Knex): TaskLinkRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  const scope = (query: Knex.QueryBuilder, includeArchived: boolean | undefined): Knex.QueryBuilder =>
    includeArchived === true ? query : query.whereNull('archived_at');

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(row).into('task_links');

      // Read back through the unique `uid`: no driver-specific `returning()`
      // shape to trust, as in every other repository in this project.
      const created = await runner.select('id').from('task_links').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Task link insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(
        run(executor).select('*').from('task_links').where({ id }),
        options?.includeArchived,
      ).first();
      return (row as TaskLinkRow | undefined) ?? null;
    },

    async listByTask(taskId, options, executor) {
      return scope(
        run(executor).select('*').from('task_links').where({ task_id: taskId }),
        options?.includeArchived,
      )
        .orderBy('position', 'asc')
        .orderBy('id', 'asc');
    },

    async livePositions(taskId, executor) {
      const rows = await run(executor)
        .select('position')
        .from('task_links')
        .where({ task_id: taskId })
        .whereNull('archived_at');
      return (rows as Array<{ position: number }>).map((row) => row.position);
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(patch).from('task_links').where({ id });
      return affected > 0;
    },
  };
}
