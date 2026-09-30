import { z } from 'zod';

/**
 * The URL scheme (ADR 0013).
 *
 * One process serves the API and the built frontend (ADR 0001), so every path
 * lives in the same namespace and a bare `/tasks` could mean either the JSON
 * list or the HTML screen. The split is therefore **structural, not stylistic**,
 * and both halves are versioned:
 *
 * | Prefix    | Serves                        | Who reads it                  |
 * | --------- | ----------------------------- | ----------------------------- |
 * | `/api/v1` | JSON                          | the frontend, and the MCP server from 0.10.0 |
 * | `/ui/v1`  | HTML and static assets        | a browser                     |
 * | *(none)*  | liveness, readiness, the root redirect | Docker, an operator   |
 *
 * **Why an unprefixed allowance exists at all.** The probes have to be
 * answerable by something that knows nothing about this app's URL design: the
 * Docker health check, and any orchestrator that probes a conventional path.
 * A probe behind `/api/v1` would be a URL an operator has to know; a probe at a
 * fixed, conventional path is one they can assume. The version is in the
 * versioned namespaces and out of these, deliberately: a version that changed
 * would move the probes out from under whatever is calling them.
 *
 * These live in `shared` rather than in the API because **three** parties have
 * to agree on them — the route table that declares, the server that serves, and
 * the browser that requests — and a constant copied into each is three places
 * to forget. That is the same argument as `DATA-04`: a value duplicated is a
 * value that drifts.
 */

/**
 * The `/api` namespace for version 1. Every JSON route lives under this.
 *
 * **A literal, not `/api/${something}`.** The version is spelled out here on
 * purpose. A `SCHEME_VERSION` constant that both prefixes were built from looks
 * tidier and is worse: changing it would silently move every path that already
 * exists, so a `/v2` could only ever be a cutover that breaks v1, never a second
 * set of routes served beside the first. With the version written in, a future
 * `/v2` is a **new constant beside this one** —
 *
 * ```ts
 * export const API_V2 = '/api/v2';
 * export const UI_V2 = '/ui/v2';
 * ```
 *
 * — and the new route modules use those, while the v1 declarations keep their
 * own paths and both versions coexist in one route table. The version is
 * therefore part of a route's *identity*, not a build setting.
 */
export const API_V1 = '/api/v1';

/**
 * The `/ui` namespace for version 1. Every page and asset is served from here.
 *
 * Read by the static plugin's mount point, by the SPA fallback's prefix test and
 * by the browser router's `basename`, so those three cannot disagree about where
 * the frontend lives.
 */
export const UI_V1 = '/ui/v1';

/** Where the bare root sends a browser. The first real screen, not the shell. */
export const UI_ENTRY_PATH = `${UI_V1}/tasks`;

/**
 * The complete set of paths allowed to exist **without** a prefix.
 *
 * An allowlist rather than a "must not be `/ui`" rule, because the question a
 * boot-time check needs to answer is "is this one of the three we agreed on?"
 * — and a denylist answers a different question, one that goes stale the moment
 * a fourth unprefixed route is added on purpose.
 *
 * Exported so the route table's check and its tests read the same list.
 */
export const UNPREFIXED_ROUTES = ['/health', '/ready', '/'] as const;

export type UnprefixedRoute = (typeof UNPREFIXED_ROUTES)[number];

/**
 * Whether a **declared route** is inside the scheme — the rule `RouteTable`
 * enforces (ADR 0013).
 *
 * A declared route is either under the API namespace or is one of the three
 * agreed unprefixed paths. **A UI path is not declarable**, and that is the
 * point: pages are served by the static mount and the SPA fallback, not by a
 * route declaration. Allowing one would mean a page could acquire a capability
 * guard, which is a category error — an HTML response has no principal.
 *
 * This is deliberately **not** the same question as `isUiPath`, and the two were
 * one function until a test asked whether `/ui/v1/tasks` could be declared. The
 * answer is no, and a shared predicate would have had to say yes to be useful
 * to the fallback, so the rules are now separate and each has one caller.
 */
export function isDeclaredRouteAllowed(url: string): boolean {
  if (url.startsWith(`${API_V1}/`)) return true;
  return (UNPREFIXED_ROUTES as readonly string[]).includes(url);
}

/**
 * Whether a **request path** belongs to the UI namespace — the rule the SPA
 * fallback enforces (ADR 0013).
 *
 * At or under the versioned UI base. Note what this refuses: `/ui` on its own,
 * because the UI lives at `/ui/v1` and a bare `/ui` is a version that was never
 * served. Handing it a page would show an owner a blank screen at a
 * half-remembered address instead of saying it is not found.
 *
 * **This is the positive form of the scheme.** An earlier version of the
 * fallback excluded `/api` specifically, which meant every *other* unprefixed
 * path was answered with HTML — a mistyped `/tasks` returned the whole app shell
 * with a 200, and a client could not tell a wrong URL from a right one.
 */
export function isUiPath(path: string): boolean {
  return path === UI_V1 || path.startsWith(`${UI_V1}/`);
}

/**
 * `GET /health` payload (DEP-06).
 *
 * `db` is a real check, not a constant: the handler opens the database and runs
 * `SELECT 1` plus a migration-count query, so a container that is up but broken
 * cannot report itself healthy.
 */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  db: z.enum(['ok', 'error']),
  version: z.string(),
  uptime_s: z.number().int().nonnegative(),
  migrations: z.object({
    applied: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    ok: z.boolean(),
  }),
  time_zone: z.string(),
  db_error: z.string().optional(),
  /**
   * The server's clock, in epoch milliseconds.
   *
   * Present so the shell can render a real time in the configured zone without
   * reading the browser's clock: the zone comes from `PDM_TZ` on the server, and
   * a laptop whose OS zone differs from the configured one must still show the
   * configured one (acceptance criterion 11, NFR-TIME-01). The browser formats
   * this value; it never measures it.
   */
  now_ms: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * `GET /ready` payload.
 *
 * **A different shape from `/health` on purpose.** If `/ready` returned the
 * health body it would be a second name for one handler, and the next person to
 * read the route table would have to work out whether the two could ever
 * disagree. A readiness answer is a narrower question — *can this process take
 * work right now?* — so it carries only what that question needs, and a
 * divergence later (a degraded mode that is up but not ready, say) has somewhere
 * to go without changing an existing contract.
 */
export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  db: z.enum(['ok', 'error']),
  /** Pending migrations. Non-zero means the schema is behind the code. */
  migrations_pending: z.number().int().nonnegative(),
  /** Present only when `not_ready`, and safe to show an operator. */
  reason: z.string().optional(),
  now_ms: z.number().int().nonnegative(),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;

/**
 * The one error envelope every route uses, so a client never has to guess the
 * shape of a failure. `error.code` is a stable machine-readable string; the
 * message is for a human and may change.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    request_id: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Error codes the API returns. Stable identifiers, safe to branch on. */
export const ERROR_CODES = {
  NOT_FOUND: 'not_found',
  VALIDATION_FAILED: 'validation_failed',
  INTERNAL: 'internal',
  DATABASE_UNAVAILABLE: 'database_unavailable',
  CAPABILITY_DENIED: 'capability_denied',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
