import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
  RouteHandlerMethod,
} from 'fastify';
import type { Capability } from '@pdm/shared';
import { API_V1, UNPREFIXED_ROUTES, isDeclaredRouteAllowed } from '@pdm/shared';
import { capabilityDenied } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { anonymousPrincipal, type PrincipalResolver } from '../middleware/principal.js';

/**
 * The route table (AGENTS.md ground rule 7, ADR 0006, criteria 7 and 12).
 *
 * Every API route is **declared** here: its method, its path, and the capability
 * it needs. Three requirements depend on this file existing rather than on
 * discipline inside handlers:
 *
 * - `MCP-14` — the assistant can read and create, never mutate or close. That is
 *   one set comparison here, not a decision repeated in every handler.
 * - Criterion 12 — a route with **no declared capability is refused**. Default
 *   deny, because a route that forgot to declare something must fail closed.
 * - Criterion 7 — no route accepts a delete of user data. That is enforced where
 *   a route is declared, so it cannot be forgotten at the call site.
 *
 * **Why a table instead of capability checks inside handlers.** A handler that
 * checks its own capability is a hundred chances to write `if (!allowed) return`
 * with a different code, a different log line, or no log line. The table makes
 * the declaration adjacent to the route, and makes it reviewable in one file.
 */

/**
 * The marker `registerStatic` stamps on the routes the static plugin claims, so
 * the audit below can tell a file path from an API path.
 *
 * Exported rather than duplicated as a string literal, because the setter and the
 * reader are in different files and a typo in either would silently stop the
 * exemption from working — which shows up as an app that refuses to boot, so it
 * would be found, but not understood.
 */
/**
 * How the audit recognises a route claimed by the static plugin.
 *
 * **`@fastify/static` gives us no option to mark its routes with.** With
 * `wildcard: false` it builds its own `routeOpts` and registers one route per
 * file it finds, setting `config.file` and `config.rootPath` and discarding every
 * option we pass — a top-level marker is silently dropped, and a `config` option
 * is not forwarded either. Two attempts were made and both were invisible to the
 * audit hook, which showed up as the app refusing to boot once a frontend build
 * existed.
 *
 * So the discriminator is a property the plugin *always* sets on a file route and
 * that no API route would have: `config.file` and `config.rootPath`. An API route
 * declaring a capability has no reason to name a file on disk, and a route that
 * did would be refused at boot by a test that asserts no API route is a file.
 */
function isStaticFileRoute(config: Record<string, unknown> | undefined): boolean {
  return typeof config?.file === 'string' && typeof config.rootPath === 'string';
}

/**
 * The discriminator, exported for its own tests.
 *
 * Not exported so production code can call it — only so a test can prove it does
 * not exempt an API route, which is the failure that would silently disable the
 * whole audit.
 */
export function looksLikeStaticFileRoute(config: Record<string, unknown> | undefined): boolean {
  return isStaticFileRoute(config);
}

export interface RouteDeclaration {
  readonly method: HTTPMethods;
  readonly url: string;
  /**
   * What the caller must hold. **Empty is refused, not public.**
   *
   * Default deny is the whole point (ground rule 7): a developer adding a route
   * and forgetting this array should get a 403 in development, not an endpoint
   * the assistant can reach. A route that genuinely is public says so with
   * `public: true`, which is a decision in the same file rather than an omission.
   */
  readonly capabilities: readonly Capability[];
  /**
   * A route reachable with no capability check at all.
   *
   * For `GET /health` only: the Docker health check calls it with no principal
   * and must be told whether the container is alive, and it is the one route
   * that must work before anything else does.
   */
  readonly public?: boolean;
  /** One line, for the audit log and for the `onRoute` registration trace. */
  readonly description: string;
  readonly handler: RouteHandlerMethod;
}

/**
 * The identity of a route: its method and path.
 *
 * A method is normalised to **uppercase and a single string** because Fastify
 * reports it in three shapes depending on how it was registered: `'get'` for
 * `app.get()`, an array for a multi-method `app.route()`, and a separate
 * `HEAD /health` entry for the HEAD route Fastify generates from every GET.
 * Comparing the raw value made the audit miss a route declared as `GET` and
 * registered as `'get'`, which is exactly the kind of gap that makes an audit
 * worthless.
 */
function key(method: HTTPMethods | HTTPMethods[] | string, url: string): string {
  const normalised = Array.isArray(method) ? method.join(',') : String(method);
  return `${normalised.toUpperCase()} ${url}`;
}

