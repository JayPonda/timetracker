import { z } from 'zod';

/**
 * The history contract, shared by the API and the web app.
 *
 * One entry per change, newest first — the question a history answers is “what
 * just happened”, and the owner reads downward from the present. `before` and
 * `after` hold only the fields that changed, not the whole row, so “what did I
 * change” reads as a line rather than a diff of two large objects
 * (`FR-STAT-05`).
 */

const historySideSchema = z.record(z.string(), z.unknown());

/** One history entry as the API returns it. */
export const historyEntrySchema = z.object({
  uid: z.string().uuid(),
  entity: z.string(),
  entity_id: z.number().int(),
  action: z.string(),
  before: historySideSchema.nullable(),
  after: historySideSchema.nullable(),
  at: z.number().int().nonnegative(),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** `GET /tasks/:id/history`. */
export const listHistoryResponseSchema = z.object({ history: z.array(historyEntrySchema) });
