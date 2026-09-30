import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, setNowMsForTesting, tagSchema } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function tagService() {
  harness = await createTestApp();
  return servicesOf(harness.app).tags;
}

function activityLog() {
  if (!harness) throw new Error('Test harness was not created.');
  return servicesOf(harness.app).activityLog;
}

describe('FR-TAG-01: creating a tag stores it and records the creation', () => {
  it('assigns a uid and timestamps from the injected clock', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await tagService();

    const tag = await service.create({ name: 'review', colour: '#4f46e5' });

    expect(tagSchema.parse(tag)).toEqual(tag);
    expect(tag.created_at).toBe(1_700_000_000_000);
    expect(tag.archived_at).toBeNull();
    expect(tag.uid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const rows = await activityLog().listForEntity('tag', tag.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('created');
  });

  it('refuses a name a live tag already holds, with the name in the message', async () => {
    const service = await tagService();
    await service.create({ name: 'review', colour: '#4f46e5' });

    const failure = await service
      .create({ name: 'review', colour: '#0ea5e9' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
    expect(String((failure as Error).message)).toContain('review');
  });

  it('releases the name when the holder is archived', async () => {
    const service = await tagService();
    const old = await service.create({ name: 'review', colour: '#4f46e5' });
    await service.archive(old.id);

    const next = await service.create({ name: 'review', colour: '#0ea5e9' });

    expect(next.id).not.toBe(old.id);
    expect(next.colour).toBe('#0ea5e9');
  });
});

describe('FR-TAG-01: renaming records only the changed field', () => {
  it('updates the name and logs the new one', async () => {
    const service = await tagService();
    const created = await service.create({ name: 'review', colour: '#4f46e5' });

    const updated = await service.update(created.id, { name: 'deep-review' });

    expect(updated.name).toBe('deep-review');
    const rows = await activityLog().listForEntity('tag', created.id);
    expect(JSON.parse(rows[0]?.after_json ?? '{}')).toEqual({ name: 'deep-review' });
  });

  it('refuses a rename onto a live name', async () => {
    const service = await tagService();
    await service.create({ name: 'review', colour: '#4f46e5' });
    const other = await service.create({ name: 'meeting', colour: '#4f46e5' });

    await expect(service.update(other.id, { name: 'review' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });

  it('refuses to edit an archived tag until it is restored', async () => {
    const service = await tagService();
    const created = await service.create({ name: 'review', colour: '#4f46e5' });
    await service.archive(created.id);

    await expect(service.update(created.id, { name: 'changed' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('FR-TAG-05: archiving hides the tag without erasing it', () => {
  it('sets archived_at, hides it from default lists, and records the archive', async () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const service = await tagService();
    const created = await service.create({ name: 'review', colour: '#4f46e5' });

    setNowMsForTesting(() => 1_700_000_003_600);
    const archived = await service.archive(created.id);

    expect(archived.archived_at).toBe(1_700_000_003_600);
    expect(await service.list()).toEqual([]);
    expect((await service.list({ includeArchived: true })).map((tag) => tag.id)).toEqual([
      created.id,
    ]);
    const rows = await activityLog().listForEntity('tag', created.id);
    expect(rows[0]?.action).toBe('archived');
  });

  it('refuses to archive twice without moving the timestamp', async () => {
    const service = await tagService();
    const created = await service.create({ name: 'review', colour: '#4f46e5' });

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

describe('FR-TAG-05: restoring refuses a name taken meanwhile', () => {
  it('restores when the name is free', async () => {
    const service = await tagService();
    const created = await service.create({ name: 'review', colour: '#4f46e5' });
    await service.archive(created.id);

    expect((await service.restore(created.id)).archived_at).toBeNull();
  });

  it('refuses when a new live tag holds the name, naming it', async () => {
    const service = await tagService();
    const old = await service.create({ name: 'review', colour: '#4f46e5' });
    await service.archive(old.id);
    await service.create({ name: 'review', colour: '#0ea5e9' });

    const failure = await service.restore(old.id).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, status: 422 });
    expect(String((failure as Error).message)).toContain('review');
  });

  it('refuses to restore a tag that is not archived', async () => {
    const service = await tagService();
    const created = await service.create({ name: 'review', colour: '#4f46e5' });

    await expect(service.restore(created.id)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
    });
  });
});

describe('a missing tag is a 404, not an empty row', () => {
  it('refuses to read tag 999', async () => {
    const service = await tagService();

    await expect(service.get(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to update tag 999', async () => {
    const service = await tagService();

    await expect(service.update(999, { name: 'Ghost' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to archive tag 999', async () => {
    const service = await tagService();

    await expect(service.archive(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });

  it('refuses to restore tag 999', async () => {
    const service = await tagService();

    await expect(service.restore(999)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
    });
  });
});
