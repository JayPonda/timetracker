import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, setNowMsForTesting, todoSchema } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function todoService() {
  harness = await createTestApp();
  return servicesOf(harness.app).todos;
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

describe('FR-TODO-01: adding a todo appends it to the task’s timeline', () => {
  it('stores the todo at the end and records the creation', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await todoService();
    const taskId = await liveTask();

    const first = await service.create(taskId, { title: 'Draft', note: '', estimate_hours: null });
    const second = await service.create(taskId, { title: 'Revise', note: '', estimate_hours: 1 });

    expect(todoSchema.parse(first)).toEqual(first);
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.created_at).toBe(1_700_000_000_000);
    const rows = await activityLog().listForEntity('todo', first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
  });

  it('refuses a todo on a task that does not exist', async () => {
    const service = await todoService();

    await expect(
      service.create(999, { title: 'Ghost', note: '', estimate_hours: null }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND, status: 404 });
  });

  it('refuses a todo on an archived task', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    await taskService().archive(taskId);

    await expect(
      service.create(taskId, { title: 'Too late', note: '', estimate_hours: null }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
  });
});

describe('FR-TODO-02: ticking sets the date, unticking clears it', () => {
  it('stamps done_at from the clock, never from the client', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await todoService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { title: 'Draft', note: '', estimate_hours: null });

    setNowMsForTesting(() => 1_700_000_003_600);
    const done = await service.update(created.id, { done: true });

    expect(done.done).toBe(true);
    expect(done.done_at).toBe(1_700_000_003_600);
    const rows = await activityLog().listForEntity('todo', created.id);
    expect(rows[0]?.action).toBe('updated');
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ done: true, done_at: 1_700_000_003_600 });
  });

  it('clears done_at when unticked', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { title: 'Draft', note: '', estimate_hours: null });
    await service.update(created.id, { done: true });

    const undone = await service.update(created.id, { done: false });

    expect(undone.done).toBe(false);
    expect(undone.done_at).toBeNull();
  });
});

describe('FR-TODO-01: renaming records only the changed field', () => {
  it('updates the title and logs the new one', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { title: 'Draft', note: 'Same', estimate_hours: null });

    const updated = await service.update(created.id, { title: 'Redraft' });

    expect(updated.title).toBe('Redraft');
    const rows = await activityLog().listForEntity('todo', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ title: 'Redraft' });
  });

  it('refuses to edit an archived todo until it is restored', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { title: 'Draft', note: '', estimate_hours: null });
    await service.archive(created.id);

    await expect(service.update(created.id, { title: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-TODO-01: reordering needs the whole order, or nothing', () => {
  it('assigns positions from the given order and returns the timeline', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const a = await service.create(taskId, { title: 'A', note: '', estimate_hours: null });
    const b = await service.create(taskId, { title: 'B', note: '', estimate_hours: null });
    const c = await service.create(taskId, { title: 'C', note: '', estimate_hours: null });

    const reordered = await service.reorder(taskId, [c.id, a.id, b.id]);

    expect(reordered.map((todo) => todo.title)).toEqual(['C', 'A', 'B']);
    expect(reordered.map((todo) => todo.position)).toEqual([0, 1, 2]);
  });

  it('refuses an order naming a todo from another task', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const otherId = await liveTask();
    const a = await service.create(taskId, { title: 'A', note: '', estimate_hours: null });
    const foreign = await service.create(otherId, { title: 'Foreign', note: '', estimate_hours: null });

    await expect(service.reorder(taskId, [a.id, foreign.id])).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    // The refusal happened before any write: the order is untouched.
    expect((await service.listByTask(taskId)).map((todo) => todo.id)).toEqual([a.id]);
  });

  it('refuses an order that drops a todo', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const a = await service.create(taskId, { title: 'A', note: '', estimate_hours: null });
    await service.create(taskId, { title: 'B', note: '', estimate_hours: null });

    await expect(service.reorder(taskId, [a.id])).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-PHASE-05: archiving keeps the todo and restores it at the end', () => {
  it('hides the archived todo from the default list and records the archive', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const kept = await service.create(taskId, { title: 'Kept', note: '', estimate_hours: null });
    const archived = await service.create(taskId, { title: 'Cut', note: '', estimate_hours: null });

    await service.archive(archived.id);

    expect((await service.listByTask(taskId)).map((todo) => todo.id)).toEqual([kept.id]);
    expect(
      (await service.listByTask(taskId, { includeArchived: true })).map((todo) => todo.id),
    ).toEqual([kept.id, archived.id]);
    const rows = await activityLog().listForEntity('todo', archived.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('restores at the end so positions stay unique among live todos', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const first = await service.create(taskId, { title: 'First', note: '', estimate_hours: null });
    await service.archive(first.id);
    // Takes the freed slot while the first is archived.
    const second = await service.create(taskId, { title: 'Second', note: '', estimate_hours: null });
    expect(second.position).toBe(first.position);

    const restored = await service.restore(first.id);

    expect(restored.archived_at).toBeNull();
    expect(restored.position).not.toBe(second.position);
    expect((await service.listByTask(taskId)).map((todo) => todo.title)).toEqual([
      'Second',
      'First',
    ]);
  });

  it('refuses to restore a todo that is not archived', async () => {
    const service = await todoService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { title: 'A', note: '', estimate_hours: null });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('a missing todo or task is a 404, not an empty answer', () => {
  it('refuses to read todo 999', async () => {
    const service = await todoService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to list todos for task 999', async () => {
    const service = await todoService();

    await expect(service.listByTask(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update todo 999', async () => {
    const service = await todoService();

    await expect(service.update(999, { title: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to archive todo 999', async () => {
    const service = await todoService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore todo 999', async () => {
    const service = await todoService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
