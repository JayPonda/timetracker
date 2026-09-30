import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITIES, ERROR_CODES, type Capability, type ErrorEnvelope } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { principalWith } from '../middleware/principal.js';
import { RouteTable, registerRoutes } from './table.js';
import { principalResolver, protectedRoute } from './test-support.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

/**
 * A server whose test route needs a capability, with a caller holding a chosen
 * set. The route goes through the real table and the real guard, because
 * `extraRoutes` is declared rather than registered by hand.
 */
async function appHolding(options: {
  requires: readonly Capability[];
  holds: readonly Capability[];
  kind?: 'local_user' | 'mcp_token' | 'anonymous';
}): Promise<TestApp> {
  harness = await createTestApp({
    principalResolver: principalResolver({
      kind: options.kind ?? 'mcp_token',
      holds: options.holds,
    }),
    extraRoutes: protectedRoute(options.requires),
  });
  return harness;
}

describe('criterion 12: a principal without the capability is refused with 403', () => {
  it('refuses a write from a principal that may only read', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_CREATE],
      holds: [CAPABILITIES.TASK_READ],
    });

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} });

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
  });

  it('names the missing capability in the message', async () => {
    const { app } = await appHolding({ requires: [CAPABILITIES.TASK_CREATE], holds: [] });

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} });

    // An operator reading a 403 in a log is trying to work out which token is
    // missing what, so the message says it.
    expect(res.json<ErrorEnvelope>().error.message).toContain('task:create');
  });

  it('refuses a principal holding nothing', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_READ],
      holds: [],
      kind: 'anonymous',
    });

    expect((await app.inject({ method: 'GET', url: '/api/v1/test-protected' })).statusCode).toBe(403);
  });

  it('refuses before the handler runs, so a denied write leaves nothing behind', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_CREATE],
      holds: [CAPABILITIES.TASK_READ],
    });

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} });

    // The point of MCP-14 is that a denied write has no effect, so the handler's
    // side effect must not have happened.
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('handler-ran');
  });

  it('carries the request id, so the refusal can be found in the log', async () => {
    const { app } = await appHolding({ requires: [CAPABILITIES.TASK_CREATE], holds: [] });

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} });

    expect(res.json<ErrorEnvelope>().error.request_id).toBe(res.headers['x-request-id']);
  });

  it('refuses on a read as well as a write', async () => {
    const { app } = await appHolding({ requires: [CAPABILITIES.TASK_READ], holds: [] });

    expect((await app.inject({ method: 'GET', url: '/api/v1/test-protected' })).statusCode).toBe(403);
  });
});

describe('production resolves the local user when no resolver is installed', () => {
  it('serves reads and writes instead of refusing everything with 403', async () => {
    // Production passes no resolver, so this is production's shape. Before the
    // default was installed in createServer, every guarded route refused with
    // 403 — the interface loaded and could do nothing — while every test, each
    // installing its own resolver, stayed green.
    harness = await createTestApp();

    expect((await harness.app.inject({ method: 'GET', url: '/api/v1/projects' })).statusCode).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          payload: { name: 'Production project' },
        })
      ).statusCode,
    ).toBe(201);
  });
});

describe('criterion 12: a principal holding the capability is allowed', () => {
  it('reaches the handler', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_CREATE],
      holds: [CAPABILITIES.TASK_CREATE],
    });

    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} })).statusCode,
    ).toBe(200);
  });

  it('is allowed when it holds every capability the route needs', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_READ, CAPABILITIES.TASK_CREATE],
      holds: [CAPABILITIES.TASK_READ, CAPABILITIES.TASK_CREATE],
    });

    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} })).statusCode,
    ).toBe(200);
  });

  it('is refused when it holds only some of what the route needs', async () => {
    // The `every` in the guard, not a `some`: holding read is not enough for a
    // route that needs read and write.
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_READ, CAPABILITIES.TASK_UPDATE],
      holds: [CAPABILITIES.TASK_READ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/test-protected' });
    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorEnvelope>().error.message).toContain('task:update');
  });
});

