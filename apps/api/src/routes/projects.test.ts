import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ERROR_CODES,
  LOCAL_USER_CAPABILITIES,
  MCP_MAX_CAPABILITIES,
  projectSchema,
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

describe('FR-PRJ-01: POST /projects creates a project', () => {
  it('returns 201 and the stored project', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'Client work', colour: '#4f46e5' },
    });

    expect(res.statusCode).toBe(201);
    const project = projectSchema.parse(res.json<{ project: unknown }>().project);
    expect(project.name).toBe('Client work');
    expect(project.description).toBe('');
  });
});

describe('UI-08: a bad project payload names the field and keeps the secret', () => {
  it('returns 422 with a colour issue and does not echo the submitted value', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'Bad colour', colour: 'not-a-colour' },
    });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((body.error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe(
      'colour',
    );
    expect(res.body).not.toContain('not-a-colour');
  });

  it('rejects an empty PATCH, because it changes nothing', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = projectSchema.parse(
      (
        await app.inject({ method: 'POST', url: '/projects', payload: { name: 'Website' } })
      ).json<{ project: unknown }>().project,
    );

    const res = await app.inject({ method: 'PATCH', url: `/projects/${created.id}`, payload: {} });

    expect(res.statusCode).toBe(422);
    expect(
      (res.json<ErrorEnvelope>().error.details as { issues: Array<{ path: string }> }).issues[0]
        ?.path,
    ).toBe('(root)');
  });
});

describe('DATA-11: GET /projects hides archived projects by default', () => {
  it('omits an archived project unless include_archived=true', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const projects = servicesOf(app).projects;
    const live = await projects.create({ name: 'Live', description: '', colour: '#4f46e5' });
    const archived = await projects.create({ name: 'Old', description: '', colour: '#4f46e5' });
    await projects.archive(archived.id);

    const hidden = await app.inject({ method: 'GET', url: '/projects' });
    const shown = await app.inject({ method: 'GET', url: '/projects?include_archived=true' });

    expect(hidden.json<{ projects: Array<{ id: number }> }>().projects.map((p) => p.id)).toEqual([
      live.id,
    ]);
    expect(shown.json<{ projects: Array<{ id: number }> }>().projects.map((p) => p.id)).toEqual([
      live.id,
      archived.id,
    ]);
  });
});

describe('FR-PRJ-03 and FR-PRJ-04: archive and restore are reversible PATCH routes', () => {
  it('archives with PATCH and restores with PATCH', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });
    const created = projectSchema.parse(
      (
        await app.inject({ method: 'POST', url: '/projects', payload: { name: 'Website' } })
      ).json<{ project: unknown }>().project,
    );

    const archived = projectSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/projects/${created.id}/archive` })).json<{
        project: unknown;
      }>().project,
    );
    expect(archived.archived_at).not.toBeNull();

    const restored = projectSchema.parse(
      (await app.inject({ method: 'PATCH', url: `/projects/${created.id}/restore` })).json<{
        project: unknown;
      }>().project,
    );
    expect(restored.archived_at).toBeNull();
  });
});

describe('path and missing projects are answered precisely', () => {
  it('rejects a non-numeric id before touching the service', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/projects/not-a-number' });

    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('answers 404 for a project that does not exist', async () => {
    const { app } = await appHolding({ holds: LOCAL_USER_CAPABILITIES });

    const res = await app.inject({ method: 'GET', url: '/projects/999' });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});

describe('MCP-14: the assistant may read projects but may not write them', () => {
  it('allows GET /projects with the assistant capability set', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    expect((await app.inject({ method: 'GET', url: '/projects' })).statusCode).toBe(200);
  });

  it('refuses POST /projects before the handler writes anything', async () => {
    const { app } = await appHolding({ holds: MCP_MAX_CAPABILITIES, kind: 'mcp_token' });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'Assistant project' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
    expect(await servicesOf(app).projects.list()).toEqual([]);
  });
});
