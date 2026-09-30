import type { FastifyInstance } from 'fastify';
import type { Capability } from '@pdm/shared';
import {
  principalWith,
  type PrincipalKind,
  type PrincipalResolver,
} from '../middleware/principal.js';
import type { RouteDeclaration } from './table.js';

/**
 * Test-only helpers for exercising the capability guard.
 *
 * Kept out of `table.test.ts` and `capability.test.ts` because a test helper that
 * lives inside a test file cannot be shared, and the guard needs the same setup in
 * both. It is under `src/` rather than beside the tests because Vitest's
 * `include` picks up `*.test.ts` only, so this file is never run as a suite.
 */

/** A resolver that always answers with the same principal. */
export function principalResolver(options: {
  kind: PrincipalKind;
  holds: readonly Capability[];
}): PrincipalResolver {
  const principal = principalWith(options.kind, options.holds);
  return () => principal;
}

/**
 * The route declarations a test needs, to be passed as `extraRoutes`.
 *
 * Declared rather than registered directly, so each one goes through the same
 * `RouteTable` and the same capability guard as a production route. A test that
 * called `app.get` itself would be testing a route with no guard, which is the
 * exact thing criterion 12 exists to prevent.
 */
export function protectedRoute(capabilities: readonly Capability[]): RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/api/v1/test-protected',
      capabilities,
      description: 'test route for the capability guard',
      handler: async () => ({ ok: true }),
    },
    {
      method: 'POST',
      url: '/api/v1/test-protected',
      capabilities,
      description: 'test route for the capability guard',
      // The marker proves the handler did not run, which is what makes "refused
      // before the handler" a real assertion rather than an inference from a 403.
      handler: async () => ({ ok: true, marker: 'handler-ran' }),
    },
  ];
}

export type { FastifyInstance };
