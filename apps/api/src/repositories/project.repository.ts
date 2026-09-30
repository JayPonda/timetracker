import type { Knex } from 'knex';
import type { Project } from '@pdm/shared';

/**
 * `projects` queries (`FR-PRJ-01`…`FR-PRJ-04`, ground rule 1).
 *
 * **This file holds queries and nothing else.** It does not know why a project is
 * archived, what may be edited, or when a refusal is owed — that is
 * `services/project.service.ts`. The separation is what lets a business rule be
 * tested without a database and a query be tested without a rule
 * (`D-25`).
 *
 * **There is no delete method, and there is no way to add one.** `projects` is
 * user data with a `BEFORE DELETE` trigger behind it (`DATA-10`), and removal is
 * archive (`FR-PRJ-04`, `BR-13`).
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type ProjectRow = Project;

export interface NewProjectRow {
  readonly uid: string;
  readonly name: string;
  readonly description: string;
  readonly colour: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

/** The editable fields, as a partial row. */
export type ProjectPatch = Partial<
  Pick<ProjectRow, 'name' | 'description' | 'colour' | 'updated_at' | 'archived_at'>
>;

export interface ProjectRepository {
  insert(row: NewProjectRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: FindOptions, executor?: Executor): Promise<ProjectRow | null>;
  findByUid(uid: string, options?: FindOptions, executor?: Executor): Promise<ProjectRow | null>;
  list(options?: FindOptions, executor?: Executor): Promise<ProjectRow[]>;
  /** Partial update. Returns whether a row was matched, so a missing row is visible. */
  patch(id: number, patch: ProjectPatch, executor?: Executor): Promise<boolean>;
}

/**
 * Whether archived rows are visible.
 *
 * **The filter is a parameter with a safe default, not something each call site
 * remembers** (ground rule 9). `includeArchived: false` is what `DATA-11`
 * requires for default lists and pickers, and a query written without the clause
 * leaks archived rows into a picker the moment someone forgets it.
 */
export interface FindOptions {
  readonly includeArchived?: boolean;
}

export function createProjectRepository(knex: Knex): ProjectRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  /** Applies the `DATA-11` filter. Every read in this file goes through it. */
  const scope = (query: Knex.QueryBuilder, options: FindOptions | undefined): Knex.QueryBuilder =>
    options?.includeArchived === true ? query : query.whereNull('archived_at');

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(row).into('projects');

      // Read the id back through the row's unique `uid` rather than trusting a
      // driver-specific `returning()` shape. Knex does not return the same value
      // for every client, and an id read wrong here becomes an activity-log row
      // for entity NaN — a history entry that points at nothing.
      const created = await runner.select('id').from('projects').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Project insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(run(executor).select('*').from('projects').where({ id }), options)
        .first();
      return (row as ProjectRow | undefined) ?? null;
    },

    async findByUid(uid, options, executor) {
      const row = await scope(run(executor).select('*').from('projects').where({ uid }), options)
        .first();
      return (row as ProjectRow | undefined) ?? null;
    },

    async list(options, executor) {
      // By name, then id, so the order is total. Sorting by `name` alone leaves
      // two projects called "Review" in an order the database is free to change
      // between two requests, which makes a list that reorders itself on refresh.
      return scope(run(executor).select('*').from('projects'), options)
        .orderBy('name', 'asc')
        .orderBy('id', 'asc');
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(patch).from('projects').where({ id });
      return affected > 0;
    },
  };
}
