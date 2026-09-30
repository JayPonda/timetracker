import { z } from 'zod';

/**
 * The tag contract, shared by the API, the web app and the MCP server.
 *
 * A tag is a label for a time entry (`FR-TAG-01`, `FR-TAG-02`, `FR-TAG-05`).
 * Entries arrive in 0.3.0; this slice builds the tag manager — create, rename,
 * colour, archive — so the names exist before the first entry needs one.
 * Creating on the fly while typing (`FR-TAG-01`) comes with the entry form it
 * types into.
 *
 * **One live tag per name.** Uniqueness is partial (`archived_at IS NULL`), so
 * archiving releases the name while the old tag keeps its history and its
 * entries. Renaming onto a live name, or restoring under a taken one, is
 * refused with the name in the message — the database would refuse with a
 * constraint error, which answers nothing.
 */

/**
 * A tag name: trimmed, non-blank, one line.
 *
 * Newlines are refused because a name renders in pickers, pills and table
 * cells — a two-line tag is a layout break typed into the database. 100
 * characters is room for “waiting-for-client-feedback” with margin.
 */
const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'A tag needs a name')
  .max(100, 'A tag name is at most 100 characters')
  .refine((value) => !/[\r\n]/.test(value), {
    message: 'A tag name must fit on one line',
  });

const tagColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour like #4f46e5')
  .describe('Six hex digits with a leading #.');

/** The default when the owner does not choose one. Matches the column default. */
export const DEFAULT_TAG_COLOUR = '#6b7280';

/** `POST /tags` (`FR-TAG-01`). */
export const createTagSchema = z.object({
  name: tagNameSchema,
  colour: tagColourSchema.default(DEFAULT_TAG_COLOUR),
});

/** `PATCH /tags/:id` (`FR-TAG-01`). Partial, with at least one field. */
export const updateTagSchema = z
  .object({
    name: tagNameSchema.optional(),
    colour: tagColourSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send a name or a colour',
  });

/** A tag as the API returns it. */
export const tagSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  name: z.string(),
  colour: z.string(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  archived_at: z.number().int().nonnegative().nullable(),
});

export type Tag = z.infer<typeof tagSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

/** `GET /tags` query string (`DATA-11`, like every other list). */
export const listTagsQuerySchema = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListTagsQuery = z.infer<typeof listTagsQuerySchema>;

export const listTagsResponseSchema = z.object({ tags: z.array(tagSchema) });
export const tagResponseSchema = z.object({ tag: tagSchema });
