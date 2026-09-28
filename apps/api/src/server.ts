import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Database as Db } from 'better-sqlite3';
import { ERROR_CODES, nowMs, type ErrorEnvelope, type HealthResponse } from '@pdm/shared';
import type { AppConfig } from './config/index.js';
import { migrationStatus } from './db/migrate.js';

export interface CreateServerOptions {
  config: AppConfig;
  db: Db;
}

/**
 * The HTTP server.
 *
 * One process serves the API and the built frontend, so there is no proxy and no
 * CORS to get wrong (ADR 0001). The frontend's own files are static; every API
 * route is registered before the SPA fallback, so `/health` can never be shadowed
 * by `index.html`.
 */
export function createServer({ config, db }: CreateServerOptions): FastifyInstance {
  const app = Fastify({
    // The request logger stays off by default so tests are quiet; the boot
    // messages above are the ones an owner needs in `docker compose logs`.
    logger: config.NODE_ENV === 'development',
    // Trust no proxy headers: the app is reached through Docker's published
    // port on 127.0.0.1, so there is no proxy in front of it to trust.
    trustProxy: false,
  });

  registerRequestId(app);
  registerErrorEnvelope(app, config.PDM_WEB_DIR);
  registerHealth(app, db, config);
  // Registered last: the SPA fallback owns the not-found handler, so it is
  // installed only after every API route and every real asset has claimed its
  // path. Fastify permits exactly one not-found handler per scope, which is why
  // this is one function that decides, rather than two that overwrite.
  registerStatic(app, config);

  return app;
}

/**
 * A request id in a response header, so a log line and a bug report can be
 * correlated without a clock or a guess.
 */
function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : crypto.randomUUID();
    (req as FastifyRequest & { requestId?: string }).requestId = id;
    void reply.header('x-request-id', id);
  });
}

function requestIdOf(req: FastifyRequest): string | undefined {
  return (req as FastifyRequest & { requestId?: string }).requestId;
}

/**
 * The one error envelope (AGENTS.md Part 6). A client never has to guess the
 * shape of a failure, and the stack trace never reaches the response.
 */
function registerErrorEnvelope(app: FastifyInstance, webDir: string | undefined): void {
  const indexPath = webDir && existsSync(join(webDir, 'index.html')) ? join(resolve(webDir), 'index.html') : undefined;

  /**
   * One not-found handler, deciding two cases (0.1.0 design notes).
   *
   * A client-side route like `/tasks/42` has no file behind it, so it is
   * answered with `index.html` and the router resolves it. **Asset paths are
   * excluded**: answering a missing script with HTML produces a MIME-type error
   * in the browser that says nothing about the real cause, so those get a
   * normal 404 envelope instead.
   */
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const looksLikeAsset = /\.[a-z0-9]+$/i.test(path);

    if (indexPath && !path.startsWith('/api')) {
      // A real asset is served as itself; anything else is a client-side route,
      // which the frontend router resolves.
      if (looksLikeAsset) {
        // Relative to the static root, which is what sendFile expects; an
        // absolute path is resolved against the root and misses.
        const assetPath = join(resolve(webDir!), path);
        if (assetPath.startsWith(resolve(webDir!)) && existsSync(assetPath)) {
          return reply.sendFile(path);
        }
      } else {
        return reply.sendFile('index.html');
      }
    }

    const body: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: `No route for ${req.method} ${req.url}`,
        status: 404,
        request_id: requestIdOf(req),
      },
    };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((error: unknown, req, reply) => {
    const candidate = error as { statusCode?: unknown; message?: unknown };
    const status =
      typeof candidate.statusCode === 'number' && candidate.statusCode >= 400
        ? candidate.statusCode
        : 500;
    const message = typeof candidate.message === 'string' ? candidate.message : 'Unknown error';

    if (status >= 500) {
      // The full error goes to the log, the message does not go to the client.
      app.log.error({ err: error, req: req.url }, 'request failed');
    }

    const body: ErrorEnvelope = {
      error: {
        code: status >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.VALIDATION_FAILED,
        message: status >= 500 ? 'Internal server error' : message,
        status,
        request_id: requestIdOf(req),
      },
    };
    void reply.status(status).send(body);
  });
}

/**
 * `GET /health` (DEP-06).
 *
 * The check is real: it runs `SELECT 1` and counts migrations, so a container
 * that is up but broken reports unhealthy instead of reassuring a human. A
 * 503 with `db: "error"` and the reason logged is the documented behaviour
 * (acceptance criterion 2).
 */
function registerHealth(app: FastifyInstance, db: Db, config: AppConfig): void {
  app.get('/health', async (_req, reply) => {
    // Read from the validated config, not process.env. The config was parsed
    // once at boot, and a value could have been defaulted there.
    const { TZ: timeZone } = config;
    const startedAt = Math.floor(nowMs() / 1000);

    try {
      db.prepare('SELECT 1').get();
      const status = migrationStatus(db);
      const body: HealthResponse = {
        status: 'ok',
        db: 'ok',
        version: process.env.npm_package_version ?? '0.1.0',
        uptime_s: Math.max(0, Math.floor(nowMs() / 1000) - startedAt),
        migrations: {
          applied: status.applied.length,
          pending: status.pending.length,
          ok: status.pending.length === 0,
        },
        time_zone: timeZone,
        now_ms: nowMs(),
      };
      return reply.status(200).send(body);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      app.log.error({ err: cause }, 'health check failed: database unreachable');

      const body: HealthResponse = {
        status: 'error',
        db: 'error',
        version: process.env.npm_package_version ?? '0.1.0',
        uptime_s: Math.max(0, Math.floor(nowMs() / 1000) - startedAt),
        migrations: { applied: 0, pending: 0, ok: false },
        time_zone: timeZone,
        db_error: message,
        now_ms: nowMs(),
      };
      return reply.status(503).send(body);
    }
  });
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
    app.log.info(`no frontend build at ${webDir}; serving the API only`);
    return;
  }

  void app.register(fastifyStatic, {
    root: resolve(webDir),
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


