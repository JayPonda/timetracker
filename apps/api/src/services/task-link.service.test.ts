import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, setNowMsForTesting, taskLinkSchema } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function linkService() {
  harness = await createTestApp();
  return servicesOf(harness.app).taskLinks;
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

describe('FR-TASK-03: adding a link takes the smallest free slot', () => {
  it('stores the link and records the creation', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await linkService();
    const taskId = await liveTask();

    const link = await service.create(taskId, { label: 'Spec', url: 'https://example.com/spec' });

    expect(taskLinkSchema.parse(link)).toEqual(link);
    expect(link.position).toBe(1);
    expect(link.created_at).toBe(1_700_000_000_000);
    const rows = await activityLog().listForEntity('task_link', link.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
  });

  it('reuses a slot freed by archiving', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const first = await service.create(taskId, { label: 'Old', url: 'https://example.com/old' });
    await service.create(taskId, { label: 'Kept', url: 'https://example.com/kept' });
    await service.archive(first.id);

    const reused = await service.create(taskId, { label: 'New', url: 'https://example.com/new' });

    expect(reused.position).toBe(1);
    expect((await service.listByTask(taskId)).map((link) => link.position)).toEqual([1, 2]);
  });

  it('refuses a task that does not exist', async () => {
    const service = await linkService();

    await expect(
      service.create(999, { label: '', url: 'https://example.com' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND, status: 404 });
  });

  it('refuses a link on an archived task', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    await taskService().archive(taskId);

    await expect(
      service.create(taskId, { label: '', url: 'https://example.com' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
  });
});

describe('DATA-01 and BR-04: the 4th link is refused with a message naming the limit', () => {
  it('refuses with a 422 that says 3', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    for (const n of [1, 2, 3]) {
      await service.create(taskId, { label: `Link ${n}`, url: `https://example.com/${n}` });
    }

    const failure = await service
      .create(taskId, { label: 'Fourth', url: 'https://example.com/4' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
    expect(String((failure as Error).message)).toContain('3');
  });

  it('writes nothing when it refuses, so the list is unchanged', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    for (const n of [1, 2, 3]) {
      await service.create(taskId, { label: `Link ${n}`, url: `https://example.com/${n}` });
    }

    await expect(
      service.create(taskId, { label: 'Fourth', url: 'https://example.com/4' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(await service.listByTask(taskId)).toHaveLength(3);
  });
});

describe('FR-TASK-03: editing a link records only the changed field', () => {
  it('updates the label and logs the new one', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const created = await service.create(taskId, {
      label: 'Old',
      url: 'https://example.com/spec',
    });

    const updated = await service.update(created.id, { label: 'New' });

    expect(updated.label).toBe('New');
    const rows = await activityLog().listForEntity('task_link', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ label: 'New' });
  });

  it('refuses to edit an archived link until it is restored', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { label: 'Old', url: 'https://example.com' });
    await service.archive(created.id);

    await expect(service.update(created.id, { label: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-TASK-03: archiving frees the slot and restoring needs one', () => {
  it('hides the archived link from the default list and records the archive', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const kept = await service.create(taskId, { label: 'Kept', url: 'https://example.com/kept' });
    const cut = await service.create(taskId, { label: 'Cut', url: 'https://example.com/cut' });

    await service.archive(cut.id);

    expect((await service.listByTask(taskId)).map((link) => link.id)).toEqual([kept.id]);
    const rows = await activityLog().listForEntity('task_link', cut.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('restores into its old slot when free', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const first = await service.create(taskId, { label: 'First', url: 'https://example.com/1' });
    await service.archive(first.id);

    const restored = await service.restore(first.id);

    expect(restored.archived_at).toBeNull();
    expect(restored.position).toBe(1);
  });

  it('restores into the smallest free slot when its old one is taken', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const first = await service.create(taskId, { label: 'First', url: 'https://example.com/1' });
    await service.create(taskId, { label: 'Second', url: 'https://example.com/2' });
    await service.archive(first.id);
    // Takes slot 1 while the first is archived.
    await service.create(taskId, { label: 'Third', url: 'https://example.com/3' });

    const restored = await service.restore(first.id);

    expect(restored.position).toBe(3);
  });

  it('refuses to restore when all three slots are taken', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const first = await service.create(taskId, { label: 'First', url: 'https://example.com/1' });
    await service.archive(first.id);
    for (const n of [2, 3, 4]) {
      await service.create(taskId, { label: `Link ${n}`, url: `https://example.com/${n}` });
    }

    const failure = await service.restore(first.id).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
    expect(String((failure as Error).message)).toContain('3');
  });

  it('refuses to restore a link that is not archived', async () => {
    const service = await linkService();
    const taskId = await liveTask();
    const created = await service.create(taskId, { label: 'A', url: 'https://example.com' });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('a missing link or task is a 404, not an empty answer', () => {
  it('refuses to read link 999', async () => {
    const service = await linkService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to list links for task 999', async () => {
    const service = await linkService();

    await expect(service.listByTask(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update link 999', async () => {
    const service = await linkService();

    await expect(service.update(999, { label: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to archive link 999', async () => {
    const service = await linkService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore link 999', async () => {
    const service = await linkService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
