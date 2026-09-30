import type { Database } from 'better-sqlite3';
import { migrationStatus } from '../db/migrate.js';
import { logger } from '../lib/logger.js';

/**
 * The one probe, shared by `/health` and `/ready` (ADR 0013).
 *
 * **Why this is a function and not two handlers.** Both routes need the same two
 * facts — can this process reach its database, and is the schema the code
 * expects? — and duplicating the queries would mean two places to update the day
 * a third condition appeared, and two probes that could quietly disagree about
 * whether the app was working.
 *
 * **Why it reports two facts rather than one verdict.** The two routes
 * deliberately answer different questions, and collapsing them here would force
 * one of the routes to be wrong:
 *
 * | Route     | Question                          | Pending migrations |
 * | --------- | --------------------------------- | ------------------ |
 * | `/health` | is the container alive? (`DEP-06`) | reported, still 200 |
 * | `/ready`  | can it take work right now?        | **503**            |
 *
 * A container with migrations pending is up and answering, which is what
 * `DEP-06` asks `/health` to report, and it is also not able to serve a request,
 * which is what `/ready` is for. Deciding that here would have changed a
 * documented behaviour to make one of the two routes shorter.
 */

export interface ProbeResult {
  /** The database answered `SELECT 1`. */
  readonly dbOk: boolean;
  /** How many migrations the database is still waiting for. */
  readonly migrationsApplied: number;
  readonly migrationsPending: number;
  /**
   * The raw failure message, present only when the database is unreachable.
   *
   * Carried rather than swallowed because `/health` has always reported it
   * (`DEP-06`, and the 503 body of acceptance criterion 2), and a message that
   * says "database is unreachable" when the real answer is "disk I/O error" costs
   * an owner an hour. Whether it is safe to hand to a client is the **route's**
   * decision, not this function's: `/health` publishes it, `/ready` does not.
   */
  readonly dbError: string | undefined;
}

/**
 * Run the check.
 *
 * A failure is **caught, not thrown**: a probe that throws takes the process
 * down, and the whole point of asking is to report the condition instead. The
 * caller decides the status code.
 */
export function runProbe(db: Database): ProbeResult {
  try {
    db.prepare('SELECT 1').get();
    const status = migrationStatus(db);
    return {
      dbOk: true,
      migrationsApplied: status.applied.length,
      migrationsPending: status.pending.length,
      dbError: undefined,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logger.error('routes/probes.ts', 'runProbe', 'probe failed: database unreachable', {
      err: cause,
    });
    return {
      dbOk: false,
      migrationsApplied: 0,
      migrationsPending: 0,
      dbError: message,
    };
  }
}
