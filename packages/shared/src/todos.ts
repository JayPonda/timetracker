import { z } from 'zod';

/**
 * The todo contract, shared by the API, the web app and the MCP server.
 *
 * A todo is a **phase** of a task: a step, in order, that time can be tracked
 * against (0.3.0). It is never an acceptance criterion — a step is not a
 * condition, and merging them produces a list where the owner cannot tell which
 * is which (`NFR-USE-02`, `FR-AC-03`).
 *
 * **Scope of this slice.** Add, rename, reorder, tick done/not done, archive
 * and restore (`FR-TODO-01`, `FR-TODO-02`, `FR-PHASE-05`). Editing on an Ended
 * task (`FR-TODO-03`) waits for ended tasks to exist in 0.5.0; offering todos to
 * the timer (`FR-TODO-05`) waits for the timer in 0.3.0.
 */

const todoTitleSchema = z
  .string()
  .trim()
  .min(1, 'A todo needs a title')
  .max(500, 'A todo title is at most 500 characters');

const todoNoteSchema = z.string().max(5000, 'A note is at most 5000 characters');

const todoEstimateSchema = z.number().positive('An estimate must be more than zero hours');

/** `POST /tasks/:id/todos` (`FR-TODO-01`, `FR-TODO-02`). */
export const createTodoSchema = z.object({
  title: todoTitleSchema,
  note: todoNoteSchema.default(''),
  estimate_hours: todoEstimateSchema.nullable().default(null),
});

/**
 * `PATCH /todos/:id`.
 *
 * Partial, with at least one field. `done` is a real field here rather than a
 * separate endpoint: ticking is an edit with a timestamp attached, and the
 * service sets `done_at` from the flag rather than trusting the client with it
 * — a client-supplied completion date is a backdated fact waiting to happen.
 */
export const updateTodoSchema = z
  .object({
    title: todoTitleSchema.optional(),
    note: todoNoteSchema.optional(),
    done: z.boolean().optional(),
    estimate_hours: todoEstimateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send at least one todo field',
  });

/**
 * `PATCH /tasks/:id/todos/reorder` (`FR-TODO-01`).
 *
 * The complete order, not a move. A “move item 3 to position 1” request forces
 * the server to guess the rest of the list; a complete order has nothing to
 * guess and fails closed when an id is missing or foreign — silently dropping a
 * phase from the timeline would be worse than refusing the reorder.
 */
export const reorderTodosSchema = z.object({
  order: z
    .array(z.number().int().positive())
    .min(1, 'An order names every live todo of the task')
    .refine((order) => new Set(order).size === order.length, {
      message: 'An order names each todo exactly once',
    }),
});

/** A todo as the API returns it. Epoch milliseconds throughout (`DATA-07`). */
export const todoSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  task_id: z.number().int().positive(),
  title: z.string(),
  note: z.string(),
  /**
   * A boolean on the wire, `0`/`1` in the row.
   *
   * The database stores what SQLite can check (`CHECK (done IN (0, 1))`); the
   * API speaks what the owner means. The repository translates at the boundary,
   * in one place, so no caller converts.
   */
  done: z.boolean(),
  /**
   * Set when `done` becomes true, cleared when it becomes false.
   *
   * A timestamp, not a second boolean, because “done” without “since when” is
   * how a phase that was ticked, unticked and reticked loses its history
   * (`FR-TODO-02`).
   */
  done_at: z.number().int().nonnegative().nullable(),
  estimate_hours: z.number().positive().nullable(),
  position: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  archived_at: z.number().int().nonnegative().nullable(),
});

export type Todo = z.infer<typeof todoSchema>;
export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type ReorderTodosInput = z.infer<typeof reorderTodosSchema>;

/** `GET /tasks/:id/todos` query string (`DATA-11`, like every other list). */
export const listTodosQuerySchema = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;

export const listTodosResponseSchema = z.object({ todos: z.array(todoSchema) });
export const todoResponseSchema = z.object({ todo: todoSchema });
