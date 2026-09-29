import type { Database } from 'better-sqlite3';
import { nowMs, type HealthResponse } from '@pdm/shared';
import type { AppConfig } from '../config/index.js';
import { migrationStatus } from '../db/migrate.js';
import { logger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import type { RouteDeclaration } from './table.js';

/**
 * `GET /health` (DEP-06).
 *
 * Declared through the route table like every other route, so the "every route
 * declares its capabilities" audit covers it too. It is the one `public` route:
 * the Docker health check calls it with no principal, and it has to be answerable
 * before anything else in the process works.
 *
 * The check is real: it runs `SELECT 1` and counts migrations, so a container
 * that is up but broken reports unhealthy instead of reassuring a human. A 503
 * with `db: "error"` and the reason logged is the documented behaviour
 * (acceptance criterion 2 of 0.1.0).
 */
export function healthRoute(options: {
  db: Database;
  config: AppConfig;
  /** Read once when the server is built, never per request. */
  startedAtMs: number;
}): RouteDeclaration {
  const { db, config, startedAtMs } = options;

  return {
    method: 'GET',
    url: '/health',
    public: true,
    capabilities: [],
    description: 'Liveness and database check for the container health check',
    handler: async (_req, reply) => {
      const uptimeSeconds = (): number => Math.max(0, Math.floor((nowMs() - startedAtMs) / 1000));

      // Read from the validated config, not process.env. The config was parsed
      // once at boot, and a value could have been defaulted there.
      const { TZ: timeZone } = config;

      try {
        db.prepare('SELECT 1').get();
        const status = migrationStatus(db);
        const body: HealthResponse = {
          status: 'ok',
          db: 'ok',
          version: VERSION,
          uptime_s: uptimeSeconds(),
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
        logger.error('routes/health.ts', 'health', 'health check failed: database unreachable', {
          err: cause,
        });

        const body: HealthResponse = {
          status: 'error',
          db: 'error',
          version: VERSION,
          uptime_s: uptimeSeconds(),
          migrations: { applied: 0, pending: 0, ok: false },
          time_zone: timeZone,
          db_error: message,
          now_ms: nowMs(),
        };
        return reply.status(503).send(body);
      }
    },
  };
}
