import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LOCAL_USER_CAPABILITIES, type Capability } from '@pdm/shared';

/**
 * Who is making the request, and what they may do (AGENTS.md ground rule 7,
 * ADR 0006, `MCP-14`).
 *
 * The point of resolving a principal is that the **capability** is checked, not
 * the identity. `MCP-14` promises the assistant can read and create and never
 * mutate or close, and that promise has to hold in the app, not in the MCP
 * server — otherwise it holds only for as long as nobody rewrites the server.
 * So the answer to "may this principal do this" is a set comparison, and the set
 * arrives here.
 *
 * 0.2.0 has one principal. The MCP token arrives in 0.10.0, but the **seam is
 * built now**, because a check added after the routes exist is a check that has
 * to be retrofitted onto every handler, and a retrofit is where a default-allow
 * slips in.
 */

export type PrincipalKind = 'local_user' | 'mcp_token' | 'anonymous';

export interface Principal {
  readonly kind: PrincipalKind;
  readonly capabilities: ReadonlySet<Capability>;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}

/**
 * The single-user principal: everything.
 *
 * `NFR-PRIV-01` and ADR 0001 are what make this safe. The published port is
 * bound to `127.0.0.1` on the host, so reaching this process at all is already
 * the user reaching their own laptop, and the app makes no outgoing request and
 * holds no credential that a remote caller could present. There is no login
 * because a single-user app with no network exposure has nothing to log in to.
 */
export function localUserPrincipal(): Principal {
  return {
    kind: 'local_user',
    capabilities: new Set<Capability>(LOCAL_USER_CAPABILITIES),
  };
}

/**
 * Where the resolved principal is held between the resolver and the guard.
 *
 * A symbol rather than a `_principal` string, so it cannot collide with a
 * decoration name, a query parameter or a body field.
 */
const PRINCIPAL_SLOT = Symbol('pdm.principal');

/**
 * A principal holding nothing, shared and **frozen**.
 *
 * This is the default every request starts from, which is the default-deny
 * posture expressed in code: if no resolver is installed, or the resolver throws
 * before assigning, a request is anonymous and therefore refused.
 */
const ANONYMOUS: Principal = Object.freeze({
  kind: 'anonymous',
  capabilities: new Set<Capability>(),
});

export function anonymousPrincipal(): Principal {
  return ANONYMOUS;
}

/**
 * A principal carrying an explicit set, for tests and for the MCP token later.
 *
 * Exported because criterion 12 is "a principal **without** the capability is
 * refused", and that is only testable if a principal can be built that lacks one.
 * In 0.2.0 there is no MCP token to withhold a capability from, so a test would
 * otherwise have to assert against the full set and prove nothing.
 */
export function principalWith(kind: PrincipalKind, capabilities: readonly Capability[]): Principal {
  return { kind, capabilities: new Set<Capability>(capabilities) };
}

export type PrincipalResolver = (req: FastifyRequest) => Principal;

/**
 * The default resolver.
 *
 * Everything is the local user, because in 0.2.0 the only way to reach the API
 * is through the loopback-published port. 0.10.0 replaces this body with a lookup
 * of the `Authorization` header against `mcp_tokens` and returns
 * `principalWith('mcp_token', ...)` — the branch is the only thing that changes,
 * which is why it is a function and not a value.
 */
export function defaultPrincipalResolver(): Principal {
  return localUserPrincipal();
}

export function decoratePrincipal(app: FastifyInstance): void {
  // Fastify 5 refuses a reference type as a decorator default, precisely because
  // it would be one object shared by every request. The getter/setter pair below
  // stores per-request state on the request itself, which is what that guard is
  // actually trying to force.
  app.decorateRequest('principal', {
    getter(this: FastifyRequest): Principal {
      return (
        (this as unknown as Record<symbol, Principal | undefined>)[PRINCIPAL_SLOT] ?? ANONYMOUS
      );
    },
    setter(this: FastifyRequest, value: Principal) {
      (this as unknown as Record<symbol, Principal>)[PRINCIPAL_SLOT] = value;
    },
  });
}
