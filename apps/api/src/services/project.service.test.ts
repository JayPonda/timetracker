import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, projectSchema, setNowMsForTesting } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function projectService() {
  harness = await createTestApp();
  return servicesOf(harness.app).projects;
}

function activityLog() {
  if (!harness) throw new Error('Test harness was not created.');
  return servicesOf(harness.app).activityLog;
}

describe('FR-PRJ-01: creating a project stores it and records the creation', () => {
  it('assigns a uid and timestamps from the injected clock', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await projectService();

    const project = await service.create({ name: 'Client work', description: '', colour: '#4f46e5' });

    expect(projectSchema.parse(project)).toEqual(project);
    expect(project.created_at).toBe(1_700_000_000_000);
    expect(project.updated_at).toBe(1_700_000_000_000);
    expect(project.archived_at).toBeNull();
    expect(project.uid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('writes one created history row in the same operation', async () => {
    const service = await projectService();
    const project = await service.create({ name: 'Client work', description: '', colour: '#4f46e5' });

    const rows = await activityLog().listForEntity('project', project.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toMatchObject({ name: 'Client work' });
  });
});

describe('FR-PRJ-03: renaming a project records only the changed field', () => {
  it('updates the row and logs the new name', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await projectService();
    const created = await service.create({ name: 'Old name', description: 'Same', colour: '#4f46e5' });

    setNowMsForTesting(() => 1_700_000_003_600);
    const updated = await service.update(created.id, { name: 'New name' });

    expect(updated.name).toBe('New name');
    expect(updated.updated_at).toBe(1_700_000_003_600);
    const rows = await activityLog().listForEntity('project', created.id);
    expect(rows[0]?.action).toBe('updated');
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ name: 'New name' });
  });
});

describe('FR-PRJ-03: each editable field can change on its own', () => {
  it('updates only the description when only the description is sent', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: 'Old', colour: '#4f46e5' });

    const updated = await service.update(created.id, { description: 'New' });

    expect(updated).toMatchObject({ name: 'Website', description: 'New', colour: '#4f46e5' });
    const rows = await activityLog().listForEntity('project', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ description: 'New' });
  });

  it('updates only the colour when only the colour is sent', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: 'Same', colour: '#4f46e5' });

    const updated = await service.update(created.id, { colour: '#0ea5e9' });

    expect(updated).toMatchObject({ name: 'Website', description: 'Same', colour: '#0ea5e9' });
    const rows = await activityLog().listForEntity('project', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ colour: '#0ea5e9' });
  });
});

describe('FR-PRJ-03: an archived project is not editable', () => {
  it('refuses the edit and tells the owner to restore first', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: '', colour: '#4f46e5' });
    await service.archive(created.id);

    await expect(service.update(created.id, { name: 'Changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
    expect((await service.get(created.id, { includeArchived: true })).name).toBe('Website');
  });
});

describe('FR-PRJ-04: archiving hides the project without erasing it', () => {
  it('sets archived_at and records the archive', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: '', colour: '#4f46e5' });

    setNowMsForTesting(() => 1_700_000_003_600);
    const archived = await service.archive(created.id);

    expect(archived.archived_at).toBe(1_700_000_003_600);
    const rows = await activityLog().listForEntity('project', created.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('refuses to archive twice without moving the archive timestamp', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: '', colour: '#4f46e5' });

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
});

describe('FR-PRJ-03: restoring brings an archived project back', () => {
  it('clears archived_at and records the restore', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: '', colour: '#4f46e5' });
    await service.archive(created.id);

    const restored = await service.restore(created.id);

    expect(restored.archived_at).toBeNull();
    const rows = await activityLog().listForEntity('project', created.id);
    expect(rows[0]?.action).toBe('restored');
  });

  it('refuses to restore a project that is not archived', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: '', colour: '#4f46e5' });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('DATA-11: default lists and lookups hide archived projects', () => {
  it('lists live projects by name and omits archived ones by default', async () => {
    const service = await projectService();
    const beta = await service.create({ name: 'Beta', description: '', colour: '#4f46e5' });
    await service.create({ name: 'Alpha', description: '', colour: '#4f46e5' });
    await service.archive(beta.id);

    expect((await service.list()).map((project) => project.name)).toEqual(['Alpha']);
    expect((await service.list({ includeArchived: true })).map((project) => project.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('answers 404 for an archived project that was not asked for', async () => {
    const service = await projectService();
    const created = await service.create({ name: 'Website', description: '', colour: '#4f46e5' });
    await service.archive(created.id);

    await expect(service.get(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
    expect(await service.get(created.id, { includeArchived: true })).toMatchObject({
      id: created.id,
    });
  });
});

describe('FR-PRJ-01: a missing project is a 404, not an empty row', () => {
  it('refuses to read project 999', async () => {
    const service = await projectService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update project 999', async () => {
    const service = await projectService();

    await expect(service.update(999, { name: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to archive project 999', async () => {
    const service = await projectService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore project 999', async () => {
    const service = await projectService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