export class RouteTable {
  private readonly declarations: RouteDeclaration[] = [];
  private readonly byKey = new Map<string, RouteDeclaration>();

  /**
   * Declare a route, or fail.
   *
   * A `DELETE` is refused **here** rather than left to review, because ground
   * rule 2 is absolute: nothing is ever deleted (`DATA-09`, `DATA-10`, `BR-13`).
   * An `archive` is a `PATCH`. Making `DELETE` unrepresentable in this type's
   * happy path means the prohibition cannot be defeated by a route added in a
   * hurry under time pressure.
   *
   * A path outside the scheme is refused for the same reason (ADR 0013): this
   * process serves the JSON and the HTML from one origin, so an unprefixed path
   * is ambiguous rather than merely untidy. See `isDeclaredRouteAllowed` — which
   * a UI path is *not* allowed through, because a page acquires a capability
   * guard here and an HTML response has no principal to guard.
   */
  declare(declaration: RouteDeclaration): this {
    const method = declaration.method.toUpperCase() as HTTPMethods;
    const declarationKey = key(method, declaration.url);

    if (method === 'DELETE') {
      throw new Error(
        `Route ${declarationKey} refused: this API has no DELETE route. ` +
          'Removal is archive, and archive is reversible (DATA-09, BR-13).',
      );
    }

    // The URL scheme, refused here for the same reason `DELETE` is (ADR 0013).
    // One process serves the JSON and the HTML, so an unprefixed path is
    // ambiguous: `/tasks` is a list of tasks in one namespace and a screen in
    // the other. A convention would hold until the release somebody is rushing
    // through, so the check is at the only place a route enters the app.
    if (!isDeclaredRouteAllowed(declaration.url)) {
      throw new Error(
        `Route ${declarationKey} refused: it is neither under ${API_V1} nor one of the ` +
          `agreed unprefixed routes (${UNPREFIXED_ROUTES.join(', ')}). Every API route is ` +
          `namespaced, because this process serves the API and the frontend from one origin ` +
          '(ADR 0013).',
      );
    }

    const existing = this.byKey.get(declarationKey);
    if (existing) {
      throw new Error(
        `Route ${declarationKey} is declared twice: "${existing.description}" and "${declaration.description}"`,
      );
    }

    if (!declaration.public && declaration.capabilities.length === 0) {
      // Not a throw: a half-written route should surface as a 403 in development
      // with a message that says why, which is more useful than a boot failure
      // in a file the developer may not have open. `audit()` reports it too.
      logger.warn(
        'routes/table.ts',
        'declare',
        'route declares no capability and will be refused by default',
        { route: declarationKey },
      );
    }

    const stored: RouteDeclaration = { ...declaration, method };
    this.declarations.push(stored);
    this.byKey.set(declarationKey, stored);
    return this;
  }

  all(): readonly RouteDeclaration[] {
    return this.declarations;
  }

  get(method: HTTPMethods | HTTPMethods[] | string, url: string): RouteDeclaration | undefined {
    return this.byKey.get(key(method, url));
  }

  has(method: HTTPMethods | HTTPMethods[] | string, url: string): boolean {
    return this.byKey.has(key(method, url));
  }
}

/**
 * Refuse a request whose principal lacks a required capability.
 *
 * Runs as a `preHandler`, so it happens **after** the route matched and **before**
 * the handler body. Nothing is parsed from the body and no service is called, so a
 * denied request cannot have a side effect — which matters, because the point of
 * `MCP-14` is that a denied write leaves nothing behind.
 */
