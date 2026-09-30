import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  taskSchema,
  type ErrorEnvelope,
} from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from '../middleware/services.js';
import { principalResolver } from './test-support.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function appHolding(options: {
  holds: readonly (typeof CAPABILITIES)[keyof typeof CAPABILITIES][];
  kind?: 'local_user' | 'mcp_token' | 'anonymous';
}): Promise<TestApp> {
  harness = await createTestApp({
    principalResolver: principalResolver({
      kind: options.kind ?? 'local_user',
      holds: options.holds,
    }),
  });
  return harness;
}

describe('FR-TASK-01: POST /tasks creates a task', () => {
  it('returns 201 and the stored task', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { name: 'Write the spec', estimate_hours: 2.5 },
    });

    expect(res.statusCode).toBe(201);
    const task = taskSchema.parse(res.json<{ task: unknown }>().task);
    expect(task.name).toBe('Write the spec');
    expect(task.project_name).toBeNull();
  });
});

describe('FR-STAT-01: no route can set ended', () => {
  it('rejects ended on create with a 422 naming the field', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { name: 'A', status: 'ended' },
    });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((body.error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe(
      'status',
    );
  });

  it('rejects ended on update with a 422 naming the field', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = taskSchema.parse(
      (await app.inject({ method: 'POST', url: '/tasks', payload: { name: 'A' } })).json<{
        task: unknown;
      }>().task,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${created.id}`,
      payload: { status: 'ended' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('FR-VIEW-03: GET /tasks filters to the “No project” bucket and sorts', () => {
  it('returns the loose task for project_id=none and sorts by name', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const tasks = servicesOf(app).tasks;
    const project = await servicesOf(app).projects.create({
      name: 'Filed under',
      description: '',
      colour: '#4f46e5',
    });
    await tasks.create({
      name: 'Beta',
      description: '',
      project_id: project.id,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
    await tasks.create({
      name: 'Alpha',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });

    const bucket = await app.inject({ method: 'GET', url: '/tasks?project_id=none' });
    const sorted = await app.inject({ method: 'GET', url: '/tasks?sort=name&direction=asc' });

    expect(
      bucket.json<{ tasks: Array<{ name: string }> }>().tasks.map((task) => task.name),
    ).toEqual(['Alpha']);
    expect(
      sorted.json<{ tasks: Array<{ name: string }> }>().tasks.map((task) => task.name),
    ).toEqual(['Alpha', 'Beta']);
  });
});

describe('FR-TASK-13: archive and restore are reversible PATCH routes', () => {
  it('archives with PATCH and restores with PATCH', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = taskSchema.parse(
      (await app.inject({ method: 'POST', url: '/tasks', payload: { name: 'A' } })).json<{
        task: unknown;
      }>().task,
    );

    const archived = taskSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/tasks/${created.id}/archive` })).json<{
        task: unknown;
      }>().task,
    );
    expect(archived.archived_at).not.toBeNull();

    const restored = taskSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/tasks/${created.id}/restore` })).json<{
        task: unknown;
      }>().task,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('path and missing tasks are answered precisely', () => {
  it('rejects a non-numeric id before touching the service', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/tasks/not-a-number' });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('answers 404 for a task that does not exist', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/tasks/999' });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('MCP-14: the assistant may read and create tasks but may never mutate them', () => {
  it('allows GET and POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    expect((await app.inject({ method: 'GET', url: '/tasks' })).statusCode).toBe(200);
    expect(
      (
        await app.inject({ method: 'POST', url: '/tasks', payload: { name: 'Assistant task' } })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH before the handler writes anything', async () => {
    // The guard runs before the handler, so the refusal is proven whether or
    // not task 1 exists. That a denied write leaves nothing behind is proven
    // generically in capability.test.ts.
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/tasks/1',
      payload: { name: 'Assistant rename' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
  });
});
