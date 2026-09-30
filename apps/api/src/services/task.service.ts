import {
  nowMs,
  newUid,
  type CreateTaskInput,
  type Task,
  type UpdateTaskInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createTaskRepository,
  type Executor,
  type TaskRepository,
} from '../repositories/task.repository.js';
import { createProjectRepository, type ProjectRepository } from '../repositories/project.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Tasks, core slice (`FR-TASK-01/02/04/05/06/07/08/12/13`, `FR-STAT-01/04/05`,
 * `FR-VIEW-01/03`, `BR-16`, `DATA-11`).
 *
 * **No delete method.** `FR-TASK-13` is that a task is never deleted; archive is
 * a `PATCH` and restore brings it back, with time entries and history untouched.
 *
 * **No write path to `ended`.** The type of every input in this file excludes
 * it, and the only transition logic here moves between `open` and `in_progress`.
 * `ended` is set by exactly one function — the closure service in 0.5.0 — which
 * is what makes `FR-STAT-01` provable by reading the code rather than by hoping
 * every route remembered. A defensive check below also refuses to move a task
 * that is somehow already `ended`, so a legacy row cannot be edited into a
 * different state by this service.
 *
 * Every write runs in one transaction with its activity-log entry (`FR-STAT-05`).
 */
export interface TaskService {
  create(input: CreateTaskInput): Promise<Task>;
  get(id: number, options?: { includeArchived?: boolean }): Promise<Task>;
  list(options: {
    projectId?: number | 'none';
    status?: Task['status'];
    sort?: 'name' | 'created_at' | 'due_date' | 'score' | 'estimate_hours';
    direction?: 'asc' | 'desc';
    includeArchived?: boolean;
  }): Promise<Task[]>;
  update(id: number, input: UpdateTaskInput): Promise<Task>;
  archive(id: number): Promise<Task>;
  restore(id: number): Promise<Task>;
}

function loggableFields(task: Task): Record<string, unknown> {
  return {
    name: task.name,
    description: task.description,
    project_id: task.project_id,
    status: task.status,
    score: task.score,
    estimate_hours: task.estimate_hours,
    planned_start: task.planned_start,
    due_date: task.due_date,
    started_at: task.started_at,
    archived_at: task.archived_at,
  };
}

