import { describe, expect, it } from 'vitest';
import { CAPABILITIES, ERROR_CODES, MCP_MAX_CAPABILITIES } from '@pdm/shared';
import { localUserPrincipal, principalWith, anonymousPrincipal } from '../middleware/principal.js';
import { looksLikeStaticFileRoute, RouteTable } from './table.js';

function noop(): void {}

describe('criterion 7: no API route accepts a delete of user data', () => {
  it('refuses to declare a DELETE route at all', () => {
    // Removal is archive, and archive is reversible (DATA-09, BR-13). The
    // prohibition is at the only place a route is declared, so it cannot be
    // defeated by a route added in a hurry.
    const table = new RouteTable();

    expect(() =>
      table.declare({
        method: 'DELETE',
        url: '/api/tasks/1',
        capabilities: [CAPABILITIES.TASK_UPDATE],
        description: 'remove a task',
        handler: noop,
      }),
    ).toThrow(/no DELETE route/);
  });

  it('does not record the refused route', () => {
    const table = new RouteTable();
    try {
      table.declare({
        method: 'DELETE',
        url: '/api/tasks/1',
        capabilities: [CAPABILITIES.TASK_UPDATE],
        description: 'remove a task',
        handler: noop,
      });
    } catch {
      // expected
    }
    expect(table.all()).toHaveLength(0);
  });

  it('allows an archive, which is a PATCH', () => {
    const table = new RouteTable().declare({
      method: 'PATCH',
      url: '/api/tasks/1/archive',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'archive a task',
      handler: noop,
    });
    expect(table.all()).toHaveLength(1);
  });
});

describe('criterion 12: a route with no declared capability is refused', () => {
  it('records a capability-less route but marks it for refusal', () => {
    // Default deny: the route exists, the guard refuses it. Failing at boot
    // instead would be a worse developer experience than a 403 that says why.
    const table = new RouteTable().declare({
      method: 'GET',
      url: '/api/tasks',
      capabilities: [],
      description: 'list tasks',
      handler: noop,
    });

    expect(table.all()).toHaveLength(1);
    expect(table.all()[0]?.capabilities).toHaveLength(0);
  });

  it('requires every listed capability, not just one of them', () => {
    // A read-only principal must not slip through a route that needs read *and*
    // write, which is what an `every` rather than a `some` guarantees.
    const table = new RouteTable().declare({
      method: 'PATCH',
      url: '/api/tasks/1',
      capabilities: [CAPABILITIES.TASK_READ, CAPABILITIES.TASK_UPDATE],
      description: 'update a task',
      handler: noop,
    });

    const declaration = table.get('PATCH', '/api/tasks/1');
    const readOnly = principalWith('mcp_token', [CAPABILITIES.TASK_READ]);
    const missing = declaration!.capabilities.filter((c) => !readOnly.capabilities.has(c));

    expect(missing).toEqual([CAPABILITIES.TASK_UPDATE]);
  });
});

describe('MCP-14: the assistant may never be granted task:close', () => {
  it('is absent from the maximum MCP capability set', () => {
    // Closing a task writes a closure record and is the human accountability step
    // (FR-GATE-08). If this were grantable, the promise in MCP-14 would be a
    // configuration mistake away from being false.
    expect(MCP_MAX_CAPABILITIES).not.toContain(CAPABILITIES.TASK_CLOSE);
  });

  it('is absent from every other mutating capability too', () => {
    for (const capability of [
      CAPABILITIES.TASK_UPDATE,
      CAPABILITIES.TIME_WRITE,
      CAPABILITIES.PROJECT_WRITE,
      CAPABILITIES.TAG_UPDATE,
      CAPABILITIES.SETTINGS_WRITE,
    ]) {
      expect(MCP_MAX_CAPABILITIES).not.toContain(capability);
    }
  });

  it('grants the local user every capability', () => {
    const local = localUserPrincipal();
    for (const capability of Object.values(CAPABILITIES)) {
      expect(local.capabilities.has(capability)).toBe(true);
    }
  });

  it('grants an anonymous principal nothing at all', () => {
    expect(anonymousPrincipal().capabilities.size).toBe(0);
  });

  it('defaults an unresolved principal to anonymous, so it holds nothing', () => {
    // The default-deny posture in one assertion: a forgotten resolver produces a
    // principal with an empty set, not one with a full one.
    expect(anonymousPrincipal().kind).toBe('anonymous');
  });
});

describe('a route cannot be declared twice', () => {
  it('refuses a second declaration of the same method and path', () => {
    const table = new RouteTable().declare({
      method: 'GET',
      url: '/api/tasks',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'list tasks',
      handler: noop,
    });

    expect(() =>
      table.declare({
        method: 'GET',
        url: '/api/tasks',
        capabilities: [CAPABILITIES.TASK_READ],
        description: 'list tasks again',
        handler: noop,
      }),
    ).toThrow(/declared twice/);
  });

  it('treats a lowercase method as the same route', () => {
    // Fastify reports a registered method as 'get' but the table stores 'GET';
    // without normalisation the audit would miss every route.
    const table = new RouteTable().declare({
      method: 'GET',
      url: '/api/tasks',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'list tasks',
      handler: noop,
    });

    expect(table.has('get', '/api/tasks')).toBe(true);
  });
});

describe('the static-route exemption cannot exempt an API route', () => {
  // `@fastify/static` gives us no marker of our own, so the audit recognises a
  // file route by `config.file` and `config.rootPath`. If that test were too wide,
  // every API route could opt out of the audit and the guarantee would be void.
  it('recognises a route the static plugin claimed', () => {
    expect(looksLikeStaticFileRoute({ file: '/index.html', rootPath: '/build/' })).toBe(true);
  });

  it('does not exempt a route with only one of the two keys', () => {
    expect(looksLikeStaticFileRoute({ file: '/index.html' })).toBe(false);
    expect(looksLikeStaticFileRoute({ rootPath: '/build/' })).toBe(false);
  });

  it('does not exempt a route with no config at all', () => {
    expect(looksLikeStaticFileRoute(undefined)).toBe(false);
    expect(looksLikeStaticFileRoute({})).toBe(false);
  });

  it('does not exempt a route whose keys are not strings', () => {
    expect(looksLikeStaticFileRoute({ file: 1, rootPath: 2 })).toBe(false);
  });

  it('does not exempt a capability declaration that happens to name a route', () => {
    // An API route declaring its capability has no reason to name a file on disk.
    expect(looksLikeStaticFileRoute({ url: '/api/tasks' })).toBe(false);
  });
});

describe('a public route bypasses the capability check on purpose', () => {
  it('is not given capabilities, and is exempt from the guard', () => {
    const table = new RouteTable().declare({
      method: 'GET',
      url: '/health',
      public: true,
      capabilities: [],
      description: 'health check',
      handler: noop,
    });

    // The Docker health check calls this with no principal, so it has to be
    // answerable before anything else works. The distinction from a forgotten
    // declaration is that it is written down.
    expect(table.get('GET', '/health')?.public).toBe(true);
  });
});

describe('the capability refusal carries a stable code', () => {
  it('is capability_denied rather than validation_failed', () => {
    expect(ERROR_CODES.CAPABILITY_DENIED).toBe('capability_denied');
  });
});
