import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  referenceSchema,
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

describe('FR-REF-01: POST /tasks/:id/references adds a reference', () => {
  it('returns 201 and the stored reference', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/references`,
      payload: { title: 'What I learned', type: 'lesson' },
    });

    expect(res.statusCode).toBe(201);
    const reference = referenceSchema.parse(res.json<{ reference: unknown }>().reference);
    expect(reference.task_id).toBe(taskId);
    expect(reference.type).toBe('lesson');
  });

  it('rejects a bad type with a 422', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/references`,
      payload: { title: 'T', type: 'attachment' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('FR-REF-01: PATCH /references/:id edits, archives and restores', () => {
  it('edits the body and archives then restores', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = referenceSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/tasks/${taskId}/references`,
          payload: { title: 'Notes', body: 'Old words' },
        })
      ).json<{ reference: unknown }>().reference,
    );

    const edited = referenceSchema.parse(
      (
        await app.inject({
          method: 'PATCH',
          url: `/references/${created.id}`,
          payload: { body: 'New words' },
        })
      ).json<{ reference: unknown }>().reference,
    );
    expect(edited.body).toBe('New words');

    const archived = referenceSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/references/${created.id}/archive` })).json<{
        reference: unknown;
      }>().reference,
    );
    expect(archived.archived_at).not.toBeNull();

    const restored = referenceSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/references/${created.id}/restore` })).json<{
        reference: unknown;
      }>().reference,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('MCP-14: the assistant may add references but may never change them', () => {
  it('allows POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });
    const taskId = await liveTaskId();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/tasks/${taskId}/references`,
          payload: { title: 'Assistant note' },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH, archive and restore before any handler runs', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    for (const req of [
      { method: 'PATCH', url: '/references/1', payload: { body: 'Assistant edit' } },
      { method: 'PATCH', url: '/references/1/archive', payload: {} },
      { method: 'PATCH', url: '/references/1/restore', payload: {} },
    ] as const) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    }
  });
});
