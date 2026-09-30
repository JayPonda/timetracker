import type { Knex } from 'knex';
import type { Criterion } from '@pdm/shared';

/**
 * `acceptance_criteria` queries (`FR-AC-01`).
 *
 * Queries and nothing else (ground rule 1). The order rule and the refusals
 * are `criterion.service.ts`.
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type CriterionRow = Criterion;

export interface NewCriterionRow {
  readonly uid: string;
  readonly task_id: number;
  readonly text: string;
  readonly position: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

export type CriterionPatch = Partial<
  Pick<NewCriterionRow, 'text' | 'position' | 'updated_at' | 'archived_at'>
>;

export interface CriterionRepository {
  insert(row: NewCriterionRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<CriterionRow | null>;
  /** A task's criteria in definition order: position, then id. */
  listByTask(taskId: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<CriterionRow[]>;
  /** Highest live position on the task, or -1 when it has no live criteria. */
  maxPosition(taskId: number, executor?: Executor): Promise<number>;
  patch(id: number, patch: CriterionPatch, executor?: Executor): Promise<boolean>;
}

export function createCriterionRepository(knex: Knex): CriterionRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  const scope = (query: Knex.QueryBuilder, includeArchived: boolean | undefined): Knex.QueryBuilder =>
    includeArchived === true ? query : query.whereNull('archived_at');

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(row).into('acceptance_criteria');

      // Read back through the unique `uid`, as in every other repository.
      const created = await runner.select('id').from('acceptance_criteria').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Criterion insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(
        run(executor).select('*').from('acceptance_criteria').where({ id }),
        options?.includeArchived,
      ).first();
      return (row as CriterionRow | undefined) ?? null;
    },

    async listByTask(taskId, options, executor) {
      return scope(
        run(executor).select('*').from('acceptance_criteria').where({ task_id: taskId }),
        options?.includeArchived,
      )
        .orderBy('position', 'asc')
        .orderBy('id', 'asc');
    },

    async maxPosition(taskId, executor) {
      const row = await run(executor)
        .max<{ max: number | null }[]>({ max: 'position' })
        .from('acceptance_criteria')
        .where({ task_id: taskId })
        .whereNull('archived_at')
        .first();
      return row?.max ?? -1;
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(patch).from('acceptance_criteria').where({ id });
      return affected > 0;
    },
  };
}
