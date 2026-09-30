import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Database as Db } from 'better-sqlite3';
import type { Knex } from 'knex';
import { nowMs, UI_V1 } from '@pdm/shared';
import type { AppConfig } from './config/index.js';
import { logger } from './lib/logger.js';
import { registerErrorEnvelope } from './middleware/error.js';
import {
  decoratePrincipal,
  defaultPrincipalResolver,
  type PrincipalResolver,
} from './middleware/principal.js';
import { decorateServices } from './middleware/services.js';
import { registerRequestId } from './middleware/request-id.js';
import { createActivityLogService } from './services/activity-log.service.js';
import { createProjectService } from './services/project.service.js';
import { createTaskService } from './services/task.service.js';
import { createTodoService } from './services/todo.service.js';
import { createTaskLinkService } from './services/task-link.service.js';
import { createCriterionService } from './services/criterion.service.js';
import { createReferenceService } from './services/reference.service.js';
import { createTagService } from './services/tag.service.js';
import { healthRoute } from './routes/health.js';
import { readyRoute } from './routes/ready.js';
import { rootRoute } from './routes/root.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { todoRoutes } from './routes/todos.js';
import { taskLinkRoutes } from './routes/task-links.js';
import { criterionRoutes } from './routes/criteria.js';
import { referenceRoutes } from './routes/references.js';
import { tagRoutes } from './routes/tags.js';
import { registerRoutes, RouteTable, type RouteDeclaration } from './routes/table.js';

export interface CreateServerOptions {
  config: AppConfig;
  /** better-sqlite3, used by the migration check and the health probe. */
  db: Db;
  /** Knex, used by every repository. Repositories never touch the driver directly. */
  knex: Knex;
  /**
   * Overridable so a test can install a principal that lacks a capability
   * (criterion 12). Unset means the default resolver — the local user — which
   * is what production runs: without it every guarded route refuses with 403
   * and the interface can do nothing, a failure no test caught until a live
   * container was driven for the first time.
   */
  principalResolver?: PrincipalResolver;
  /**
   * Extra declared routes, merged into the table.
   *
   * Exists because a test cannot add a route after `createServer` returns:
   * Fastify refuses `addHook` once the instance is ready, and `createServer`
   * finishes by calling `ready` for the static plugin. A test that needs a route
   * with a particular capability declares it here, so it goes through the same
   * table, the same guard and the same audit as a production route. Anything else
   * would test a copy of the guard rather than the guard.
   */
  extraRoutes?: readonly RouteDeclaration[];
}

/**
 * The HTTP server.
 *
 * One process serves the API and the built frontend, so there is no proxy and no
 * CORS to get wrong (ADR 0001). The frontend's own files are static; every API
 * route is registered through the route table **before** the SPA fallback, so
 * `/health` can never be shadowed by `index.html`.
 *
 * Registration order is not arbitrary:
 *
 * 1. request id, so every later log line and error envelope can carry it;
 * 2. the principal default, so no route can observe an undefined principal;
 * 3. the error envelope, so a refusal from a capability guard is rendered by the
 *    same handler as every other failure;
 * 4. the route table, whose audit refuses to boot if any route was not declared;
 * 5. static, last, because it owns the not-found handler.
 */
