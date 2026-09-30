import type { Database } from 'better-sqlite3';
import { nowMs, type ReadyResponse } from '@pdm/shared';
import { runProbe } from './probes.js';
import type { RouteDeclaration } from './table.js';

/**
 * `GET /ready` (ADR 0013).
 *
 * The readiness probe: **can this process take a request right now?** It is
 * `public` and unprefixed, like `/health`, because the thing that asks it — an
 * orchestrator, a load balancer, `docker compose` — knows nothing about this
 * app's URL design and should not have to.
 *
 * **How it differs from `/health`, and why that is worth a second route.**
 *
 * - Pending migrations make `/ready` a **503**, where `/health` still answers
 *   200. The app refuses to serve against an un-migrated schema
 *   (`SchemaNotReadyError`), so a process with migrations pending is alive and
 *   unable to do its job — which is the definition of not ready, and the case a
 *   liveness check must not report as a failure.
 * - The body is smaller and carries no `version` or `uptime_s`. Those answer
 *   "is it alive and which build is it", which is `/health`'s job.
 * - The failure reason is a **fixed string**, not the raw SQLite message. This
 *   body is read by whatever is watching the container and is often more widely
 *   visible than a log; `/health` publishes the real message because an owner
 *   debugging at 2am needs it.
 */
export function readyRoute(options: { db: Database }): RouteDeclaration {
  const { db } = options;

  return {
    method: 'GET',
    url: '/ready',
    public: true,
    capabilities: [],
    description: 'Readiness probe: 200 only when the app can serve a request',
    handler: async (_req, reply) => {
      const probe = runProbe(db);

      if (!probe.dbOk) {
        const body: ReadyResponse = {
          status: 'not_ready',
          db: 'error',
          migrations_pending: probe.migrationsPending,
          reason: 'database is unreachable',
          now_ms: nowMs(),
        };
        return reply.status(503).send(body);
      }

      if (probe.migrationsPending > 0) {
        const body: ReadyResponse = {
          status: 'not_ready',
          db: 'ok',
          migrations_pending: probe.migrationsPending,
          reason: `${probe.migrationsPending} migration(s) pending; run the migrator`,
          now_ms: nowMs(),
        };
        return reply.status(503).send(body);
      }

      const body: ReadyResponse = {
        status: 'ready',
        db: 'ok',
        migrations_pending: 0,
        now_ms: nowMs(),
      };
      return reply.status(200).send(body);
    },
  };
}
