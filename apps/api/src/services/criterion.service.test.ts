import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, setNowMsForTesting, criterionSchema } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function criterionService() {
  harness = await createTestApp();
  return servicesOf(harness.app).criteria;
}

function taskService() {
  if (!harness) throw new Error('Test harness was not created.');
  return servicesOf(harness.app).tasks;
}

function activityLog() {
  if (!harness) throw new Error('Test harness was not created.');
  return servicesOf(harness.app).activityLog;
}

async function liveTask(): Promise<number> {
  const task = await taskService().create({
    name: 'Write the spec',
    description: '',
    project_id: null,
    status: 'open',
    score: null,
    estimate_hours: null,
    planned_start: null,
    due_date: null,
  });
  return task.id;
}

describe('FR-AC-01: adding a criterion appends it to the definition of done', () => {
  it('stores the statement at the end and records the creation', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await criterionService();
    const taskId = await liveTask();

    const first = await service.create(taskId, { text: 'Reads cleanly' });
    const second = await service.create(taskId, { text: 'Covers the edge cases' });

    expect(criterionSchema.parse(first)).toEqual(first);
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.created_at).toBe(1_700_000_000_000);
    const rows = await activityLog().listForEntity('acceptance_criterion', first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
  });

  it('refuses a criterion on a task that does not exist', async () => {
    const service = await criterionService();

    await expect(service.create(999, { text: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses a criterion on an archived task', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    await taskService().archive(taskId);

    await expect(service.create(taskId, { text: 'Too late' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-AC-01: editing restates the definition and logs the new words', () => {
  it('updates the text and logs only the text', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { text: 'Reads well' });

    const updated = await service.update(created.id, { text: 'Reads cleanly' });

    expect(updated.text).toBe('Reads cleanly');
    const rows = await activityLog().listForEntity('acceptance_criterion', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ text: 'Reads cleanly' });
  });

  it('refuses to edit an archived criterion until it is restored', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { text: 'Reads well' });
    await service.archive(created.id);

    await expect(service.update(created.id, { text: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-AC-01: reordering needs the whole order, or nothing', () => {
  it('assigns positions from the given order and returns the definition', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const a = await service.create(taskId, { text: 'A' });
    const b = await service.create(taskId, { text: 'B' });

    const reordered = await service.reorder(taskId, [b.id, a.id]);

    expect(reordered.map((criterion) => criterion.text)).toEqual(['B', 'A']);
    expect(reordered.map((criterion) => criterion.position)).toEqual([0, 1]);
  });

  it('refuses an order naming a criterion from another task', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const otherId = await liveTask();
    const a = await service.create(taskId, { text: 'A' });
    const foreign = await service.create(otherId, { text: 'Foreign' });

    await expect(service.reorder(taskId, [a.id, foreign.id])).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    expect((await service.listByTask(taskId)).map((criterion) => criterion.id)).toEqual([a.id]);
  });

  it('refuses an order that drops a criterion', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const a = await service.create(taskId, { text: 'A' });
    await service.create(taskId, { text: 'B' });

    await expect(service.reorder(taskId, [a.id])).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-AC-01: archiving removes a criterion from later closures without erasing it', () => {
  it('hides the archived criterion from the default list and records the archive', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const kept = await service.create(taskId, { text: 'Kept' });
    const cut = await service.create(taskId, { text: 'Cut' });

    await service.archive(cut.id);

    expect((await service.listByTask(taskId)).map((criterion) => criterion.id)).toEqual([kept.id]);
    const rows = await activityLog().listForEntity('acceptance_criterion', cut.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('restores at the end and refuses to restore what is not archived', async () => {
    const service = await criterionService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { text: 'A' });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    await service.archive(created.id);
    const restored = await service.restore(created.id);
    expect(restored.archived_at).toBeNull();
  });
});

describe('a missing criterion or task is a 404, not an empty answer', () => {
  it('refuses to read criterion 999', async () => {
    const service = await criterionService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to list criteria for task 999', async () => {
    const service = await criterionService();

    await expect(service.listByTask(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update criterion 999', async () => {
    const service = await criterionService();

    await expect(service.update(999, { text: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to archive criterion 999', async () => {
    const service = await criterionService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore criterion 999', async () => {
    const service = await criterionService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