function createCapabilityGuard(
  declaration: RouteDeclaration,
  table: RouteTable,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const routeKey = key(declaration.method, declaration.url);
  const required = declaration.capabilities;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (declaration.public) return;

    // A principal that was never resolved is anonymous, which holds nothing, so
    // it is refused. This is the default-deny path: the failure mode of a
    // forgotten resolver is a 403, not an open door.
    const principal = req.principal ?? anonymousPrincipal();

    const missing = required.filter((capability) => !principal.capabilities.has(capability));

    // **An empty requirement set is refused too.** This is the case a `missing`
    // check alone gets wrong, and it is the important one: `required.filter(...)`
    // on an empty array returns an empty array, so a route that declared no
    // capability computed "nothing missing" and let every caller through — while
    // the local user holds every capability, so no principal would ever have
    // caught it. A route reaches the network only if it declared what it needs or
    // said `public: true`, which is what "default deny" has to mean to be worth
    // anything.
    if (required.length === 0 || missing.length > 0) {
      // A route that declared nothing gets a different message from one that
      // declared a capability the caller lacks, because they are different bugs: a
      // missing declaration is a defect in this file, and no principal can fix it.
      const undeclared = required.length === 0;

      logger.warn(
        'routes/table.ts',
        'capabilityGuard',
        undeclared
          ? 'request refused: route declares no capability'
          : 'request refused: principal lacks a required capability',
        {
          route: routeKey,
          principal: principal.kind,
          required: required.join(','),
          missing: missing.join(','),
          request_id: req.requestId,
        },
      );

      throw capabilityDenied(
        undeclared
          ? `${routeKey} declares no capability, so it is refused by default. ` +
              `Declare what it needs, or mark it public. (AGENTS.md ground rule 7)`
          : `This principal (${principal.kind}) may not ${routeKey}: missing ${missing.join(', ')}.`,
      );
    }

    logger.debug('routes/table.ts', 'capabilityGuard', 'capability check passed', {
      route: routeKey,
      principal: principal.kind,
      // Present so a log can answer "what did the assistant reach for", which is
      // the question an audit is actually asked.
      request_id: req.requestId,
      url: req.url,
    });

    // `table` is captured so the guard can be traced back to its declaration
    // without a second lookup; keeps the log line honest if a route is renamed.
    void table;
    void reply;
  };
}

export interface RegisterRoutesOptions {
  /** Overridable so a test can install a principal that lacks a capability. */
  readonly principalResolver?: PrincipalResolver;
}

/**
 * Register every declared route, with its capability guard attached.
 *
 * Also installs the **route audit**: a Fastify `onRoute` hook records every route
 * the app ends up with, and `onReady` refuses to boot if any of them was not
 * declared here. That is what turns "every route declares its capabilities" from
 * a convention into something a test can assert — a handler registered directly
 * on the app, bypassing the table, fails the boot.
 */
export function registerRoutes(
  app: FastifyInstance,
  table: RouteTable,
  options: RegisterRoutesOptions = {},
): void {
  const resolve = options.principalResolver;

  if (resolve) {
    app.addHook('onRequest', async (req) => {
      req.principal = resolve(req);
    });
  }

  const undeclared: string[] = [];

  // A route is "ours" if the table declared it, or if the static plugin claimed
  // it. Both are recorded through Fastify's `onRoute` hook, so an API route added
  // by hand is the only thing that has no explanation here — which is the point.
  app.addHook('onRoute', (routeOptions) => {
    // A file path, not an API path. See `isStaticFileRoute` for why the plugin
    // gives us no marker of our own to use.
    //
    // Cast because `config` is `FastifyContextConfig`, which has an index
    // signature only for keys known to Fastify. A plugin-specific key is exactly
    // the case that signature is meant to allow, and declaring it here would put
    // a static-serving concern into the capability module.
    const config = routeOptions.config as Record<string, unknown> | undefined;
    if (isStaticFileRoute(config)) return;

    // A wildcard is the plugin's catch-all, not an API route. The SPA fallback is
    // a not-found handler, so it never appears here at all.
    if (routeOptions.url.includes('*')) return;

    // Fastify synthesises `HEAD` for every declared `GET` unless
    // `exposeHeadRoutes` is off. The generated route runs the same handler under
    // the same guard, so it is authorised by the same declaration — recording it
    // as undeclared would be reporting the framework, not a defect.
    if (routeOptions.method === 'HEAD' && table.has('GET', routeOptions.url)) return;

    if (table.has(routeOptions.method as HTTPMethods, routeOptions.url)) return;
    undeclared.push(key(routeOptions.method, routeOptions.url));
  });

  for (const declaration of table.all()) {
    app.route({
      method: declaration.method,
      url: declaration.url,
      preHandler: createCapabilityGuard(declaration, table),
      handler: declaration.handler,
    });
  }

  app.addHook('onReady', async () => {
    if (undeclared.length === 0) return;
    const list = undeclared.join(', ');
    logger.error(
      'routes/table.ts',
      'registerRoutes',
      'refusing to boot: routes exist that declare no capabilities',
      { undeclared: list },
    );
    throw new Error(
      `These routes are registered without a capability declaration, so they are not ` +
        `auditable: ${list}. Declare them in routes/table.ts. (AGENTS.md ground rule 7, MCP-14)`,
    );
  });
}
