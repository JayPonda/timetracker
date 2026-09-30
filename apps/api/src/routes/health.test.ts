import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema, nowMs, setNowMsForTesting, type HealthResponse } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  setNowMsForTesting();
});

async function app(env?: Record<string, string>): Promise<TestApp> {
  harness = await createTestApp({ env });
  return harness;
}

describe('DEP-06: GET /health reports the app is alive', () => {
  it('returns 200 with status ok', async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json<HealthResponse>().status).toBe('ok');
  });

  it('reports the database as reachable', async () => {
    const { app: server } = await app();
    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(body.db).toBe('ok');
  });

  it('returns a version', async () => {
    const { app: server } = await app();
    expect(
      (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>().version,
    ).toBeTruthy();
  });

  it('returns an uptime in seconds', async () => {
    const { app: server } = await app();
    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(Number.isInteger(body.uptime_s)).toBe(true);
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it('reports elapsed process time, not the time the request took', async () => {
    // The regression this pins: `startedAt` was read inside the handler, so
    // `uptime_s` was the gap between arrival and response and therefore always
    // 0. Asserting only `>= 0` would pass against the broken code, which is the
    // other half of why it survived 0.1.0.
    setNowMsForTesting(() => 1_000_000);
    const { app: server } = await app();
    setNowMsForTesting(() => 1_000_000 + 90_000);

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(body.uptime_s).toBe(90);
  });

  it('matches the shared schema, so the web app can trust it', async () => {
    const { app: server } = await app();
    const body = (await server.inject({ method: 'GET', url: '/health' })).json();

    expect(healthResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe('DEP-06: the health check is a real check', () => {
  it('counts applied and pending migrations', async () => {
    const { app: server } = await app();
    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(body.migrations.applied).toBeGreaterThan(0);
    expect(body.migrations.pending).toBe(0);
    expect(body.migrations.ok).toBe(true);
  });

  it('is not ok when a migration is pending', async () => {
    // A container that is up but has not finished migrating must not claim to be
    // healthy, or `docker compose up` returns before the schema is ready.
    const { app: server, db } = await app();
    db.prepare(
      'DELETE FROM knex_migrations WHERE id = (SELECT MAX(id) FROM knex_migrations)',
    ).run();

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();
    expect(body.migrations.pending).toBe(1);
    expect(body.migrations.ok).toBe(false);
  });
});

describe('DEP-06: the health check fails loudly when the database is gone', () => {
  it('returns 503 with db error', async () => {
    // Acceptance criterion 2: a container that is up but broken must not report
    // itself healthy.
    const { app: server, db } = await app();
    db.close();

    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json<HealthResponse>().db).toBe('error');
  });

  it('names the reason so the owner can act on it', async () => {
    const { app: server, db } = await app();
    db.close();

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();
    expect(body.db_error).toBeTruthy();
  });
});

describe('DEP-05, NFR-TIME-01: the health endpoint reports the configured zone', () => {
  it('reports Asia/Kolkata when TZ says so', async () => {
    const { app: server } = await app({ TZ: 'Asia/Kolkata' });
    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(body.time_zone).toBe('Asia/Kolkata');
  });
});

describe('every response carries a request id', () => {
  it('sets x-request-id', async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/health' });

    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('echoes an id the caller supplied, for correlating a bug report', async () => {
    const { app: server } = await app();
    const res = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-me-123' },
    });

    expect(res.headers['x-request-id']).toBe('trace-me-123');
  });
});

describe('the error envelope is used for every failure', () => {
  it('an unknown API route returns the envelope, not HTML', async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(
      res.json<{ error: { code: string; message: string; status: number } }>().error.code,
    ).toBe('not_found');
  });

  it('the envelope carries the request id', async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/api/nope' });

    expect(res.json<{ error: { request_id?: string } }>().error.request_id).toBeTruthy();
  });
});

describe('DEP-11: the app serves the built frontend from the same process', () => {
  async function appWithWeb(): Promise<TestApp> {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const webDir = mkdtempSync(join(tmpdir(), 'pdm-web-'));
    mkdirSync(join(webDir, 'assets'), { recursive: true });
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>PDM</title>', 'utf8');
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)', 'utf8');

    harness = await createTestApp({ env: { PDM_WEB_DIR: webDir } });
    return harness;
  }

  it('serves index.html at the root', async () => {
    const { app: server } = await appWithWeb();
    const res = await server.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('PDM');
  });

  it('falls back to index.html for a client-side route', async () => {
    const { app: server } = await appWithWeb();
    // This must be a path no API route claims: it was `/tasks/42` until the
    // task routes landed and it became a 403 from the capability guard instead
    // of the fallback. Claiming this path for an API route means updating this
    // example, which is the test doing its job.
    const res = await server.inject({ method: 'GET', url: '/calendar/42' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('PDM');
  });

  it('returns 404 for a missing asset instead of masking it as index.html', async () => {
    // Answering a script request with HTML gives a MIME-type error in the
    // browser that says nothing about the real cause.
    const { app: server } = await appWithWeb();
    const res = await server.inject({ method: 'GET', url: '/assets/missing.js' });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<!doctype html>');
  });

  it('serves a real asset', async () => {
    const { app: server } = await appWithWeb();
    const res = await server.inject({ method: 'GET', url: '/assets/app.js' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('console.log');
  });

  it('does not let the SPA fallback shadow the health route', async () => {
    const { app: server } = await appWithWeb();
    const res = await server.inject({ method: 'GET', url: '/health' });

    expect(res.json<HealthResponse>().status).toBe('ok');
  });
});

describe('DEP-05 / NFR-TIME-01: /health carries the clock and the zone the shell renders in', () => {
  it('reports the server clock so the shell never reads the browser clock', async () => {
    setNowMsForTesting(() => 1_790_604_309_000);
    const { app: server } = await app();

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    // Acceptance criterion 11: the shell formats this value, so the time shown
    // is the server's and the zone is the configured one, not the browser's.
    expect(body.now_ms).toBe(1_790_604_309_000);
  });

  it('reports the frozen clock rather than the real one', async () => {
    const before = nowMs();
    setNowMsForTesting(() => 42);
    const { app: server } = await app();

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(body.now_ms).toBe(42);
    expect(before).not.toBe(42);
  });

  it('reports a zone Intl can use, not just whatever TZ said', async () => {
    // `PDM_TZ` in `.env` reaches the process as `TZ`; compose maps it.
    const { app: server } = await app({ TZ: 'Asia/Kolkata' });

    const body = (await server.inject({ method: 'GET', url: '/health' })).json<HealthResponse>();

    expect(body.time_zone).toBe('Asia/Kolkata');
  });

  it('still validates against the shared schema', async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: 'GET', url: '/health' });

    expect(healthResponseSchema.safeParse(res.json()).success).toBe(true);
  });
});