export function createServer({
  config,
  db,
  knex,
  principalResolver,
  extraRoutes = [],
}: CreateServerOptions): FastifyInstance {
  const app = Fastify({
    // The request logger stays off by default so tests are quiet; the boot
    // messages are the ones an owner needs in `docker compose logs`.
    logger: config.NODE_ENV === 'development',
    // Trust no proxy headers: the app is reached through Docker's published
    // port on 127.0.0.1, so there is no proxy in front of it to trust.
    trustProxy: false,
  });

  // Captured once, when the server is built, not per request. Reading the clock
  // inside the `/health` handler made `uptime_s` measure the gap between a
  // request arriving and the response being built — always 0. A field that
  // always reads zero is worse than no field, because it looks like data.
  const startedAtMs = nowMs();

  registerRequestId(app);
  decoratePrincipal(app);
  registerErrorEnvelope(app, config.PDM_WEB_DIR);
  // Services are built once and reached through a decorator, so a route handler
  // receives one rather than constructing its own. A handler that built its own
  // service would hold a second Knex pool, and the transaction it opened would
  // not be the one the route's other writes joined.
  const activityLog = createActivityLogService(knex);
  decorateServices(app, {
    activityLog,
    projects: createProjectService(knex, activityLog),
    tasks: createTaskService(knex, activityLog),
    todos: createTodoService(knex, activityLog),
    taskLinks: createTaskLinkService(knex, activityLog),
    criteria: createCriterionService(knex, activityLog),
    references: createReferenceService(knex, activityLog),
    tags: createTagService(knex, activityLog),
  });
  // The resolver is installed even when the caller passes none, because the
  // alternative is every request arriving anonymous: production passes none,
  // and an unset resolver meant the whole API refused with 403 while every
  // test — each installing its own resolver — stayed green.
  registerRoutes(app, buildRouteTable({ db, config, startedAtMs, extraRoutes }), {
    principalResolver: principalResolver ?? defaultPrincipalResolver,
  });
  // Registered last: the SPA fallback owns the not-found handler, so it is
  // installed only after every API route and every real asset has claimed its
  // path. Fastify permits exactly one not-found handler per scope, which is why
  // this is one function that decides, rather than two that overwrite.
  registerStatic(app, config);

  return app;
}

/**
 * The declared routes.
 *
 * One function so that adding a route is a one-line change in one place, and so
 * that the table's audit has a single source to compare the app against. As
 * 0.2.0 grows this becomes the point where each domain's route module is
 * assembled; the shape does not change.
 */
function buildRouteTable(options: {
  db: Db;
  config: AppConfig;
  startedAtMs: number;
  extraRoutes: readonly RouteDeclaration[];
}): RouteTable {
  // Each domain contributes its declarations here, so the table keeps one source
  // for production routes and the audit keeps one object to compare against.
  // The three unprefixed routes (ADR 0013) lead: the probes must be answerable
  // before anything else, and the root redirect is the address a human types.
  const base = [...projectRoutes(), ...taskRoutes(), ...todoRoutes(), ...taskLinkRoutes(), ...criterionRoutes(), ...referenceRoutes(), ...tagRoutes()].reduce<RouteTable>(
    (table, declaration) => table.declare(declaration),
    new RouteTable()
      .declare(healthRoute(options))
      .declare(readyRoute({ db: options.db }))
      .declare(rootRoute()),
  );
  return options.extraRoutes.reduce<RouteTable>(
    (table, declaration) => table.declare(declaration),
    base,
  );
}

/**
 * Static files for the built frontend, with an SPA fallback.
 *
 * The fallback **excludes asset paths** (0.1.0 design notes): a missing
 * JavaScript bundle must return 404, because returning `index.html` for a
 * script request produces a confusing MIME-type error in the browser instead of
 * a clear one.
 */
function registerStatic(app: FastifyInstance, config: AppConfig): void {
  const webDir = config.PDM_WEB_DIR;

  if (!webDir || !existsSync(join(webDir, 'index.html'))) {
    // Not an error. The API is useful on its own, and in tests there is no build.
    logger.info('server.ts', 'registerStatic', 'no frontend build; serving the API only', {
      web_dir: webDir,
    });
    return;
  }

  void app.register(fastifyStatic, {
    root: resolve(webDir),
    // Everything the browser loads is under the UI prefix (ADR 0013), so the
    // plugin is mounted there rather than at the root. A bundle requested from
    // `/assets/...` now 404s, which is the point: one namespace, no overlap
    // between an asset path and a route path.
    prefix: UI_V1,
    // Hashed asset filenames, so they can be cached indefinitely.
    maxAge: '1y',
    immutable: true,
    index: false,
    // No catch-all route. The plugin would register `GET /*` and answer 404 for
    // a client-side route, which would stop the request ever reaching the
    // not-found handler where the SPA fallback lives. `sendFile` is still
    // available, so the fallback can serve assets itself.
    wildcard: false,
  });
}
