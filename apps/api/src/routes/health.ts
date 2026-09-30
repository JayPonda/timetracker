import type { Database } from 'better-sqlite3';
import { nowMs, type HealthResponse } from '@pdm/shared';
import type { AppConfig } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import { runProbe } from './probes.js';
import type { RouteDeclaration } from './table.js';

/**
 * `GET /health` (DEP-06).
 *
 * Declared through the route table like every other route, so the "every route
 * declares its capabilities" audit covers it too. It is `public`: the Docker
 * health check calls it with no principal, and it has to be answerable before
 * anything else in the process works.
 *
 * The check is real: it runs `SELECT 1` and counts migrations, so a container
 * that is up but broken reports unhealthy instead of reassuring a human. A 503
 * with `db: "error"` and the reason logged is the documented behaviour
 * (acceptance criterion 2 of 0.1.0).
 *
 * **Pending migrations are reported but do not fail it.** The container is up
 * and answering, which is the question `DEP-06` asks; the body carries
 * `migrations.ok: false` so an operator can see the schema is behind. `/ready`
 * is the route that treats pending migrations as not-ready. See `probes.ts`.
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

      const probe = runProbe(db);

      if (!probe.dbOk) {
        const body: HealthResponse = {
          status: 'error',
          db: 'error',
          version: VERSION,
          uptime_s: uptimeSeconds(),
          migrations: { applied: 0, pending: 0, ok: false },
          time_zone: timeZone,
          db_error: probe.dbError ?? 'database is unreachable',
          now_ms: nowMs(),
        };
        logger.warn('routes/health.ts', 'health', 'reporting unhealthy', {
          reason: body.db_error,
        });
        return reply.status(503).send(body);
      }

      const body: HealthResponse = {
        status: 'ok',
        db: 'ok',
        version: VERSION,
        uptime_s: uptimeSeconds(),
        migrations: {
          applied: probe.migrationsApplied,
          pending: probe.migrationsPending,
          ok: probe.migrationsPending === 0,
        },
        time_zone: timeZone,
        now_ms: nowMs(),
      };
      return reply.status(200).send(body);
    },
  };
}
