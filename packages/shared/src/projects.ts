import { z } from 'zod';

/**
 * The project contract, shared by the API, the web app and the MCP server
 * (AGENTS.md Part 6: validation is a zod schema the three of them share).
 *
 * It lives here rather than in `apps/api` so that the browser and the assistant
 * validate a payload with **the same** schema the server does. Three copies of a
 * validation rule is three rules, and the third one is the one that is wrong.
 *
 * `FR-PRJ-01` — name, optional description, optional colour.
 */

/**
 * A colour as `#rrggbb`, and nothing else.
 *
 * A hex triplet rather than a colour name, because the value is written straight
 * into a `style` attribute by the interface and a name would let arbitrary text
 * reach it. Six hex digits and a leading `#` is the whole grammar; there is no
 * three-digit shorthand, because a shorthand is a second spelling to support and
 * this project stores one format.
 */
export const projectColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour like #4f46e5')
  .describe('Six hex digits with a leading #.');

/** The default when the owner does not choose one. Matches the column default. */
export const DEFAULT_PROJECT_COLOUR = '#6b7280';

const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'A project needs a name')
  .max(200, 'A project name is at most 200 characters');

const projectDescriptionSchema = z.string().max(2000, 'A description is at most 2000 characters');

/** `POST /projects` (`FR-PRJ-01`). */
export const createProjectSchema = z.object({
  name: projectNameSchema,
  description: projectDescriptionSchema.default(''),
  colour: projectColourSchema.default(DEFAULT_PROJECT_COLOUR),
});

/**
 * `PATCH /projects/:id` (`FR-PRJ-03`).
 *
 * Every field optional, because it is a partial update, and **at least one field
 * required** — a `PATCH` with an empty body is a request that says nothing, and
 * accepting it would mean answering 200 for an edit that never happened.
 */
export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema.optional(),
    colour: projectColourSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send at least one of name, description or colour',
  });

/** A project as the API returns it. Epoch-millisecond integers, never ISO (`DATA-07`). */
export const projectSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  colour: z.string(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  /**
   * `null` while the project is live.
   *
   * A number, not an ISO string, because this is a storage-path timestamp
   * (`DATA-07`) and every other timestamp in the API is the same shape.
   */
  archived_at: z.number().int().nonnegative().nullable(),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** `GET /projects` query string. */
export const listProjectsQuerySchema = z.object({
  /**
   * `DATA-11`: archived rows are left out of default lists and pickers, and
   * appear only when this is on. The default is therefore **off**, and it is
   * expressed as a query parameter rather than a separate URL so that one list
   * endpoint serves both and the rule cannot be bypassed by calling the wrong
   * path.
   */
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/**
 * The list and single-item envelopes.
 *
 * They live with the contract rather than in the web app so the browser does not
 * invent its own response shape. A client that parses something else is a client
 * that can drift from the server without a failing test.
 */
export const listProjectsResponseSchema = z.object({ projects: z.array(projectSchema) });
export const projectResponseSchema = z.object({ project: projectSchema });
