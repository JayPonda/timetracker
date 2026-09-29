import { z } from 'zod';

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
