import {
  nowMs,
  newUid,
  type CreateTodoInput,
  type Todo,
  type UpdateTodoInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createTodoRepository,
  type Executor,
  type TodoRepository,
} from '../repositories/todo.repository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/task.repository.js';
import { createProjectRepository, type ProjectRepository } from '../repositories/project.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Todos (`FR-TODO-01`, `FR-TODO-02`, `FR-PHASE-05`, `FR-STAT-05`).
 *
 * **No delete method.** `FR-PHASE-05` is that a todo is archived, never deleted,
 * and an archived todo stays linked to its time entries so phase totals do not
 * change. Nothing here touches `time_entries` at all — the entries keep their
 * `todo_id` because no statement in this file names that table.
 *
 * **Position is ordering, not content.** Reorder assigns positions and writes no
 * history row: a history that logs “moved from 2 to 1” for every drag would bury
 * the renames and ticks it exists to show. Content changes log their diff in the
 * same transaction (`FR-STAT-05`).
 *
 * Writes are refused on an archived task, and on a task hidden by an archived
 * project — adding a phase changes the task, and `BR-16` says a hidden task
 * stays exactly as it is. Restore (the task, or its project) is the way back.
 */
export interface TodoService {
  create(taskId: number, input: CreateTodoInput): Promise<Todo>;
  get(id: number, options?: { includeArchived?: boolean }): Promise<Todo>;
  listByTask(taskId: number, options?: { includeArchived?: boolean }): Promise<Todo[]>;
  update(id: number, input: UpdateTodoInput): Promise<Todo>;
  reorder(taskId: number, order: readonly number[]): Promise<Todo[]>;
  archive(id: number): Promise<Todo>;
  restore(id: number): Promise<Todo>;
}

function loggableFields(todo: Todo): Record<string, unknown> {
  return {
    title: todo.title,
    note: todo.note,
    done: todo.done,
    done_at: todo.done_at,
    estimate_hours: todo.estimate_hours,
    archived_at: todo.archived_at,
  };
}

