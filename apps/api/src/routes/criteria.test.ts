import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  criterionSchema,
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

async function liveTaskId(): Promise<number> {
  if (!harness) throw new Error('Test harness was not created.');
  const task = await servicesOf(harness.app).tasks.create({
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

describe('FR-AC-01: POST /tasks/:id/criteria adds a criterion', () => {
  it('returns 201 and the stored criterion', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/criteria`,
      payload: { text: 'Reads cleanly' },
    });

    expect(res.statusCode).toBe(201);
    const criterion = criterionSchema.parse(res.json<{ criterion: unknown }>().criterion);
    expect(criterion.text).toBe('Reads cleanly');
    expect(criterion.task_id).toBe(taskId);
  });

  it('rejects a blank statement with a 422 naming the field', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/criteria`,
      payload: { text: '   ' },
    });

    expect(res.statusCode).toBe(422);
    expect(
      (res.json<ErrorEnvelope>().error.details as { issues: Array<{ path: string }> }).issues[0]
        ?.path,
    ).toBe('text');
  });
});

describe('FR-AC-01: PATCH /tasks/:id/criteria/reorder reorders', () => {
  it('returns the definition in its new order', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const criteria = servicesOf(app).criteria;
    const a = await criteria.create(taskId, { text: 'A' });
    const b = await criteria.create(taskId, { text: 'B' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}/criteria/reorder`,
      payload: { order: [b.id, a.id] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ criteria: Array<{ text: string }> }>().criteria.map((c) => c.text)).toEqual([
      'B',
      'A',
    ]);
  });

  it('archives and restores through PATCH', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = await servicesOf(app).criteria.create(taskId, { text: 'A' });

    const archived = criterionSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/api/v1/criteria/${created.id}/archive` })).json<{
        criterion: unknown;
      }>().criterion,
    );
    expect(archived.archived_at).not.toBeNull();

    const restored = criterionSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/api/v1/criteria/${created.id}/restore` })).json<{
        criterion: unknown;
      }>().criterion,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('MCP-14: the assistant may add criteria but may never change them', () => {
  it('allows POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });
    const taskId = await liveTaskId();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskId}/criteria`,
          payload: { text: 'Assistant criterion' },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH, reorder, archive and restore before any handler runs', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    for (const req of [
      { method: 'PATCH', url: '/api/v1/criteria/1', payload: { text: 'Assistant restatement' } },
      { method: 'PATCH', url: '/api/v1/tasks/1/criteria/reorder', payload: { order: [1] } },
      { method: 'PATCH', url: '/api/v1/criteria/1/archive', payload: {} },
      { method: 'PATCH', url: '/api/v1/criteria/1/restore', payload: {} },
    ] as const) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    }
  });
});

describe('FR-AC-02: GET /criteria/:id reads one criterion', () => {
  it('returns the stored criterion', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = criterionSchema.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/criteria`,
        payload: { text: 'The gate is enforced in the backend' },
      })).json<{ criterion: unknown }>().criterion,
    );

    const res = await app.inject({ method: 'GET', url: `/api/v1/criteria/${created.id}` });

    expect(res.statusCode).toBe(200);
    expect(criterionSchema.parse(res.json<{ criterion: unknown }>().criterion).id).toBe(created.id);
  });

  it('is a 404 for a criterion that does not exist', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/criteria/9999' });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('DATA-09: a criterion id is validated before it reaches a service', () => {
  it('refuses a non-numeric id with a 422 rather than coercing it to 0', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/criteria/abc' });

    expect(res.statusCode).toBe(422);
    expect((res.json<ErrorEnvelope>().error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe('id');
  });

  it('refuses a zero id, which a client cannot mean', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/criteria/0' });

    expect(res.statusCode).toBe(422);
  });

  it('applies the same rule to PATCH', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/criteria/abc',
      payload: { text: 'rewritten' },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe('FR-AC-01: PATCH /criteria/:id rewrites the criterion text', () => {
  it('rewrites the text and returns it', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = criterionSchema.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/criteria`,
        payload: { text: 'The gate is enforced in the backend' },
      })).json<{ criterion: unknown }>().criterion,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/criteria/${created.id}`,
      payload: { text: 'The gate is enforced in the service layer' },
    });

    expect(res.statusCode).toBe(200);
    expect(criterionSchema.parse(res.json<{ criterion: unknown }>().criterion).text).toBe(
      'The gate is enforced in the service layer',
    );
  });

  it('refuses an empty body, because an empty criterion is not a criterion', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = criterionSchema.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/criteria`,
        payload: { text: 'The gate is enforced in the backend' },
      })).json<{ criterion: unknown }>().criterion,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/criteria/${created.id}`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
  });
});
