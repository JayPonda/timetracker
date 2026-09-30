import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  todoSchema,
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

describe('FR-TODO-01: POST /tasks/:id/todos adds a todo', () => {
  it('returns 201 and the stored todo', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/todos`,
      payload: { title: 'Draft the outline' },
    });

    expect(res.statusCode).toBe(201);
    const todo = todoSchema.parse(res.json<{ todo: unknown }>().todo);
    expect(todo.title).toBe('Draft the outline');
    expect(todo.task_id).toBe(taskId);
    expect(todo.done).toBe(false);
  });

  it('answers 404 for a task that does not exist', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/999/todos',
      payload: { title: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('FR-TODO-01: PATCH /tasks/:id/todos/reorder reorders', () => {
  it('returns the timeline in its new order', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const todos = servicesOf(app).todos;
    const a = await todos.create(taskId, { title: 'A', note: '', estimate_hours: null });
    const b = await todos.create(taskId, { title: 'B', note: '', estimate_hours: null });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}/todos/reorder`,
      payload: { order: [b.id, a.id] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ todos: Array<{ title: string }> }>().todos.map((todo) => todo.title)).toEqual([
      'B',
      'A',
    ]);
  });

  it('refuses a repeated id with a 422', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}/todos/reorder`,
      payload: { order: [1, 1] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('FR-TODO-02: PATCH /todos/:id ticks without a client date', () => {
  it('marks done and stamps done_at', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = await servicesOf(app).todos.create(taskId, {
      title: 'A',
      note: '',
      estimate_hours: null,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/todos/${created.id}`,
      payload: { done: true },
    });

    expect(res.statusCode).toBe(200);
    const todo = todoSchema.parse(res.json<{ todo: unknown }>().todo);
    expect(todo.done).toBe(true);
    expect(todo.done_at).not.toBeNull();
  });

  it('archives and restores through PATCH', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = await servicesOf(app).todos.create(taskId, {
      title: 'A',
      note: '',
      estimate_hours: null,
    });

    const archived = todoSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/api/v1/todos/${created.id}/archive` })).json<{
        todo: unknown;
      }>().todo,
    );
    expect(archived.archived_at).not.toBeNull();

    const restored = todoSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/api/v1/todos/${created.id}/restore` })).json<{
        todo: unknown;
      }>().todo,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('MCP-14: the assistant may add todos but may never change them', () => {
  it('allows POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });
    const taskId = await liveTaskId();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskId}/todos`,
          payload: { title: 'Assistant todo' },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH, reorder, archive and restore before any handler runs', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    for (const req of [
      { method: 'PATCH', url: '/api/v1/todos/1', payload: { title: 'Assistant rename' } },
      { method: 'PATCH', url: '/api/v1/tasks/1/todos/reorder', payload: { order: [1] } },
      { method: 'PATCH', url: '/api/v1/todos/1/archive', payload: {} },
      { method: 'PATCH', url: '/api/v1/todos/1/restore', payload: {} },
    ] as const) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    }
  });
});
