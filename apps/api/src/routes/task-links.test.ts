import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  taskLinkSchema,
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

describe('FR-TASK-03: POST /tasks/:id/links adds a link', () => {
  it('returns 201 and the stored link', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/links`,
      payload: { label: 'Spec', url: 'https://example.com/spec' },
    });

    expect(res.statusCode).toBe(201);
    const link = taskLinkSchema.parse(res.json<{ link: unknown }>().link);
    expect(link.task_id).toBe(taskId);
    expect(link.position).toBe(1);
  });

  it('refuses the 4th link with a 422 naming the limit', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    for (const n of [1, 2, 3]) {
      await app.inject({
        method: 'POST',
        url: `/tasks/${taskId}/links`,
        payload: { url: `https://example.com/${n}` },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/links`,
      payload: { url: 'https://example.com/4' },
    });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.message).toContain('3');
  });

  it('rejects a non-URL with a 422 naming the field', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/links`,
      payload: { url: 'not a link' },
    });

    expect(res.statusCode).toBe(422);
    expect(
      (res.json<ErrorEnvelope>().error.details as { issues: Array<{ path: string }> }).issues[0]
        ?.path,
    ).toBe('url');
  });
});

describe('FR-TASK-03: PATCH /task-links/:id edits, archives and restores', () => {
  it('edits the label and archives then restores', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const taskId = await liveTaskId();
    const created = taskLinkSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/tasks/${taskId}/links`,
          payload: { label: 'Old', url: 'https://example.com' },
        })
      ).json<{ link: unknown }>().link,
    );

    const edited = taskLinkSchema.parse(
      (
        await app.inject({
          method: 'PATCH',
          url: `/task-links/${created.id}`,
          payload: { label: 'New' },
        })
      ).json<{ link: unknown }>().link,
    );
    expect(edited.label).toBe('New');

    const archived = taskLinkSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/task-links/${created.id}/archive` })).json<{
        link: unknown;
      }>().link,
    );
    expect(archived.archived_at).not.toBeNull();

    const restored = taskLinkSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/task-links/${created.id}/restore` })).json<{
        link: unknown;
      }>().link,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('MCP-14: the assistant may add links but may never change them', () => {
  it('allows POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });
    const taskId = await liveTaskId();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/tasks/${taskId}/links`,
          payload: { url: 'https://example.com' },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH, archive and restore before any handler runs', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    for (const req of [
      { method: 'PATCH', url: '/task-links/1', payload: { label: 'Assistant rename' } },
      { method: 'PATCH', url: '/task-links/1/archive', payload: {} },
      { method: 'PATCH', url: '/task-links/1/restore', payload: {} },
    ] as const) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    }
  });
});