describe('MCP-14: the assistant cannot reach a mutating route', () => {
  it('is refused task:close, which is the one that writes a closure record', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_CLOSE],
      holds: [CAPABILITIES.TASK_CREATE],
    });

    // Closing a task is the human accountability step (FR-GATE-08), and
    // MCP_MAX_CAPABILITIES omits it. A read-and-create principal must not reach
    // the route by any path.
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} })).statusCode,
    ).toBe(403);
  });
});

describe('criterion 7: the app has no DELETE route', () => {
  it('answers 404 for a DELETE on the test route rather than routing it', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_UPDATE],
      holds: [CAPABILITIES.TASK_UPDATE],
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/test-protected' });

    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('answers 404 for a DELETE on a route that does exist', async () => {
    const { app } = await appHolding({ requires: [], holds: [] });

    // Even with every capability held, there is no DELETE. The local user cannot
    // delete either, which is the point.
    expect((await app.inject({ method: 'DELETE', url: '/health' })).statusCode).toBe(404);
  });
});

describe('the route audit refuses to boot on an undeclared route', () => {
  it('fails when a route is registered outside the table', async () => {
    // This is what makes "every route declares its capabilities" checkable rather
    // than conventional: a handler added directly to the app fails the boot, so it
    // cannot ship unauthorised.
    //
    // `deferReady` because Fastify refuses a new route once the instance is ready,
    // and the audit is an `onReady` hook, so the test has to own the call.
    const { app } = await createTestApp({ deferReady: true });

    app.get('/api/v1/undeclared', async () => ({ ok: true }));
    registerRoutes(app, new RouteTable());

    await expect(app.ready()).rejects.toThrow(/without a capability declaration/);
  });

  it('names the offending route in the failure', async () => {
    const { app } = await createTestApp({ deferReady: true });

    app.get('/api/v1/undeclared', async () => ({ ok: true }));
    registerRoutes(app, new RouteTable());

    await expect(app.ready()).rejects.toThrow(/\/api\/v1\/undeclared/);
  });

  it('does not mistake a static file route for an API route', async () => {
    // `@fastify/static` registers one route per built file. Without the file-route
    // exemption, a real frontend build would make the app refuse to boot.
    const { app } = await createTestApp({ deferReady: true });
    app.route({
      method: ['HEAD', 'GET'],
      url: '/index.html',
      handler: async () => 'x',
      config: { file: '/index.html', rootPath: '/build/' },
    });
    registerRoutes(app, new RouteTable());

    await expect(app.ready()).resolves.toBeDefined();
  });

  it('boots when every route is declared', async () => {
    const { app } = await appHolding({ requires: [CAPABILITIES.TASK_READ], holds: [] });
    await expect(app.ready()).resolves.toBeDefined();
  });
});

describe('a route with no declared capability is refused, even for the local user', () => {
  it('returns 403 on a request that matched it', async () => {
    // The local user holds every capability, so a default-allow check would let
    // this through. Default deny refuses it, which is what catches the route that
    // forgot to declare anything.
    harness = await createTestApp({ extraRoutes: protectedRoute([]) });

    expect(
      (await harness.app.inject({ method: 'GET', url: '/api/v1/test-protected' })).statusCode,
    ).toBe(403);
  });
});

describe('a public route is reachable with no principal', () => {
  it('serves /health without a capability', async () => {
    const { app } = await appHolding({ requires: [], holds: [], kind: 'anonymous' });

    // The Docker health check calls this with no principal at all, so it has to
    // work before anything else does.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('the local user can do everything a route asks for', () => {
  it('reaches a route needing several capabilities', async () => {
    const { app } = await appHolding({
      requires: [CAPABILITIES.TASK_READ, CAPABILITIES.TASK_CREATE, CAPABILITIES.TASK_CLOSE],
      holds: [CAPABILITIES.TASK_READ, CAPABILITIES.TASK_CREATE, CAPABILITIES.TASK_CLOSE],
    });

    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} })).statusCode,
    ).toBe(200);
  });

  it('builds a principal that holds exactly what it is given', () => {
    const principal = principalWith('mcp_token', [CAPABILITIES.TASK_READ]);
    expect(principal.capabilities.has(CAPABILITIES.TASK_READ)).toBe(true);
    expect(principal.capabilities.has(CAPABILITIES.TASK_CREATE)).toBe(false);
  });
});
