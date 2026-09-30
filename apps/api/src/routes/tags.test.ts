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
      url: '/api/v1/tags',
      payload: { name: 'review' },
    });

    expect(res.statusCode).toBe(201);
    const tag = tagSchema.parse(res.json<{ tag: unknown }>().tag);
    expect(tag.name).toBe('review');
    expect(tag.colour).toBe('#6b7280');
  });

  it('refuses a duplicate live name with a 422 naming it', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } });

    const res = await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } });
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
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const archived = tagSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/api/v1/tags/${created.id}/archive` })).json<{
        tag: unknown;
      }>().tag,
    );
    expect(archived.archived_at).not.toBeNull();

    const listed = await app.inject({ method: 'GET', url: '/api/v1/tags' });
    expect(listed.json<{ tags: unknown[] }>().tags).toEqual([]);

    const restored = tagSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/api/v1/tags/${created.id}/restore` })).json<{
        tag: unknown;
      }>().tag,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('FR-TAG-02: GET /tags/:id reads one tag', () => {
  it('returns the stored tag', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = tagSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const res = await app.inject({ method: 'GET', url: `/api/v1/tags/${created.id}` });

    expect(res.statusCode).toBe(200);
    expect(tagSchema.parse(res.json<{ tag: unknown }>().tag).id).toBe(created.id);
  });

  it('is a 404 for a tag that does not exist, not an empty 200', async () => {
    // The distinction that matters to a client: "no such tag" and "here is a
    // tag with nothing in it" are different answers and must not share a shape.
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/tags/9999' });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('DATA-09: a path parameter is validated before it reaches a service', () => {
  it('refuses a non-numeric id with a 422 rather than coercing it to 0', async () => {
    // `Number('abc')` is NaN and `Number('')` is 0, so an unchecked parse would
    // query for row 0 and answer "not found" — a 404 that looks like a missing
    // tag rather than a malformed request. The two are different bugs.
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/tags/abc' });

    expect(res.statusCode).toBe(422);
    const body = res.json<ErrorEnvelope>();
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((body.error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe('id');
  });

  it('refuses a fractional id, because a row id is always whole', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/tags/1.5' });

    expect(res.statusCode).toBe(422);
  });

  it('refuses a zero id', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/tags/0' });

    expect(res.statusCode).toBe(422);
  });

  it('refuses a negative id', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/api/v1/tags/-1' });

    expect(res.statusCode).toBe(422);
  });

  it('applies the same rule to PATCH, so a rename cannot target row 0', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tags/abc',
      payload: { name: 'renamed' },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe('FR-TAG-01: PATCH /tags/:id renames and re-colours', () => {
  it('renames the tag and returns it', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = tagSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${created.id}`,
      payload: { name: 'reviewed' },
    });

    expect(res.statusCode).toBe(200);
    expect(tagSchema.parse(res.json<{ tag: unknown }>().tag).name).toBe('reviewed');
  });

  it('re-colours the tag', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = tagSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${created.id}`,
      payload: { colour: '#ff0000' },
    });

    expect(tagSchema.parse(res.json<{ tag: unknown }>().tag).colour).toBe('#ff0000');
  });

  it('refuses an empty body with a 422 naming the field', async () => {
    // A PATCH that changed nothing is a client bug worth surfacing, not a
    // silent 200 — otherwise a form bug looks like a save that worked.
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = tagSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/tags/${created.id}`, payload: {} });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses a rename onto a live name another tag already holds', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } });
    const second = tagSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'deploy' } })).json<{
        tag: unknown;
      }>().tag,
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${second.id}`,
      payload: { name: 'review' },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe('MCP-14: the assistant may read and create tags but may never mutate them', () => {
  it('allows GET and POST with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    expect((await app.inject({ method: 'GET', url: '/api/v1/tags' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/tags', payload: { name: 'review' } })).statusCode,
    ).toBe(201);
  });

  it('refuses PATCH, archive and restore before any handler runs', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    for (const req of [
      { method: 'PATCH', url: '/api/v1/tags/1', payload: { name: 'Assistant rename' } },
      { method: 'PATCH', url: '/api/v1/tags/1/archive', payload: {} },
      { method: 'PATCH', url: '/api/v1/tags/1/restore', payload: {} },
    ] as const) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    }
  });
});
