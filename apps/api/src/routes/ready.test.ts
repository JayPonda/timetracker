import { afterEach, describe, expect, it } from 'vitest';
import { readyResponseSchema, type ReadyResponse } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function app(): Promise<TestApp> {
  harness = await createTestApp();
  return harness;
}

describe('ADR 0013: GET /ready answers whether the app can take a request', () => {
  it('returns 200 when the database is reachable and the schema is current', async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json<ReadyResponse>().status).toBe('ready');
  });

  it('is unprefixed and public, because whatever probes it knows no URL design', async () => {
    // No principal is installed, so a route that required a capability would be
    // refused with a 403 here rather than answering.
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
  });

  it('reports no pending migrations on a migrated database', async () => {
    const { app: server } = await app();
    const body = (await server.inject({ method: 'GET', url: '/ready' })).json<ReadyResponse>();

    expect(body.migrations_pending).toBe(0);
  });

  it('validates against the shared schema', async () => {
    // The browser and any future MCP client parse this with the same contract
    // the server enforces, so a shape drift fails here first.
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/ready' });

    expect(readyResponseSchema.safeParse(res.json()).success).toBe(true);
  });

  it('returns 503 when the database is unreachable', async () => {
    const { app: server, db } = await app();
    db.close();

    const res = await server.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json<ReadyResponse>().status).toBe('not_ready');
  });

  it('does not leak the raw SQLite message, which /health does publish', async () => {
    // The readiness body is read by whatever is watching the container and is
    // often more widely visible than a log. `/health` publishes the real
    // message because an owner debugging at 2am needs it; this one does not.
    const { app: server, db } = await app();
    db.close();

    const body = (await server.inject({ method: 'GET', url: '/ready' })).json<ReadyResponse>();

    expect(body.reason).toBe('database is unreachable');
    expect(body.reason).not.toMatch(/sqlite|\.db/i);
  });
});

describe('ADR 0013: /ready and /health answer different questions', () => {
  it('both report the same failure when the database is gone', async () => {
    // Documented in probes.ts. They share the check so they cannot drift; they
    // differ in what a non-answer means to the caller.
    const { app: server, db } = await app();
    db.close();

    const health = await server.inject({ method: 'GET', url: '/health' });
    const ready = await server.inject({ method: 'GET', url: '/ready' });

    expect(health.statusCode).toBe(503);
    expect(ready.statusCode).toBe(503);
  });

  it('carries no version or uptime, which belong to /health alone', async () => {
    // What makes this a second route rather than a second spelling of one.
    const { app: server } = await app();
    const body = (await server.inject({ method: 'GET', url: '/ready' })).json<ReadyResponse>();

    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('uptime_s');
  });

  it('is 503 on pending migrations where /health is still 200', async () => {
    // The documented difference, asserted end to end. An unmigrated database
    // leaves the process up and answering, which is what `DEP-06` asks
    // `/health` to report, and unable to serve, which is what `/ready` is for.
    // `probes.test.ts` proves the underlying facts; this proves the mapping.
    const { app: server } = await createTestApp({ skipMigrations: true });

    const health = await server.inject({ method: 'GET', url: '/health' });
    const ready = await server.inject({ method: 'GET', url: '/ready' });

    expect(health.statusCode).toBe(200);
    expect(health.json<{ migrations: { ok: boolean } }>().migrations.ok).toBe(false);

    expect(ready.statusCode).toBe(503);
    expect(ready.json<ReadyResponse>().status).toBe('not_ready');
    expect(ready.json<ReadyResponse>().migrations_pending).toBeGreaterThan(0);
  });
});
