import { newUid, nowMs } from '@pdm/shared';
import {
  createActivityLogRepository,
  type ActivityEntity,
  type ActivityLogRepository,
  type Executor,
} from '../repositories/activity-log.repository.js';
import { logger } from '../lib/logger.js';
import type { Knex } from 'knex';

/**
 * The activity log (criterion 13, `FR-STAT-05`).
 *
 * `activity_log` is the task's history: every status change, and every edit made
 * after a task has ended. It is **append-only**, which is why this service has no
 * update method and no delete method at all — not a private one, not a commented
 * one. The table has no `archived_at` for the same reason as everything else in
 * the project: an entry that could be hidden is an entry that could be lost.
 *
 * **The rule that earns its keep: only what changed is stored.** `before_json` and
 * `after_json` hold the fields whose values differ, not the whole row. A history
 * entry that copies an entire task means every edit rewrites the readable record
 * of every previous edit, and "what did I change" becomes a diff of two large
 * objects rather than a line that says `status: in_progress -> ended`.
 */

/**
 * What happened, as a closed set.
 *
 * Closed because a history view branches on it, and because an action invented
 * ad hoc per call site is how a history ends up with `update`, `edited` and
 * `change` meaning the same thing.
 */
export const ACTIVITY_ACTIONS = ['created', 'updated', 'archived', 'restored'] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type FieldValues = Readonly<Record<string, unknown>>;

export interface RecordChangeInput {
  readonly entity: ActivityEntity;
  readonly entityId: number;
  readonly action: ActivityAction;
  /** `null` for a create. */
  readonly before: FieldValues | null;
  readonly after: FieldValues;
}

export interface RecordChangeResult {
  /** `null` when nothing actually differed, so no entry was written. */
  readonly uid: string | null;
  readonly before: FieldValues | null;
  readonly after: FieldValues | null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN !== NaN, and no column in this schema is a float except the two
  // `estimate_hours`, where NaN cannot be stored. Guarded anyway so a future
  // float column cannot produce a permanent "changed" state that logs on every read.
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  return false;
}

/**
 * The fields whose values differ between two versions of a row.
 *
 * Returns `after: null` when nothing differed, which is the signal the service
 * uses to decide not to write an entry at all. Exported because it is the rule,
 * and a rule that is only reachable through a database is a rule that gets
 * reimplemented inline somewhere else later.
 */
export function changedFields(
  before: FieldValues | null,
  after: FieldValues,
): { before: FieldValues | null; after: FieldValues | null } {
  // A create has no previous state, so everything is new and all of it is stored.
  if (before === null) return { before: null, after: { ...after } };

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  let count = 0;

  for (const key of keys) {
    if (sameValue(before[key], after[key])) continue;
    // Both sides are populated, including for a key that exists in only one of
    // them. A field that appeared or vanished is the most interesting kind of
    // change, and storing `null` on the missing side says exactly that.
    if (key in before) changedBefore[key] = before[key];
    if (key in after) changedAfter[key] = after[key];
    count += 1;
  }

  if (count === 0) return { before: null, after: null };
  return { before: changedBefore, after: changedAfter };
}

export interface ActivityLogService {
  /**
   * Record one change.
   *
   * Pass `executor` to join a transaction the caller already owns. Without it a
   * transaction is opened here. Either way the log entry and the change it
   * describes commit together or not at all.
   */
  recordChange(input: RecordChangeInput, executor?: Executor): Promise<RecordChangeResult>;
  listForEntity(
    entity: ActivityEntity,
    entityId: number,
    executor?: Executor,
  ): Promise<import('../repositories/activity-log.repository.js').ActivityLogRow[]>;
  countForEntity(entity: ActivityEntity, entityId: number, executor?: Executor): Promise<number>;
}

export function createActivityLogService(knex: Knex): ActivityLogService {
  const repository: ActivityLogRepository = createActivityLogRepository(knex);

  return {
    async recordChange(input, executor) {
      const diff = changedFields(input.before, input.after);

      // An update that changed nothing is not a change. Writing an entry with two
      // empty objects would fill the history with rows that say only "something
      // happened", which is the opposite of useful.
      if (diff.after === null) {
        logger.debug(
          'activity-log.service.ts',
          'recordChange',
          'no field changed; nothing recorded',
          {
            entity: input.entity,
            entity_id: input.entityId,
            action: input.action,
          },
        );
        return { uid: null, before: null, after: null };
      }

      const uid = newUid();
      const at = nowMs();
      const row = {
        uid,
        entity: input.entity,
        entity_id: input.entityId,
        action: input.action,
        before_json: diff.before === null ? null : JSON.stringify(diff.before),
        after_json: JSON.stringify(diff.after),
        at,
        created_at: at,
        updated_at: at,
      };

      if (executor) {
        await repository.insert(row, executor);
      } else {
        await knex.transaction(async (trx) => {
          await repository.insert(row, trx);
        });
      }

      logger.info('activity-log.service.ts', 'recordChange', 'change recorded', {
        entity: input.entity,
        entity_id: input.entityId,
        action: input.action,
        fields: Object.keys(diff.after).join(','),
      });

      return { uid, before: diff.before, after: diff.after };
    },

    listForEntity: (entity, entityId, executor) =>
      repository.listForEntity(entity, entityId, executor),
    countForEntity: (entity, entityId, executor) =>
      repository.countForEntity(entity, entityId, executor),
  };
}