export function createTodoService(knex: Knex, activityLog: ActivityLogService): TodoService {
  const repository: TodoRepository = createTodoRepository(knex);
  const tasks: TaskRepository = createTaskRepository(knex);
  const projects: ProjectRepository = createProjectRepository(knex);

  const loadTaskForWrite = async (
    taskId: number,
    executor: Executor,
  ): Promise<{ id: number; archived_at: number | null; project_id: number | null }> => {
    const task = await tasks.findById(taskId, { includeArchived: true }, executor);
    if (!task) throw notFound(`Task ${taskId}`);
    if (task.archived_at !== null) {
      throw validationFailed(
        `Task ${taskId} is archived. Restore it before changing its todos (FR-TASK-13).`,
        { issues: [{ path: 'task_id', message: 'task is archived', code: 'archived' }] },
      );
    }
    if (task.project_id !== null) {
      const project = await projects.findById(task.project_id, { includeArchived: true }, executor);
      if (project && project.archived_at !== null) {
        throw validationFailed(
          `Task ${taskId} belongs to archived project ${project.id}. Restore the project before changing its todos (BR-16).`,
          { issues: [{ path: 'task_id', message: 'project is archived', code: 'archived' }] },
        );
      }
    }
    return task;
  };

  const loadTodoForWrite = async (id: number, executor: Executor): Promise<Todo> => {
    const todo = await repository.findById(id, { includeArchived: true }, executor);
    if (!todo) throw notFound(`Todo ${id}`);
    if (todo.archived_at !== null) {
      throw validationFailed(
        `Todo ${id} is archived. Restore it before editing it (FR-PHASE-05).`,
        { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
      );
    }
    await loadTaskForWrite(todo.task_id, executor);
    return todo;
  };

  return {
    async create(taskId, input) {
      return knex.transaction(async (trx) => {
        await loadTaskForWrite(taskId, trx);

        const at = nowMs();
        const uid = newUid();
        const row = {
          uid,
          task_id: taskId,
          title: input.title,
          note: input.note,
          done: false,
          done_at: null,
          estimate_hours: input.estimate_hours,
          position: (await repository.maxPosition(taskId, trx)) + 1,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: Todo = { id, ...row };

        await activityLog.recordChange(
          { entity: 'todo', entityId: id, action: 'created', before: null, after: loggableFields(created) },
          trx,
        );

        logger.info('todo.service.ts', 'create', 'todo created', { todo_id: id, task_id: taskId });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const todo = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!todo) throw notFound(`Todo ${id}`);
        return todo;
      });
    },

    async listByTask(taskId, options) {
      return knex.transaction(async (trx) => {
        const task = await tasks.findById(taskId, { includeArchived: true }, trx);
        if (!task) throw notFound(`Task ${taskId}`);
        return repository.listByTask(taskId, options, trx);
      });
    },

    async update(id, input) {
      return knex.transaction(async (trx) => {
        const before = await loadTodoForWrite(id, trx);

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.title !== undefined) patch.title = input.title;
        if (input.note !== undefined) patch.note = input.note;
        if (input.estimate_hours !== undefined) patch.estimate_hours = input.estimate_hours;
        if (input.done !== undefined && input.done !== before.done) {
          // `done_at` follows the flag; the client never supplies it. A
          // client-supplied completion date is a backdated fact waiting to
          // happen (`FR-TODO-02`).
          patch.done = input.done;
          patch.done_at = input.done ? patch.updated_at : null;
        }

        const updated = await repository.patch(id, patch, trx);
        // Unreachable by construction (same-transaction load, no deletes) —
        // see the note on the project service's identical guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Todo ${id}`);

        const after: Todo = {
          ...before,
          ...patch,
          done: (patch.done as boolean | undefined) ?? before.done,
        };

        await activityLog.recordChange(
          {
            entity: 'todo',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('todo.service.ts', 'update', 'todo updated', { todo_id: id });
        return after;
      });
    },

    async reorder(taskId, order) {
      return knex.transaction(async (trx) => {
        await loadTaskForWrite(taskId, trx);
        const live = await repository.listByTask(taskId, undefined, trx);
        const liveIds = new Set(live.map((todo) => todo.id));
        const orderedIds = new Set(order);

        const unknown = [...orderedIds].filter((id) => !liveIds.has(id));
        if (unknown.length > 0) {
          throw validationFailed(
            `Cannot reorder: todo(s) ${unknown.join(', ')} are not live todos of task ${taskId} (FR-TODO-01).`,
            { issues: [{ path: 'order', message: 'names a todo outside this task', code: 'invalid' }] },
          );
        }
        const missing = live.map((todo) => todo.id).filter((id) => !orderedIds.has(id));
        if (missing.length > 0) {
          throw validationFailed(
            `Cannot reorder: todo(s) ${missing.join(', ')} of task ${taskId} are missing from the order (FR-TODO-01).`,
            { issues: [{ path: 'order', message: 'must name every live todo', code: 'invalid' }] },
          );
        }

        const at = nowMs();
        for (const [position, id] of order.entries()) {
          const applied = await repository.patch(id, { position, updated_at: at }, trx);
          // Same unreachable-by-construction guard: every id was just verified live.
          /* v8 ignore next */
          if (!applied) throw notFound(`Todo ${id}`);
        }

        logger.info('todo.service.ts', 'reorder', 'todos reordered', {
          task_id: taskId,
          count: order.length,
        });
        return repository.listByTask(taskId, undefined, trx);
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadTodoForWrite(id, trx);

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Todo ${id}`);

        const after: Todo = { ...before, archived_at: at, updated_at: at };

        await activityLog.recordChange(
          { entity: 'todo', entityId: id, action: 'archived', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('todo.service.ts', 'archive', 'todo archived', { todo_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const todo = await repository.findById(id, { includeArchived: true }, trx);
        if (!todo) throw notFound(`Todo ${id}`);
        if (todo.archived_at === null) {
          throw validationFailed(`Todo ${id} is not archived (FR-PHASE-05).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }
        await loadTaskForWrite(todo.task_id, trx);

        // Appended at the end, not put back where it was: positions added while
        // it was archived may already occupy the old slot, and two live todos
        // sharing a position is an order that reads differently every time.
        const at = nowMs();
        const position = (await repository.maxPosition(todo.task_id, trx)) + 1;
        const updated = await repository.patch(
          id,
          { archived_at: null, position, updated_at: at },
          trx,
        );
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Todo ${id}`);

        const after: Todo = { ...todo, archived_at: null, position, updated_at: at };

        await activityLog.recordChange(
          { entity: 'todo', entityId: id, action: 'restored', before: loggableFields(todo), after: loggableFields(after) },
          trx,
        );

        logger.info('todo.service.ts', 'restore', 'todo restored', { todo_id: id });
        return after;
      });
    },
  };
}
