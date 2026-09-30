import { z } from 'zod';

/**
 * The task-link contract, shared by the API, the web app and the MCP server.
 *
 * A task holds at most 3 links (`DATA-01`, `BR-04`, `FR-TASK-03`). The limit is
 * enforced twice: the trigger refuses a 4th row no matter who writes, and the
 * service refuses it first with a message naming the limit — a constraint
 * failure is an answer, but not a helpful one.
 *
 * **Scope of this slice.** Add, edit, archive and restore links on a task.
 * Positions are slots 1–3, assigned by the service, never by the client: a
 * client-chosen position is two writers agreeing on slot 2.
 */

const linkLabelSchema = z.string().max(200, 'A label is at most 200 characters');

/**
 * A URL the owner can actually open.
 *
 * Absolute with a scheme, because a relative string is not a link — it is text
 * that looks like one, and rendering it as `href` navigates away from the app
 * to nowhere. `https://…` is the shape; anything `new URL` accepts with a
 * scheme passes, so deep links to other apps keep working.
 */
const linkUrlSchema = z
  .string()
  .trim()
  .min(1, 'A link needs a URL')
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol.length > 1;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid URL like https://example.com/page' },
  );

/** `POST /tasks/:id/links` (`FR-TASK-03`). */
export const createTaskLinkSchema = z.object({
  label: linkLabelSchema.default(''),
  url: linkUrlSchema,
});

/**
 * `PATCH /task-links/:id`.
 *
 * Partial, with at least one field. Position is absent on purpose: slots are
 * assigned on create and on restore, and a client that could name its slot
 * could collide with another writer's.
 */
export const updateTaskLinkSchema = z
  .object({
    label: linkLabelSchema.optional(),
    url: linkUrlSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send a label or a URL',
  });

/** A link as the API returns it. */
export const taskLinkSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  task_id: z.number().int().positive(),
  label: z.string(),
  url: z.string(),
  position: z.number().int().min(1).max(3),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  archived_at: z.number().int().nonnegative().nullable(),
});

export type TaskLink = z.infer<typeof taskLinkSchema>;
export type CreateTaskLinkInput = z.infer<typeof createTaskLinkSchema>;
export type UpdateTaskLinkInput = z.infer<typeof updateTaskLinkSchema>;

/** `GET /tasks/:id/links` query string (`DATA-11`, like every other list). */
export const listTaskLinksQuerySchema = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListTaskLinksQuery = z.infer<typeof listTaskLinksQuerySchema>;

export const listTaskLinksResponseSchema = z.object({ links: z.array(taskLinkSchema) });
export const taskLinkResponseSchema = z.object({ link: taskLinkSchema });
