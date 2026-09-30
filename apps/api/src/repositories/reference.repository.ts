import type { Knex } from 'knex';
import type { Reference } from '@pdm/shared';

/**
 * `reference_materials` queries (`FR-REF-01`, `FR-REF-02`, `FR-REF-05`).
 *
 * Queries and nothing else (ground rule 1).
 *
 * **References outlive their task by doing nothing.** No cascade, no delete,
 * no task-state check on read: an archived or ended task's references stay
 * exactly where they are (`FR-REF-05`). The only rule here is the archived
 * filter on the list itself.
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type ReferenceRow = Reference;

export interface NewReferenceRow {
  readonly uid: string;
  readonly task_id: number | null;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly type: Reference['type'];
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

export type ReferencePatch = Partial<
  Pick<NewReferenceRow, 'title' | 'body' | 'url' | 'type' | 'updated_at' | 'archived_at'>
>;

export interface ReferenceRepository {
  insert(row: NewReferenceRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<ReferenceRow | null>;
  /** A task's references, newest first — a person reads from the present. */
  listByTask(taskId: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<ReferenceRow[]>;
  patch(id: number, patch: ReferencePatch, executor?: Executor): Promise<boolean>;
}

export function createReferenceRepository(knex: Knex): ReferenceRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  const scope = (query: Knex.QueryBuilder, includeArchived: boolean | undefined): Knex.QueryBuilder =>
    includeArchived === true ? query : query.whereNull('archived_at');

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(row).into('reference_materials');

      // Read back through the unique `uid`, as in every other repository.
      const created = await runner.select('id').from('reference_materials').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Reference insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(
        run(executor).select('*').from('reference_materials').where({ id }),
        options?.includeArchived,
      ).first();
      return (row as ReferenceRow | undefined) ?? null;
    },

    async listByTask(taskId, options, executor) {
      return scope(
        run(executor).select('*').from('reference_materials').where({ task_id: taskId }),
        options?.includeArchived,
      )
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc');
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(patch).from('reference_materials').where({ id });
      return affected > 0;
    },
  };
}
