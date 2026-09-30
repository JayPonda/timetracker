import { z } from 'zod';

/**
 * The acceptance-criteria contract, shared by the API, the web app and the MCP
 * server.
 *
 * A criterion is the definition of done: a short statement that is either met
 * or not met at closure time (`FR-AC-02`). It is not a todo — a condition is
 * not a step — and the two are never mixed in the interface (`NFR-USE-02`,
 * `FR-AC-03`). Whether it was met is decided at closure in 0.5.0, never here:
 * this slice records what “done” means, not whether it happened.
 *
 * **Scope of this slice.** Add, edit, reorder and archive criteria on a task
 * (`FR-AC-01`). Templates (`FR-AC-06`) are Could-level and unplanned; editing
 * after closure (`FR-AC-04`) waits for closures to exist in 0.5.0.
 */

const criterionTextSchema = z
  .string()
  .trim()
  .min(1, 'A criterion needs a statement')
  .max(500, 'A criterion is a short statement of at most 500 characters');

/** `POST /tasks/:id/criteria` (`FR-AC-01`). */
export const createCriterionSchema = z.object({
  text: criterionTextSchema,
});

/**
 * `PATCH /criteria/:id`.
 *
 * Partial in shape, singular in practice: the text is the only field, and an
 * empty body is not an edit.
 */
export const updateCriterionSchema = z
  .object({
    text: criterionTextSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send the criterion text',
  });

/**
 * `PATCH /tasks/:id/criteria/reorder` (`FR-AC-01`).
 *
 * The complete order, like todos: a partial order has the server guessing, and
 * a guessed definition of done is not a definition.
 */
export const reorderCriteriaSchema = z.object({
  order: z
    .array(z.number().int().positive())
    .min(1, 'An order names every live criterion of the task')
    .refine((order) => new Set(order).size === order.length, {
      message: 'An order names each criterion exactly once',
    }),
});

/** A criterion as the API returns it. Epoch milliseconds throughout (`DATA-07`). */
export const criterionSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  task_id: z.number().int().positive(),
  text: z.string(),
  position: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  archived_at: z.number().int().nonnegative().nullable(),
});

export type Criterion = z.infer<typeof criterionSchema>;
export type CreateCriterionInput = z.infer<typeof createCriterionSchema>;
export type UpdateCriterionInput = z.infer<typeof updateCriterionSchema>;
export type ReorderCriteriaInput = z.infer<typeof reorderCriteriaSchema>;

/** `GET /tasks/:id/criteria` query string (`DATA-11`, like every other list). */
export const listCriteriaQuerySchema = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListCriteriaQuery = z.infer<typeof listCriteriaQuerySchema>;

export const listCriteriaResponseSchema = z.object({ criteria: z.array(criterionSchema) });
export const criterionResponseSchema = z.object({ criterion: criterionSchema });
