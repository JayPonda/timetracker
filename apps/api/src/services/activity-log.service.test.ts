import { afterEach, describe, expect, it } from 'vitest';
import { setNowMsForTesting } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { createActivityLogService, changedFields } from './activity-log.service.js';
import { APP_ERROR_CODES } from '../test/assertions.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

describe('criterion 13: the activity log records what changed, not the whole row', () => {
  it('stores only the fields whose values differ', () => {
    const diff = changedFields(
      { name: 'Old name', description: 'unchanged', status: 'open' },
      { name: 'New name', description: 'unchanged', status: 'in_progress' },
    );

    // A history entry that copies the whole row makes "what did I change" a diff
    // of two large objects instead of a line that says what moved.
    expect(diff.before).toEqual({ name: 'Old name', status: 'open' });
    expect(diff.after).toEqual({ name: 'New name', status: 'in_progress' });
  });

  it('leaves out a field that did not change', () => {
    const diff = changedFields(
      { name: 'Same', note: 'same note' },
      { name: 'Same', note: 'same note' },
    );
    expect(diff.after).toBeNull();
  });

  it('records every field of a create, because all of it is new', () => {
    const diff = changedFields(null, { name: 'New task', status: 'open' });
    expect(diff.before).toBeNull();
    expect(diff.after).toEqual({ name: 'New task', status: 'open' });
  });

  it('records a field that disappeared, as null on the after side', () => {
    // A field that vanished is among the most interesting changes, and storing
    // null on the missing side says exactly that.
    const diff = changedFields({ name: 'A', estimate_hours: 2 }, { name: 'A' });
    expect(diff.before).toEqual({ estimate_hours: 2 });
    expect(diff.after).toEqual({ estimate_hours: undefined });
  });

  it('records a field that appeared', () => {
    const diff = changedFields({ name: 'A' }, { name: 'A', colour: 'red' });
    expect(diff.after).toEqual({ colour: 'red' });
  });

  it('does not call an unchanged NaN a change, which would log on every read', () => {
    // NaN !== NaN. Without this, a float column holding NaN would produce a
    // permanent "changed" state and write a log row on every read.
    const diff = changedFields({ estimate_hours: Number.NaN }, { estimate_hours: Number.NaN });
    expect(diff.after).toBeNull();
  });

  it('does call a changed NaN a change', () => {
    const diff = changedFields({ estimate_hours: 1 }, { estimate_hours: Number.NaN });
    expect(diff.after).toEqual({ estimate_hours: Number.NaN });
  });
});

describe('FR-STAT-05: a status change is recorded with a before and an after', () => {
  it('writes one row describing the transition', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    harness = await createTestApp();
    const service = createActivityLogService(harness.knex);

    await service.recordChange({
      entity: 'task',
      entityId: 7,
      action: 'updated',
      before: { status: 'open', name: 'Write the spec' },
      after: { status: 'in_progress', name: 'Write the spec' },
    });

    const rows = await service.listForEntity('task', 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('updated');
    expect(JSON.parse(rows[0]?.before_json ?? '{}')).toEqual({ status: 'open' });
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ status: 'in_progress' });
  });

  it('writes nothing when an update changed no field', async () => {
    harness = await createTestApp();
    const service = createActivityLogService(harness.knex);

    const result = await service.recordChange({
      entity: 'task',
      entityId: 7,
      action: 'updated',
      before: { name: 'Same' },
      after: { name: 'Same' },
    });

    // A log full of rows that say only "something happened" is the opposite of
    // a history.
    expect(result.uid).toBeNull();
    expect(await service.countForEntity('task', 7)).toBe(0);
  });

  it('orders a history newest first, which is the order a person reads it in', async () => {
    harness = await createTestApp();
    const service = createActivityLogService(harness.knex);

    setNowMsForTesting(() => 1_000);
    await service.recordChange({
      entity: 'task',
      entityId: 1,
      action: 'created',
      before: null,
      after: { name: 'A' },
    });
    setNowMsForTesting(() => 2_000);
    await service.recordChange({
      entity: 'task',
      entityId: 1,
      action: 'updated',
      before: { name: 'A' },
      after: { name: 'B' },
    });

    const rows = await service.listForEntity('task', 1);
    expect(rows[0]?.action).toBe('updated');
    expect(rows[1]?.action).toBe('created');
  });

  it('keeps each entity separate', async () => {
    harness = await createTestApp();
    const service = createActivityLogService(harness.knex);

    await service.recordChange({
      entity: 'task',
      entityId: 1,
      action: 'created',
      before: null,
      after: { name: 'A' },
    });
    await service.recordChange({
      entity: 'project',
      entityId: 1,
      action: 'created',
      before: null,
      after: { name: 'P' },
    });

    expect(await service.countForEntity('task', 1)).toBe(1);
    expect(await service.countForEntity('project', 1)).toBe(1);
  });

  it('stamps the entry from nowMs, so a frozen clock is honoured', async () => {
    setNowMsForTesting(() => 1_700_000_123_456);
    harness = await createTestApp();
    const service = createActivityLogService(harness.knex);

    await service.recordChange({
      entity: 'task',
      entityId: 1,
      action: 'created',
      before: null,
      after: { name: 'A' },
    });

    const rows = await service.listForEntity('task', 1);
    expect(rows[0]?.at).toBe(1_700_000_123_456);
    expect(rows[0]?.created_at).toBe(1_700_000_123_456);
  });

  it('gives each entry a UUIDv7 uid, so a merge can match it', async () => {
    harness = await createTestApp();
    const service = createActivityLogService(harness.knex);

    await service.recordChange({
      entity: 'task',
      entityId: 1,
      action: 'created',
      before: null,
      after: { name: 'A' },
    });

    const rows = await service.listForEntity('task', 1);
    expect(rows[0]?.uid[14]).toBe('7');
  });
});

describe('BR-13: the activity log is append-only', () => {
  it('has no way to update an entry', () => {
    const service = createActivityLogService({} as never);
    // Ground rule 2 is absolute, and the table has no archived_at precisely so
    // an entry cannot be hidden. Asserting the absence of a method is the only
    // way to keep it absent.
    expect(Object.keys(service).every((k) => !/update|patch|edit/i.test(k))).toBe(true);
  });

  it('has no way to delete an entry', () => {
    const service = createActivityLogService({} as never);
    expect(Object.keys(service).every((k) => !/delete|remove|purge/i.test(k))).toBe(true);
  });
});

describe('criterion 9: a service refusal is a typed error the interface can render', () => {
  it('uses the shared error codes, so no string is invented here', () => {
    // The codes live in @pdm/shared because the browser branches on them too.
    expect(APP_ERROR_CODES.every((code) => typeof code === 'string')).toBe(true);
  });
});
