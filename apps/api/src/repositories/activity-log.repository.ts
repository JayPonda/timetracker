import type { Knex } from 'knex';

/**
 * `activity_log` queries (criterion 13, `FR-STAT-05`).
 *
 * **This file holds queries and nothing else.** It does not decide what counts
 * as a change, what an action is called, or when to write — that is
 * `services/activity-log.service.ts`. Keeping the diff logic out of here is what
 * lets the rule be tested without a database and the query be tested without a
 * rule (AGENTS.md ground rule 1, `D-25`).
 */

export type ActivityEntity =
  | 'project'
  | 'task'
  | 'todo'
  | 'acceptance_criterion'
  | 'closure_record'
  | 'time_entry'
  | 'tag'
  | 'reference_material'
  | 'calendar_event'
  | 'reminder'
  | 'setting';

export interface ActivityLogRow {
  readonly id: number;
  readonly uid: string;
  readonly entity: string;
  readonly entity_id: number;
  readonly action: string;
  readonly before_json: string | null;
  readonly after_json: string | null;
  readonly at: number;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface NewActivityLogRow {
  readonly uid: string;
  readonly entity: string;
  readonly entity_id: number;
  readonly action: string;
  readonly before_json: string | null;
  readonly after_json: string | null;
  readonly at: number;
  readonly created_at: number;
  readonly updated_at: number;
}

/**
 * A Knex executor: the pool, or a transaction.
 *
 * The service owns the transaction and passes its handle in, because an activity
 * log entry that commits separately from the change it describes is worse than no
 * log at all — it records something that did not happen, or a change with no
 * record of it.
 */
export type Executor = Knex | Knex.Transaction;

export interface ActivityLogRepository {
  insert(row: NewActivityLogRow, executor?: Executor): Promise<number>;
  listForEntity(entity: string, entityId: number, executor?: Executor): Promise<ActivityLogRow[]>;
  listSince(atMs: number, executor?: Executor): Promise<ActivityLogRow[]>;
  countForEntity(entity: string, entityId: number, executor?: Executor): Promise<number>;
}

export function createActivityLogRepository(knex: Knex): ActivityLogRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  return {
    async insert(row, executor) {
      // `[row]` rather than `row`: Knex treats a bare object as an UPDATE
      // target on some paths, and a silent no-op insert is the worst possible
      // failure for a log.
      await run(executor).insert(row).into('activity_log');
      return row.entity_id;
    },

    async listForEntity(entity, entityId, executor) {
      // Newest first: the question a history view answers is "what just
      // happened", and the owner reads downward from the present.
      return run(executor)
        .select('*')
        .from('activity_log')
        .where({ entity, entity_id: entityId })
        .orderBy('at', 'desc')
        .orderBy('id', 'desc');
    },

    async listSince(atMs, executor) {
      return run(executor)
        .select('*')
        .from('activity_log')
        .where('at', '>=', atMs)
        .orderBy('at', 'asc')
        .orderBy('id', 'asc');
    },

    async countForEntity(entity, entityId, executor) {
      const result = await run(executor)
        .count<{ count: number | string }[]>({ count: '*' })
        .from('activity_log')
        .where({ entity, entity_id: entityId });
      return Number(result[0]?.count ?? 0);
    },
  };
}
