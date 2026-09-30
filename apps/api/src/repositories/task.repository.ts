import type { Knex } from 'knex';
import type { ListTasksQuery, Task } from '@pdm/shared';

/**
 * `tasks` queries (`FR-TASK-01`…`FR-TASK-09`, `FR-VIEW-03`, `DATA-11`, `BR-16`).
 *
 * Queries and nothing else (ground rule 1). Status transitions, the `ended`
 * refusal and the “is this project live” check are `task.service.ts`.
 *
 * **Two archive filters, not one.** A task is hidden by default when it is
 * archived itself *or* when its project is archived (`FR-PRJ-04`, `BR-16`):
 * archiving a project hides its tasks without touching them, so the filter must
 * read the project's state rather than copying it onto the task. `includeArchived`
 * lifts both, because “Show archived” that still hid half the archived things
 * would be a toggle that lies.
 */

/** A Knex executor: the pool, or a transaction the service already owns. */
export type Executor = Knex | Knex.Transaction;

export type TaskRow = Task;

export interface NewTaskRow {
  readonly uid: string;
  readonly name: string;
  readonly description: string;
  readonly project_id: number | null;
  readonly status: Task['status'];
  readonly score: number | null;
  readonly estimate_hours: number | null;
  readonly planned_start: number | null;
  readonly due_date: number | null;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly archived_at: number | null;
}

export type TaskPatch = Partial<
  Pick<
    TaskRow,
    | 'name'
    | 'description'
    | 'project_id'
    | 'status'
    | 'score'
    | 'estimate_hours'
    | 'planned_start'
    | 'due_date'
    | 'started_at'
    | 'updated_at'
    | 'archived_at'
  >
>;

export interface TaskListOptions {
  readonly projectId?: number | 'none';
  readonly status?: Task['status'];
  readonly sort: ListTasksQuery['sort'];
  readonly direction: ListTasksQuery['direction'];
  readonly includeArchived?: boolean;
}

export interface TaskFindOptions {
  readonly includeArchived?: boolean;
}

const SORT_COLUMNS: Record<ListTasksQuery['sort'], string> = {
  name: 'tasks.name',
  created_at: 'tasks.created_at',
  due_date: 'tasks.due_date',
  score: 'tasks.score',
  estimate_hours: 'tasks.estimate_hours',
};

export interface TaskRepository {
  insert(row: NewTaskRow, executor?: Executor): Promise<number>;
  findById(id: number, options?: TaskFindOptions, executor?: Executor): Promise<TaskRow | null>;
  list(options: TaskListOptions, executor?: Executor): Promise<TaskRow[]>;
  patch(id: number, patch: TaskPatch, executor?: Executor): Promise<boolean>;
}

export function createTaskRepository(knex: Knex): TaskRepository {
  const run = (executor?: Executor): Knex | Knex.Transaction => executor ?? knex;

  const base = (executor?: Executor): Knex.QueryBuilder =>
    run(executor)
      .select('tasks.*', 'projects.name as project_name')
      .from('tasks')
      .leftJoin('projects', 'projects.id', 'tasks.project_id');

  /** The `DATA-11` + `BR-16` filter. Every read in this file goes through it. */
  const scope = (query: Knex.QueryBuilder, includeArchived: boolean | undefined): Knex.QueryBuilder => {
    if (includeArchived === true) return query;
    return query
      .whereNull('tasks.archived_at')
      .andWhere((qb: Knex.QueryBuilder) => {
        qb.whereNull('tasks.project_id').orWhereNull('projects.archived_at');
      });
  };

  return {
    async insert(row, executor) {
      const runner = run(executor);
      await runner.insert(row).into('tasks');

      // Same lesson as projects: read the id back through the unique `uid`
      // rather than trusting a driver-specific `returning()` shape.
      const created = await runner.select('id').from('tasks').where({ uid: row.uid }).first();
      const id = Number((created as { id: number } | undefined)?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Task insert did not return a row id.');
      }
      return id;
    },

    async findById(id, options, executor) {
      const row = await scope(base(executor).where('tasks.id', id), options?.includeArchived).first();
      return (row as TaskRow | undefined) ?? null;
    },

    async list(options, executor) {
      let query = scope(base(executor), options.includeArchived);

      if (options.projectId === 'none') {
        query = query.whereNull('tasks.project_id');
      } else if (options.projectId !== undefined) {
        query = query.where('tasks.project_id', options.projectId);
      }

      if (options.status !== undefined) {
        query = query.where('tasks.status', options.status);
      }

      // The `id` tiebreak makes the order total: without it two tasks with the
      // same due date (or two nulls) come back in whatever order the database
      // feels like, and the list reorders itself on refresh.
      query = query
        .orderBy(SORT_COLUMNS[options.sort], options.direction)
        .orderBy('tasks.id', options.direction);

      return (await query) as TaskRow[];
    },

    async patch(id, patch, executor) {
      const affected = await run(executor).update(patch).from('tasks').where({ id });
      return affected > 0;
    },
  };
}
