import {
  nowMs,
  newUid,
  type CreateTaskLinkInput,
  type TaskLink,
  type UpdateTaskLinkInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createTaskLinkRepository,
  type Executor,
  type TaskLinkRepository,
} from '../repositories/task-link.repository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/task.repository.js';
import { createProjectRepository, type ProjectRepository } from '../repositories/project.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Task links (`FR-TASK-03`, `DATA-01`, `BR-04`, criterion 1).
 *
 * **No delete method.** A link is archived; archiving frees its slot, and the
 * 4th link is refused with a message naming the limit — first here, and then
 * by the trigger for any writer that never calls this service.
 *
 * **Positions are slots the service assigns, never the client.** A new link
 * takes the smallest free slot in 1–3; a restored link takes its old slot when
 * free, the smallest free slot otherwise. Positions are how the trigger counts
 * to three, and a client-chosen position is two writers agreeing on slot 2.
 *
 * Writes are refused on an archived task, and on a task hidden by an archived
 * project — the same rule as todos, for the same reason (`BR-16`): a hidden
 * task stays exactly as it is.
 */
export interface TaskLinkService {
  create(taskId: number, input: CreateTaskLinkInput): Promise<TaskLink>;
  get(id: number, options?: { includeArchived?: boolean }): Promise<TaskLink>;
  listByTask(taskId: number, options?: { includeArchived?: boolean }): Promise<TaskLink[]>;
  update(id: number, input: UpdateTaskLinkInput): Promise<TaskLink>;
  archive(id: number): Promise<TaskLink>;
  restore(id: number): Promise<TaskLink>;
}

/** The three slots. A fourth name here would be a lie the trigger exposes. */
const SLOTS = [1, 2, 3] as const;

function loggableFields(link: TaskLink): Record<string, unknown> {
  return { label: link.label, url: link.url, archived_at: link.archived_at };
}

export function createTaskLinkService(knex: Knex, activityLog: ActivityLogService): TaskLinkService {
  const repository: TaskLinkRepository = createTaskLinkRepository(knex);
  const tasks: TaskRepository = createTaskRepository(knex);
  const projects: ProjectRepository = createProjectRepository(knex);

  const loadTaskForWrite = async (taskId: number, executor: Executor): Promise<void> => {
    const task = await tasks.findById(taskId, { includeArchived: true }, executor);
    if (!task) throw notFound(`Task ${taskId}`);
    if (task.archived_at !== null) {
      throw validationFailed(
        `Task ${taskId} is archived. Restore it before changing its links (FR-TASK-13).`,
        { issues: [{ path: 'task_id', message: 'task is archived', code: 'archived' }] },
      );
    }
    if (task.project_id !== null) {
      const project = await projects.findById(task.project_id, { includeArchived: true }, executor);
      if (project && project.archived_at !== null) {
        throw validationFailed(
          `Task ${taskId} belongs to archived project ${project.id}. Restore the project before changing its links (BR-16).`,
          { issues: [{ path: 'task_id', message: 'project is archived', code: 'archived' }] },
        );
      }
    }
  };

  const loadLinkForWrite = async (id: number, executor: Executor): Promise<TaskLink> => {
    const link = await repository.findById(id, { includeArchived: true }, executor);
    if (!link) throw notFound(`Task link ${id}`);
    if (link.archived_at !== null) {
      throw validationFailed(
        `Task link ${id} is archived. Restore it before editing it (FR-TASK-03).`,
        { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
      );
    }
    await loadTaskForWrite(link.task_id, executor);
    return link;
  };

  /** Smallest free slot, or `null` when all three are taken. */
  const freeSlot = async (taskId: number, executor: Executor): Promise<number | null> => {
    const taken = new Set(await repository.livePositions(taskId, executor));
    return SLOTS.find((slot) => !taken.has(slot)) ?? null;
  };

  return {
    async create(taskId, input) {
      return knex.transaction(async (trx) => {
        await loadTaskForWrite(taskId, trx);

        // Refused here with a message, and then by the trigger for anyone who
        // never calls this service. The message names the limit because “a
        // task may have at most 3 links” tells the owner what to do next —
        // archive one — and a bare constraint failure does not.
        const position = await freeSlot(taskId, trx);
        if (position === null) {
          throw validationFailed(
            `Task ${taskId} already has 3 links. Archive one before adding another (FR-TASK-03, BR-04).`,
            { issues: [{ path: 'url', message: 'at most 3 links per task', code: 'limit' }] },
          );
        }

        const at = nowMs();
        const uid = newUid();
        const row = {
          uid,
          task_id: taskId,
          label: input.label,
          url: input.url,
          position,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: TaskLink = { id, ...row };

        await activityLog.recordChange(
          { entity: 'task_link', entityId: id, action: 'created', before: null, after: loggableFields(created) },
          trx,
        );

        logger.info('task-link.service.ts', 'create', 'task link created', {
          link_id: id,
          task_id: taskId,
        });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const link = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!link) throw notFound(`Task link ${id}`);
        return link;
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
        const before = await loadLinkForWrite(id, trx);

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.label !== undefined) patch.label = input.label;
        if (input.url !== undefined) patch.url = input.url;

        const updated = await repository.patch(id, patch, trx);
        // Unreachable by construction (same-transaction load, no deletes).
        /* v8 ignore next */
        if (!updated) throw notFound(`Task link ${id}`);

        const after: TaskLink = { ...before, ...patch } as TaskLink;

        await activityLog.recordChange(
          {
            entity: 'task_link',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('task-link.service.ts', 'update', 'task link updated', { link_id: id });
        return after;
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadLinkForWrite(id, trx);

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Task link ${id}`);

        const after: TaskLink = { ...before, archived_at: at, updated_at: at };

        await activityLog.recordChange(
          { entity: 'task_link', entityId: id, action: 'archived', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('task-link.service.ts', 'archive', 'task link archived', { link_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const link = await repository.findById(id, { includeArchived: true }, trx);
        if (!link) throw notFound(`Task link ${id}`);
        if (link.archived_at === null) {
          throw validationFailed(`Task link ${id} is not archived (FR-TASK-03).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }
        await loadTaskForWrite(link.task_id, trx);

        // Its old slot when free, the smallest free slot otherwise — and a
        // refusal naming the limit when all three are taken, because restoring
        // past the trigger would fail with a constraint error instead.
        const taken = new Set(await repository.livePositions(link.task_id, trx));
        const position = !taken.has(link.position)
          ? link.position
          : SLOTS.find((slot) => !taken.has(slot)) ?? null;
        if (position === null) {
          throw validationFailed(
            `Task ${link.task_id} already has 3 links. Archive one before restoring this one (FR-TASK-03, BR-04).`,
            { issues: [{ path: 'archived_at', message: 'no free slot', code: 'limit' }] },
          );
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: null, position, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Task link ${id}`);

        const after: TaskLink = { ...link, archived_at: null, position, updated_at: at };

        await activityLog.recordChange(
          { entity: 'task_link', entityId: id, action: 'restored', before: loggableFields(link), after: loggableFields(after) },
          trx,
        );

        logger.info('task-link.service.ts', 'restore', 'task link restored', { link_id: id });
        return after;
      });
    },
  };
}