export function createTaskService(knex: Knex, activityLog: ActivityLogService): TaskService {
  const repository: TaskRepository = createTaskRepository(knex);
  const projects: ProjectRepository = createProjectRepository(knex);

  const loadForWrite = async (id: number, executor: Executor): Promise<Task> => {
    const task = await repository.findById(id, { includeArchived: true }, executor);
    if (!task) throw notFound(`Task ${id}`);
    return task;
  };

  /**
   * The project a task points at must be live.
   *
   * A task created into an archived project would be hidden at birth, which is
   * the kindest possible description of losing it. Refuse, and say which.
   */
  const requireLiveProject = async (
    projectId: number,
    executor: Executor,
  ): Promise<{ id: number; name: string }> => {
    const project = await projects.findById(projectId, { includeArchived: false }, executor);
    if (!project) {
      throw validationFailed(
        `Project ${projectId} does not exist or is archived. Restore it first, or file the task under “No project” (FR-PRJ-02, FR-PRJ-04).`,
        { issues: [{ path: 'project_id', message: 'must be a live project', code: 'archived' }] },
      );
    }
    return { id: project.id, name: project.name };
  };

  return {
    async create(input) {
      return knex.transaction(async (trx) => {
        const at = nowMs();
        const uid = newUid();

        let projectName: string | null = null;
        if (input.project_id !== null) {
          projectName = (await requireLiveProject(input.project_id, trx)).name;
        }

        const row = {
          uid,
          name: input.name,
          description: input.description,
          project_id: input.project_id,
          status: input.status,
          score: input.score,
          estimate_hours: input.estimate_hours,
          planned_start: input.planned_start,
          due_date: input.due_date,
          // First move to `in_progress` can be the creation itself
          // (`FR-TASK-08`): a task born in progress has started.
          started_at: input.status === 'in_progress' ? at : null,
          ended_at: null,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: Task = { id, project_name: projectName, ...row };

        await activityLog.recordChange(
          { entity: 'task', entityId: id, action: 'created', before: null, after: loggableFields(created) },
          trx,
        );

        logger.info('task.service.ts', 'create', 'task created', { task_id: id, uid });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const task = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!task) throw notFound(`Task ${id}`);
        return task;
      });
    },

    async list(options) {
      return knex.transaction(async (trx) =>
        repository.list(
          {
            projectId: options.projectId,
            status: options.status,
            sort: options.sort ?? 'created_at',
            direction: options.direction ?? 'desc',
            includeArchived: options.includeArchived,
          },
          trx,
        ),
      );
    },

    async update(id, input) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at !== null) {
          throw validationFailed(
            `Task ${id} is archived. Restore it before editing it (FR-TASK-13).`,
            { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
          );
        }

        // A task hidden by its project stays exactly as it is, unless the edit
        // moves it out into the open. `BR-16` hides a project's tasks without
        // changing them; editing one in place would break that promise quietly.
        let nextProjectId = before.project_id;
        let nextProjectName = before.project_name;
        if (input.project_id !== undefined) {
          nextProjectId = input.project_id;
          if (nextProjectId === null) {
            nextProjectName = null;
          } else {
            nextProjectName = (await requireLiveProject(nextProjectId, trx)).name;
          }
        }
        if (before.project_id !== null && nextProjectId === before.project_id) {
          const current = await projects.findById(before.project_id, { includeArchived: true }, trx);
          if (current && current.archived_at !== null) {
            throw validationFailed(
              `Task ${id} belongs to archived project ${current.id}. Restore the project, or move the task to a live project or “No project” (BR-16).`,
              { issues: [{ path: 'project_id', message: 'project is archived', code: 'archived' }] },
            );
          }
        }

        // `ended` is not a member of the input type, so no caller holding a
        // validated payload can name it. This guards the one path the type
        // cannot see: a row that is already `ended` must not be moved by this
        // service at all (`FR-STAT-01`).
        if (before.status === 'ended' && input.status !== undefined) {
          throw validationFailed(
            `Task ${id} is ended. Only the closure service may change an ended task (FR-STAT-01).`,
            { issues: [{ path: 'status', message: 'task is ended', code: 'ended' }] },
          );
        }

        const nextStatus = input.status ?? before.status;
        const nextPlanned = input.planned_start !== undefined ? input.planned_start : before.planned_start;
        const nextDue = input.due_date !== undefined ? input.due_date : before.due_date;
        if (nextPlanned !== null && nextDue !== null && nextDue < nextPlanned) {
          throw validationFailed('A due date cannot be before the planned start.', {
            issues: [{ path: 'due_date', message: 'must be on or after planned_start', code: 'invalid' }],
          });
        }

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.project_id !== undefined) patch.project_id = input.project_id;
        if (input.status !== undefined) patch.status = input.status;
        if (input.score !== undefined) patch.score = input.score;
        if (input.estimate_hours !== undefined) patch.estimate_hours = input.estimate_hours;
        if (input.planned_start !== undefined) patch.planned_start = input.planned_start;
        if (input.due_date !== undefined) patch.due_date = input.due_date;
        if (nextStatus === 'in_progress' && before.started_at === null) {
          patch.started_at = patch.updated_at;
        }

        const updated = await repository.patch(id, patch, trx);
        // Unreachable by construction, and covered by no test on purpose: the
        // row was loaded above in the same transaction, and rows are never
        // deleted — the `BEFORE DELETE` trigger forbids it (`DATA-10`) — so the
        // patch always matches. The guard stays because a silent no-op write is
        // the worst failure a mutation can have: without it, a broken invariant
        // would log history for a change that did not happen.
        /* v8 ignore next */
        if (!updated) throw notFound(`Task ${id}`);

        const after: Task = {
          ...before,
          ...patch,
          project_id: nextProjectId,
          project_name: nextProjectName,
        } as Task;

        await activityLog.recordChange(
          {
            entity: 'task',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('task.service.ts', 'update', 'task updated', { task_id: id });
        return after;
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at !== null) {
          throw validationFailed(`Task ${id} is already archived (FR-TASK-13).`, {
            issues: [{ path: 'archived_at', message: 'already archived', code: 'already_archived' }],
          });
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        // Same unreachable-by-construction guard as in `update` above.
        /* v8 ignore next */
        if (!updated) throw notFound(`Task ${id}`);

        const after: Task = { ...before, archived_at: at, updated_at: at };

        // Entries and history are untouched: archiving hides the task, and
        // `DATA-04` forbids the totals from moving with it.
        await activityLog.recordChange(
          { entity: 'task', entityId: id, action: 'archived', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('task.service.ts', 'archive', 'task archived', { task_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at === null) {
          throw validationFailed(`Task ${id} is not archived (FR-TASK-13).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: null, updated_at: at }, trx);
        // Same unreachable-by-construction guard as in `update` above.
        /* v8 ignore next */
        if (!updated) throw notFound(`Task ${id}`);

        // Restoring the task does not restore its project: if the project is
        // still archived, the task stays hidden until the project comes back
        // (`BR-16`). Un-hiding one half of the pair would be the toggle lying.
        const after: Task = { ...before, archived_at: null, updated_at: at };

        await activityLog.recordChange(
          { entity: 'task', entityId: id, action: 'restored', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('task.service.ts', 'restore', 'task restored', { task_id: id });
        return after;
      });
    },
  };
}
