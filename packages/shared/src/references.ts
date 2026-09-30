import { z } from 'zod';

/**
 * The reference-material contract, shared by the API, the web app and the MCP
 * server.
 *
 * Notes, links, snippets, lessons and decisions kept against a task — and kept
 * after it ends, because the point of the product is that what was learned
 * outlives the task (`FR-REF-01`, `FR-REF-02`, `FR-REF-05`).
 *
 * **Scope of this slice.** Add, edit and archive items on a task. Search
 * (`FR-REF-03`) and the cross-task library (`FR-REF-04`) arrive with search in
 * 0.8.0; file attachments (`FR-REF-06`) are Could-level and unplanned. The
 * `task_id` column is nullable for the future library, but this slice only
 * writes task-attached items — an unattached reference with nowhere to be
 * found is a row waiting to be lost.
 */

export const referenceTypeSchema = z.enum(['note', 'link', 'snippet', 'lesson', 'decision']);

export type ReferenceType = z.infer<typeof referenceTypeSchema>;

const referenceTitleSchema = z
  .string()
  .trim()
  .min(1, 'A reference needs a title')
  .max(200, 'A title is at most 200 characters');

const referenceBodySchema = z.string().max(20_000, 'A body is at most 20000 characters');

/**
 * An optional URL that must open when present.
 *
 * Same rule as task links: absolute with a scheme, because a relative string
 * rendered as `href` navigates away from the app to nowhere. `null` means
 * “no URL”, not “an empty one” — an empty string would be a link to nothing.
 */
const referenceUrlSchema = z
  .string()
  .trim()
  .min(1, 'A URL cannot be blank')
  .refine(
    (value) => {
      try {
        return new URL(value).protocol.length > 1;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid URL like https://example.com/page' },
  )
  .nullable();

/** `POST /tasks/:id/references` (`FR-REF-01`, `FR-REF-02`). */
export const createReferenceSchema = z.object({
  title: referenceTitleSchema,
  body: referenceBodySchema.default(''),
  url: referenceUrlSchema.default(null),
  type: referenceTypeSchema.default('note'),
});

/** `PATCH /references/:id`. Partial, with at least one field. */
export const updateReferenceSchema = z
  .object({
    title: referenceTitleSchema.optional(),
    body: referenceBodySchema.optional(),
    url: referenceUrlSchema.optional(),
    type: referenceTypeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send at least one reference field',
  });

/** A reference item as the API returns it. */
export const referenceSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  task_id: z.number().int().positive().nullable(),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable(),
  type: referenceTypeSchema,
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  archived_at: z.number().int().nonnegative().nullable(),
});

export type Reference = z.infer<typeof referenceSchema>;
export type CreateReferenceInput = z.infer<typeof createReferenceSchema>;
export type UpdateReferenceInput = z.infer<typeof updateReferenceSchema>;

/** `GET /tasks/:id/references` query string (`DATA-11`, like every other list). */
export const listReferencesQuerySchema = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListReferencesQuery = z.infer<typeof listReferencesQuerySchema>;

export const listReferencesResponseSchema = z.object({ references: z.array(referenceSchema) });
export const referenceResponseSchema = z.object({ reference: referenceSchema });
