import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  tagSchema,
  type ErrorEnvelope,
} from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
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

describe('FR-TAG-01: POST /tags creates a tag', () => {
  it('returns 201 and the stored tag', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'review' },
    });

    expect(res.statusCode).toBe(201);
    const tag = tagSchema.parse(res.json<{ tag: unknown }>().tag);
    expect(tag.name).toBe('review');
    expect(tag.colour).toBe('#6b7280');
  });

  it('refuses a duplicate live name with a 422 naming it', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    await app.inject({ method: 'POST', url: '/tags', payload: { name: 'review' } });

    const res = await app.inject({ method: 'POST', url: '/tags', payload: { name: 'review' } });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.message).toContain('review');
  });
});

describe('FR-TAG-05: PATCH /tags/:id/archive hides, PATCH /tags/:id/restore brings back', () => {
  it('archives and restores through PATCH', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = tagSchema.parse(
      (await app.inject({ method: 'POST', url: '/tags', payload: { name: 'review' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const archived = tagSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/tags/${created.id}/archive` })).json<{
        tag: unknown;
      }>().tag,
    );
    expect(archived.archived_at).not.toBeNull();

    const listed = await app.inject({ method: 'GET', url: '/tags' });
    expect(listed.json<{ tags: unknown[] }>().tags).toEqual([]);

    const restored = tagSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/tags/${created.id}/restore` })).json<{
        tag: unknown;
      }>().tag,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('MCP-14: the assistant may read and create tags but may never mutate them', () => {
  it('allows GET and POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    expect((await app.inject({ method: 'GET', url: '/tags' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/tags', payload: { name: 'review' } })).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH, archive and restore before any handler runs', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    for (const req of [
      { method: 'PATCH', url: '/tags/1', payload: { name: 'Assistant rename' } },
      { method: 'PATCH', url: '/tags/1/archive', payload: {} },
      { method: 'PATCH', url: '/tags/1/restore', payload: {} },
    ] as const) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    }
  });
});
