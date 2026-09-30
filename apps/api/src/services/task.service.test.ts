import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, setNowMsForTesting, taskSchema } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function taskService() {
  harness = await createTestApp();
  return servicesOf(harness.app).tasks;
}

function projectService() {
  if (!harness) throw new Error('Test harness was not created.');
  return servicesOf(harness.app).projects;
}

function activityLog() {
  if (!harness) throw new Error('Test harness was not created.');
  return servicesOf(harness.app).activityLog;
}

async function liveProject(name = 'Client work'): Promise<number> {
  const project = await projectService().create({ name, description: '', colour: '#4f46e5' });
  return project.id;
}

describe('FR-TASK-01 and FR-TASK-04: creating a task files it somewhere real', () => {
  it('stores a task under a live project with its joined name', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await taskService();
    const projectId = await liveProject();

    const task = await service.create({
      name: 'Write the spec',
      description: '',
      project_id: projectId,
      status: 'open',
      score: null,
      estimate_hours: 2.5,
      planned_start: null,
      due_date: null,
    });

    expect(taskSchema.parse(task)).toEqual(task);
    expect(task.project_name).toBe('Client work');
    expect(task.created_at).toBe(1_700_000_000_000);
    expect(task.started_at).toBeNull();
    const rows = await activityLog().listForEntity('task', task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
  });

  it('files a task under “No project” when no project is named', async () => {
    const service = await taskService();

    const task = await service.create({
      name: 'Loose end',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    expect(task.project_id).toBeNull();
    expect(task.project_name).toBeNull();
  });

  it('refuses a task filed into an archived project, rather than hiding it at birth', async () => {
    const service = await taskService();
    const projectId = await liveProject();
    await projectService().archive(projectId);

    await expect(
      service.create({
        name: 'Hidden at birth',
        description: '',
        project_id: projectId,
        status: 'open',
        score: null,
        estimate_hours: null,
        planned_start: null,
        due_date: null,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
  });

  it('refuses a task filed into a project that does not exist', async () => {
    const service = await taskService();

    await expect(
      service.create({
        name: 'Nowhere',
        description: '',
        project_id: 999,
        status: 'open',
        score: null,
        estimate_hours: null,
        planned_start: null,
        due_date: null,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
  });
});

describe('FR-TASK-08: started_at records the first move to in progress', () => {
  it('stamps a task born in progress', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await taskService();

    const task = await service.create({
      name: 'Already going',
      description: '',
      project_id: null,
      status: 'in_progress',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    expect(task.started_at).toBe(1_700_000_000_000);
  });

  it('stamps the first transition and keeps the stamp when it moves back', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    setNowMsForTesting(() => 1_700_000_003_600);
    const started = await service.update(created.id, { status: 'in_progress' });
    expect(started.started_at).toBe(1_700_000_003_600);

    setNowMsForTesting(() => 1_700_000_007_200);
    const reopened = await service.update(created.id, { status: 'open' });
    // The stamp is a fact about when work first started, not a mirror of the
    // current status. Moving back must not rewrite it.
    expect(reopened.started_at).toBe(1_700_000_003_600);
  });
});

describe('FR-STAT-05: a status change is recorded with a before and an after', () => {
  it('logs open to in_progress as a diff, not a row copy', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    setNowMsForTesting(() => 1_700_000_003_600);
    await service.update(created.id, { status: 'in_progress' });

    const rows = await activityLog().listForEntity('task', created.id);
    expect(rows[0]?.action).toBe('updated');
    expect(JSON.parse(rows[0]?.before_json ?? '{}')).toMatchObject({ status: 'open' });
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toMatchObject({ status: 'in_progress' });
  });
});

describe('FR-TASK-06: score and estimate can be set and changed', () => {
  it('stores both on create and updates both later', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: 3,
      estimate_hours: 2.5,
      planned_start: null,
      due_date: null,
    });
    expect(created.score).toBe(3);
    expect(created.estimate_hours).toBe(2.5);

    const updated = await service.update(created.id, { score: 5, estimate_hours: 4 });

    expect(updated.score).toBe(5);
    expect(updated.estimate_hours).toBe(4);
    const rows = await activityLog().listForEntity('task', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ score: 5, estimate_hours: 4 });
  });
});

describe('FR-TASK-12: editing a task refuses what it must', () => {
  it('refuses an archived task until it is restored', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await service.archive(created.id);

    await expect(service.update(created.id, { name: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });

  it('moves both dates together when both are sent', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: 1_000,
      due_date: 2_000,
    });

    const updated = await service.update(created.id, { planned_start: 3_000, due_date: 4_000 });

    expect(updated.planned_start).toBe(3_000);
    expect(updated.due_date).toBe(4_000);
  });

  it('refuses a partial update that inverts due and planned start', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: 1_000,
      due_date: 2_000,
    });

    await expect(service.update(created.id, { due_date: 500 })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });

  it('refuses to edit a task in place while its project is archived', async () => {
    const service = await taskService();
    const projectId = await liveProject();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: projectId,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await projectService().archive(projectId);

    await expect(service.update(created.id, { name: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });

  it('allows the same edit when it moves the task out to “No project”', async () => {
    const service = await taskService();
    const projectId = await liveProject();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: projectId,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await projectService().archive(projectId);

    const moved = await service.update(created.id, { project_id: null });

    expect(moved.project_id).toBeNull();
    expect(moved.project_name).toBeNull();
  });

  it('moves a task to a different live project and takes the new name with it', async () => {
    const service = await taskService();
    const firstId = await liveProject('First');
    const secondId = await liveProject('Second');
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: firstId,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    const moved = await service.update(created.id, { project_id: secondId });

    expect(moved.project_id).toBe(secondId);
    expect(moved.project_name).toBe('Second');
  });
});

describe('FR-STAT-01: this service cannot move an ended task', () => {
  it('refuses any status move on a row that is already ended', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    // No writer of `ended` exists yet — the closure service arrives in 0.5.0 —
    // so the row is seeded directly. That is the point: the guard must hold
    // even for a row this service could never have produced.
    if (!harness) throw new Error('Test harness was not created.');
    await harness.knex('tasks').where({ id: created.id }).update({ status: 'ended' });

    await expect(service.update(created.id, { status: 'open' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-TASK-13: archiving hides the task without erasing it', () => {
  it('sets archived_at and records the archive', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    setNowMsForTesting(() => 1_700_000_003_600);
    const archived = await service.archive(created.id);

    expect(archived.archived_at).toBe(1_700_000_003_600);
    const rows = await activityLog().listForEntity('task', created.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('refuses to archive twice without moving the timestamp', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    setNowMsForTesting(() => 1_700_000_000_000);
    await service.archive(created.id);
    setNowMsForTesting(() => 1_700_000_003_600);

    await expect(service.archive(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    expect((await service.get(created.id, { includeArchived: true })).archived_at).toBe(
      1_700_000_000_000,
    );
  });

  it('restores, and refuses to restore what is not archived', async () => {
    const service = await taskService();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    await service.archive(created.id);
    expect((await service.restore(created.id)).archived_at).toBeNull();
  });
});

describe('DATA-11 and BR-16: default lists hide archived tasks and archived projects’ tasks', () => {
  it('hides both kinds by default and shows both when asked', async () => {
    const service = await taskService();
    const projectId = await liveProject('Hidden project');
    const hiddenByProject = await service.create({
      name: 'Under archived project',
      description: '',
      project_id: projectId,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    const archived = await service.create({
      name: 'Archived task',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    const live = await service.create({
      name: 'Live task',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await service.archive(archived.id);
    await projectService().archive(projectId);

    expect((await service.list({})).map((task) => task.id)).toEqual([live.id]);
    expect(
      (await service.list({ includeArchived: true })).map((task) => task.id).sort((a, b) => a - b),
    ).toEqual([hiddenByProject.id, archived.id, live.id].sort((a, b) => a - b));
  });

  it('answers 404 for a hidden task that was not asked for', async () => {
    const service = await taskService();
    const projectId = await liveProject();
    const created = await service.create({
      name: 'A',
      description: '',
      project_id: projectId,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await projectService().archive(projectId);

    await expect(service.get(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
    expect(await service.get(created.id, { includeArchived: true })).toMatchObject({
      id: created.id,
    });
  });
});

describe('FR-VIEW-03: the list filters and sorts', () => {
  it('filters to the “No project” bucket', async () => {
    const service = await taskService();
    const projectId = await liveProject();
    await service.create({
      name: 'Filed',
      description: '',
      project_id: projectId,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    const loose = await service.create({
      name: 'Loose',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    expect((await service.list({ projectId: 'none' })).map((task) => task.id)).toEqual([loose.id]);
  });

  it('filters by status', async () => {
    const service = await taskService();
    const open = await service.create({
      name: 'Open',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await service.create({
      name: 'Going',
      description: '',
      project_id: null,
      status: 'in_progress',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    expect((await service.list({ status: 'open' })).map((task) => task.id)).toEqual([open.id]);
  });

  it('sorts by score ascending with a stable order', async () => {
    const service = await taskService();
    await service.create({
      name: 'Big',
      description: '',
      project_id: null,
      status: 'open',
      score: 9,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await service.create({
      name: 'Small',
      description: '',
      project_id: null,
      status: 'open',
      score: 1,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    expect(
      (await service.list({ sort: 'score', direction: 'asc' })).map((task) => task.name),
    ).toEqual(['Small', 'Big']);
  });
});

describe('a missing task is a 404, not an empty row', () => {
  it('refuses to read task 999', async () => {
    const service = await taskService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update task 999', async () => {
    const service = await taskService();

    await expect(
      service.update(999, {
        name: 'Ghost',
        description: '',
        project_id: null,
        status: 'open',
        score: null,
        estimate_hours: null,
        planned_start: null,
        due_date: null,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND, status: 404 });
  });

  it('refuses to archive task 999', async () => {
    const service = await taskService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore task 999', async () => {
    const service = await taskService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
