import { afterEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { setNowMsForTesting } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';
import {
  createActivityLogRepository,
  type ActivityLogRepository,
  type ActivityLogRow,
} from './activity-log.repository.js';
import type { ActivityAction } from '../services/activity-log.service.js';

/**
 * `listSince` reads the log from a timestamp forward, newest-last.
 *
 * The repository layer has no direct tests — the config comment says a query is
 * verified by the service test that uses it, and every other method here is
 * used by a service. **`listSince` is not**: no service calls it, so it had no
 * test at all and was the sole reason this file sat at 78% statements.
 *
 * It is tested rather than deleted because it is a real query with a real
 * ordering contract, and a repository that quietly returns rows in insertion
 * order rather than timestamp order is a subtle wrong answer rather than an
 * obvious crash. The test pins the ordering, which is the part that is easy to
 * get wrong.
 */
let harness: TestApp | undefined;
let repository: ActivityLogRepository | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  repository = undefined;
  setNowMsForTesting();
});

async function withRepository(): Promise<ActivityLogRepository> {
  harness = await createTestApp();
  repository = createActivityLogRepository(harness.knex as Knex);
  return repository;
}

/**
 * Records one row through the **service**, at a fixed instant.
 *
 * Through the service rather than by inserting a row directly, because the
 * service owns the column mapping and the clock — and because writing through it
 * means the rows under test are shaped the way production writes them. The
 * repository's own `insert` takes column names (`entity_id`, `after_json`) and
 * would let a test pass against a row shape the application never creates.
 */
async function record(
  at: number,
  entityId: number,
  action: ActivityAction = 'created',
): Promise<void> {
  setNowMsForTesting(() => at);
  await servicesOf(harness!.app).activityLog.recordChange({
    entity: 'task',
    entityId,
    action,
    before: null,
    after: { name: `Task ${entityId}` },
  });
}

describe('FR-STAT-05: the activity log can be read from a timestamp forward', () => {
  it('returns nothing when the log is empty', async () => {
    const repo = await withRepository();

    expect(await repo.listSince(0)).toEqual([]);
  });

  it('returns every row from the past', async () => {
    const repo = await withRepository();
    await record(1000, 1);
    await record(2000, 1);

    expect(await repo.listSince(0)).toHaveLength(2);
  });

  it('excludes a row older than the timestamp', async () => {
    const repo = await withRepository();
    await record(1000, 1);
    await record(3000, 1);

    const rows = await repo.listSince(2000);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.at).toBe(3000);
  });

  it('includes a row exactly at the timestamp, because the bound is inclusive', async () => {
    // `>=` and `>` differ by one row here. An exclusive bound silently drops the
    // row a caller asked for when the timestamp came from a previous read of the
    // same clock, which is the only way a caller gets one.
    const repo = await withRepository();
    await record(2000, 1);

    const rows = await repo.listSince(2000);

    expect(rows).toHaveLength(1);
  });

  it('orders oldest first, so a caller can replay the log forward', async () => {
    const repo = await withRepository();
    await record(3000, 1);
    await record(1000, 1);
    await record(2000, 1);

    const rows = await repo.listSince(0);

    expect(rows.map((r: ActivityLogRow) => r.at)).toEqual([1000, 2000, 3000]);
  });

  it('breaks a timestamp tie by id, so the order is stable', async () => {
    // Two rows written in the same millisecond — a bulk create, or a create and
    // an immediate status change — have identical `at`. Without the `id` tiebreak
    // their order would be whatever SQLite felt like returning, and a replay
    // would not be reproducible.
    const repo = await withRepository();
    await record(2000, 1, 'created');
    await record(2000, 1, 'archived');

    const rows = await repo.listSince(0);

    expect(rows.map((r: ActivityLogRow) => r.action)).toEqual(['created', 'archived']);
  });

  it('spans more than one entity, because the log is a log and not a task view', async () => {
    const repo = await withRepository();
    await record(1000, 1);
    setNowMsForTesting(() => 2000);
    await servicesOf(harness!.app).activityLog.recordChange({
      entity: 'project',
      entityId: 7,
      action: 'created',
      before: null,
      after: { name: 'Website' },
    });

    const rows = await repo.listSince(0);

    expect(rows.map((r: ActivityLogRow) => r.entity).sort()).toEqual(['project', 'task']);
  });

  it('runs inside a transaction when given an executor', async () => {
    // The write path always passes a transaction so a log entry and the change
    // it describes commit together. A repository that ignored the executor would
    // still pass every other test here and would read outside the transaction.
    //
    // The row is written *before* the transaction opens rather than inside it:
    // the service opens its own transaction to write, and nesting two write
    // transactions on a single-writer SQLite connection deadlocks. What is under
    // test is that `listSince` honours the executor it is given, not that two
    // transactions can nest.
    const repo = await withRepository();
    await record(1000, 1);

    await harness!.knex.transaction(async (trx) => {
      await expect(repo.listSince(0, trx)).resolves.toHaveLength(1);
    });
  });
});
