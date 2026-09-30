import { z } from 'zod';

/**
 * The task contract, shared by the API, the web app and the MCP server.
 *
 * Tasks are the unit of work everything else hangs off: time entries point at
 * them, todos phase them, criteria define their done state. This file owns the
 * shapes so the three consumers cannot drift (`FR-TASK-01`…`FR-TASK-09`).
 *
 * **Scope of this slice.** Creation, editing, status between `open` and
 * `in_progress`, archive/restore, and filtered/sorted listing. Todos, links,
 * criteria, references and tags are later slices with their own schemas; actual
 * time and its sorting arrive with time tracking in 0.3.0. `ended` is a legal
 * stored value but is **not writable** here — exactly one function may set it
 * and that is the closure service in 0.5.0 (`FR-STAT-01`).
 */

/** Every status the database can hold (`D-2`). */
export const taskStatusSchema = z.enum(['open', 'in_progress', 'ended']);

/**
 * What a write may set in 0.2.0.
 *
 * `ended` is absent on purpose. A task reaches `ended` only through the closure
 * gate (`FR-STAT-01`, `FR-GATE-08`), so no create, edit or status move may name
 * it — not from the interface, not from the assistant, not from a test fixture.
 */
export const writableTaskStatusSchema = z.enum(['open', 'in_progress']);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

const taskNameSchema = z
  .string()
  .trim()
  .min(1, 'A task needs a name')
  .max(200, 'A task name is at most 200 characters');

/**
 * Long text, bounded.
 *
 * Descriptions carry basic formatting, so they are longer than a project blurb —
 * but unbounded text in a row is how one paste becomes a database problem.
 * 20,000 characters is room for a thorough brief and a ceiling a paste cannot
 * cross by accident.
 */
const taskDescriptionSchema = z.string().max(20_000, 'A description is at most 20000 characters');

const taskScoreSchema = z
  .number()
  .int('A score is a whole number')
  .min(0, 'A score cannot be negative');

/**
 * Decimal hours, strictly positive when present.
 *
 * Zero is not an estimate; it is the absence of one, and it is spelled `null`.
 * Accepting `0` would let “no estimate” and “estimated at nothing” mean
 * different things in different places.
 */
const taskEstimateSchema = z.number().positive('An estimate must be more than zero hours');

const epochMsSchema = z.number().int('A date must be epoch milliseconds').nonnegative();

/** `POST /tasks` (`FR-TASK-01`, `FR-TASK-04`, `FR-TASK-06`, `FR-TASK-07`). */
export const createTaskSchema = z
  .object({
    name: taskNameSchema,
    description: taskDescriptionSchema.default(''),
    /**
     * `null` is the “No project” bucket (`FR-PRJ-02`, criterion 8).
     *
     * Nullable rather than optional-with-meaning, because “no project” is a
     * real choice the owner makes, not the absence of a choice. The service
     * checks a provided id names a live project.
     */
    project_id: z.number().int().positive().nullable().default(null),
    status: writableTaskStatusSchema.default('open'),
    score: taskScoreSchema.nullable().default(null),
    estimate_hours: taskEstimateSchema.nullable().default(null),
    planned_start: epochMsSchema.nullable().default(null),
    due_date: epochMsSchema.nullable().default(null),
  })
  .refine(
    (value) =>
      value.planned_start === null ||
      value.due_date === null ||
      value.due_date >= value.planned_start,
    { message: 'A due date cannot be before the planned start.', path: ['due_date'] },
  );

/**
 * `PATCH /tasks/:id` (`FR-TASK-12`, with the `ended` exception below).
 *
 * Partial, with at least one field — the same “a PATCH that says nothing is not
 * an edit” rule as projects. `project_id` accepts an explicit `null` so a task
 * can be moved into “No project”, which is different from omitting the field.
 */
export const updateTaskSchema = z
  .object({
    name: taskNameSchema.optional(),
    description: taskDescriptionSchema.optional(),
    project_id: z.number().int().positive().nullable().optional(),
    status: writableTaskStatusSchema.optional(),
    score: taskScoreSchema.nullable().optional(),
    estimate_hours: taskEstimateSchema.nullable().optional(),
    planned_start: epochMsSchema.nullable().optional(),
    due_date: epochMsSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update: send at least one task field',
  })
  .refine(
    (value) =>
      value.planned_start === undefined ||
      value.planned_start === null ||
      value.due_date === undefined ||
      value.due_date === null ||
      value.due_date >= value.planned_start,
    { message: 'A due date cannot be before the planned start.', path: ['due_date'] },
  );

/** A task as the API returns it. Epoch milliseconds throughout (`DATA-07`). */
export const taskSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string().uuid(),
  project_id: z.number().int().positive().nullable(),
  /**
   * The project's name, joined — not stored.
   *
   * Denormalised in the response, not in the database: it is computed by the
   * list query so a row can show “Client work” without a second request. `null`
   * for “No project” and for a project the list is not showing.
   */
  project_name: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  score: z.number().int().nonnegative().nullable(),
  estimate_hours: z.number().positive().nullable(),
  planned_start: z.number().int().nonnegative().nullable(),
  due_date: z.number().int().nonnegative().nullable(),
  started_at: z.number().int().nonnegative().nullable(),
  ended_at: z.number().int().nonnegative().nullable(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  archived_at: z.number().int().nonnegative().nullable(),
});

export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * `GET /tasks` query string (`FR-VIEW-03`, `DATA-11`).
 *
 * Filters compose: project, status and archive visibility narrow the same list.
 * Sorting names only what exists — name, dates, score, estimate. Actual time is
 * **not** a sort key here because totals are computed in views that do not exist
 * yet (`DATA-04`); it arrives with 0.3.0 rather than as a column that could
 * drift.
 */
export const listTasksQuerySchema = z.object({
  /**
   * A project id, or the literal `none` for the “No project” bucket
   * (`FR-PRJ-02`). A string literal rather than `0` or `-1`, because a magic
   * number is a project id waiting to collide with a real one.
   */
  project_id: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
  status: taskStatusSchema.optional(),
  sort: z.enum(['name', 'created_at', 'due_date', 'score', 'estimate_hours']).default('created_at'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const listTasksResponseSchema = z.object({ tasks: z.array(taskSchema) });
export const taskResponseSchema = z.object({ task: taskSchema });
