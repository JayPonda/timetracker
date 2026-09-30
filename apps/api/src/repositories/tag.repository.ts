import type { Knex } from 'knex';
import type { Tag } from '@pdm/shared';

/**
 * `tags` queries (`FR-TAG-01`, `FR-TAG-05`).
 *
 * Queries and nothing else (ground rule 1). Name clashes and the refusals are
 * `tag.service.ts`.
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type TagRow = Tag;

export interface NewTagRow {
  readonly uid: string;
  readonly name: string;
  readonly colour: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

export type TagPatch = Partial<Pick<NewTagRow, 'name' | 'colour' | 'updated_at' | 'archived_at'>>;

export interface TagRepository {
  insert(row: NewTagRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: { includeArchived?: boolean }, executor?: Executor): Promise<TagRow | null>;
  /** A live tag by exact name. Names match exactly, not fuzzily. */
  findLiveByName(name: string, executor?: Executor): Promise<TagRow | null>;
  /** By name, the whole list, except the one being renamed. */
  list(options?: { includeArchived?: boolean }, executor?: Executor): Promise<TagRow[]>;
  patch(id: number, patch: TagPatch, executor?: Executor): Promise<boolean>;
}

export function createTagRepository(knex: Knex): TagRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  const scope = (query: Knex.QueryBuilder, includeArchived: boolean | undefined): Knex.QueryBuilder =>
    includeArchived === true ? query : query.whereNull('archived_at');

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(row).into('tags');

      // Read back through the unique `uid`, as in every other repository.
      const created = await runner.select('id').from('tags').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Tag insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(
        run(executor).select('*').from('tags').where({ id }),
        options?.includeArchived,
      ).first();
      return (row as TagRow | undefined) ?? null;
    },

    async findLiveByName(name, executor) {
      const row = await run(executor)
        .select('*')
        .from('tags')
        .where({ name })
        .whereNull('archived_at')
        .first();
      return (row as TagRow | undefined) ?? null;
    },

    async list(options, executor) {
      // By name, then id: the manager reads top to bottom, and the order must
      // be total so it does not reshuffle on refresh.
      return scope(run(executor).select('*').from('tags'), options?.includeArchived)
        .orderBy('name', 'asc')
        .orderBy('id', 'asc');
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(patch).from('tags').where({ id });
      return affected > 0;
    },
  };
}
