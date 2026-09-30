import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, setNowMsForTesting, referenceSchema } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function referenceService() {
  harness = await createTestApp();
  return servicesOf(harness.app).references;
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

describe('FR-REF-01: adding a reference stores it and records the creation', () => {
  it('stores every field and stamps it from the injected clock', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await referenceService();
    const taskId = await liveTask();

    const created = await service.create(taskId, {
      title: 'What I learned',
      body: 'Never trust a relative href.',
      url: 'https://example.com/lesson',
      type: 'lesson',
    });

    expect(referenceSchema.parse(created)).toEqual(created);
    expect(created.task_id).toBe(taskId);
    expect(created.created_at).toBe(1_700_000_000_000);
    const rows = await activityLog().listForEntity('reference_material', created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
  });

  it('refuses a reference on a task that does not exist', async () => {
    const service = await referenceService();

    await expect(
      service.create(999, { title: 'Ghost', body: '', url: null, type: 'note' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND, status: 404 });
  });

  it('refuses a reference on an archived task', async () => {
    const service = await referenceService();
    const taskId = await liveTask();
    await taskService().archive(taskId);

    await expect(
      service.create(taskId, { title: 'Too late', body: '', url: null, type: 'note' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
  });
});

describe('FR-REF-01: editing records only the changed field', () => {
  it('updates the body and logs the new one', async () => {
    const service = await referenceService();
    const taskId = await liveTask();
    const created = await service.create(taskId, {
      title: 'Notes',
      body: 'Old words',
      url: null,
      type: 'note',
    });

    const updated = await service.update(created.id, { body: 'New words' });

    expect(updated.body).toBe('New words');
    const rows = await activityLog().listForEntity('reference_material', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ body: 'New words' });
  });

  it('refuses to edit an archived reference until it is restored', async () => {
    const service = await referenceService();
    const taskId = await liveTask();
    const created = await service.create(taskId, {
      title: 'Notes',
      body: '',
      url: null,
      type: 'note',
    });
    await service.archive(created.id);

    await expect(service.update(created.id, { body: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-REF-01 and FR-REF-05: archiving hides the reference without touching it', () => {
  it('lists newest first, hides the archived one by default, and records the archive', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await referenceService();
    const taskId = await liveTask();
    const first = await service.create(taskId, {
      title: 'First',
      body: '',
      url: null,
      type: 'note',
    });
    setNowMsForTesting(() => 1_700_000_003_600);
    const second = await service.create(taskId, {
      title: 'Second',
      body: '',
      url: null,
      type: 'note',
    });

    await service.archive(first.id);

    expect((await service.listByTask(taskId)).map((reference) => reference.id)).toEqual([second.id]);
    expect(
      (await service.listByTask(taskId, { includeArchived: true })).map((r) => r.id),
    ).toEqual([second.id, first.id]);
    const rows = await activityLog().listForEntity('reference_material', first.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('restores, and refuses to restore what is not archived', async () => {
    const service = await referenceService();
    const taskId = await liveTask();
    const created = await service.create(taskId, {
      title: 'A',
      body: '',
      url: null,
      type: 'note',
    });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    await service.archive(created.id);
    expect((await service.restore(created.id)).archived_at).toBeNull();
  });

  it('keeps the reference readable after its task is archived', async () => {
    const service = await referenceService();
    const taskId = await liveTask();
    const created = await service.create(taskId, {
      title: 'Lesson',
      body: 'Kept',
      url: null,
      type: 'lesson',
    });
    await taskService().archive(taskId);

    // The task is gone from every list, but the lesson is not gone with it.
    // Reads check nothing about the task's state, and no statement here names
    // the task row at all.
    expect(await service.get(created.id, { includeArchived: true })).toMatchObject({
      id: created.id,
      title: 'Lesson',
    });
  });
});

describe('a missing reference or task is a 404, not an empty answer', () => {
  it('refuses to read reference 999', async () => {
    const service = await referenceService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to list references for task 999', async () => {
    const service = await referenceService();

    await expect(service.listByTask(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update reference 999', async () => {
    const service = await referenceService();

    await expect(service.update(999, { body: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to archive reference 999', async () => {
    const service = await referenceService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore reference 999', async () => {
    const service = await referenceService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
