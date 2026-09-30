import {
  nowMs,
  newUid,
  type CreateReferenceInput,
  type Reference,
  type UpdateReferenceInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createReferenceRepository,
  type Executor,
  type ReferenceRepository,
} from '../repositories/reference.repository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/task.repository.js';
import { createProjectRepository, type ProjectRepository } from '../repositories/project.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Reference materials (`FR-REF-01`, `FR-REF-02`, `FR-REF-05`, `FR-STAT-05`).
 *
 * **No delete method.** A reference is archived; it stays readable after its
 * task ends or is archived, because nothing here checks the task's state on
 * read and nothing cascades on write (`FR-REF-05`).
 *
 * Writes are refused on an archived task, and on a task hidden by an archived
 * project — the same rule as every other task child, for the same reason
 * (`BR-16`).
 */
export interface ReferenceService {
  create(taskId: number, input: CreateReferenceInput): Promise<Reference>;
  get(id: number, options?: { includeArchived?: boolean }): Promise<Reference>;
  listByTask(taskId: number, options?: { includeArchived?: boolean }): Promise<Reference[]>;
  update(id: number, input: UpdateReferenceInput): Promise<Reference>;
  archive(id: number): Promise<Reference>;
  restore(id: number): Promise<Reference>;
}

function loggableFields(reference: Reference): Record<string, unknown> {
  return {
    title: reference.title,
    body: reference.body,
    url: reference.url,
    type: reference.type,
    archived_at: reference.archived_at,
  };
}

export function createReferenceService(knex: Knex, activityLog: ActivityLogService): ReferenceService {
  const repository: ReferenceRepository = createReferenceRepository(knex);
  const tasks: TaskRepository = createTaskRepository(knex);
  const projects: ProjectRepository = createProjectRepository(knex);

  const loadTaskForWrite = async (taskId: number, executor: Executor): Promise<void> => {
    const task = await tasks.findById(taskId, { includeArchived: true }, executor);
    if (!task) throw notFound(`Task ${taskId}`);
    if (task.archived_at !== null) {
      throw validationFailed(
        `Task ${taskId} is archived. Restore it before changing its references (FR-TASK-13).`,
        { issues: [{ path: 'task_id', message: 'task is archived', code: 'archived' }] },
      );
    }
    if (task.project_id !== null) {
      const project = await projects.findById(task.project_id, { includeArchived: true }, executor);
      if (project && project.archived_at !== null) {
        throw validationFailed(
          `Task ${taskId} belongs to archived project ${project.id}. Restore the project before changing its references (BR-16).`,
          { issues: [{ path: 'task_id', message: 'project is archived', code: 'archived' }] },
        );
      }
    }
  };

  const loadReferenceForWrite = async (id: number, executor: Executor): Promise<Reference> => {
    const reference = await repository.findById(id, { includeArchived: true }, executor);
    if (!reference) throw notFound(`Reference ${id}`);
    if (reference.archived_at !== null) {
      throw validationFailed(
        `Reference ${id} is archived. Restore it before editing it (FR-REF-01).`,
        { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
      );
    }
    if (reference.task_id !== null) {
      await loadTaskForWrite(reference.task_id, executor);
    }
    return reference;
  };

  return {
    async create(taskId, input) {
      return knex.transaction(async (trx) => {
        await loadTaskForWrite(taskId, trx);

        const at = nowMs();
        const row = {
          uid: newUid(),
          task_id: taskId,
          title: input.title,
          body: input.body,
          url: input.url,
          type: input.type,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: Reference = { id, ...row };

        await activityLog.recordChange(
          { entity: 'reference_material', entityId: id, action: 'created', before: null, after: loggableFields(created) },
          trx,
        );

        logger.info('reference.service.ts', 'create', 'reference created', {
          reference_id: id,
          task_id: taskId,
        });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const reference = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!reference) throw notFound(`Reference ${id}`);
        return reference;
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
        const before = await loadReferenceForWrite(id, trx);

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.title !== undefined) patch.title = input.title;
        if (input.body !== undefined) patch.body = input.body;
        if (input.url !== undefined) patch.url = input.url;
        if (input.type !== undefined) patch.type = input.type;

        const updated = await repository.patch(id, patch, trx);
        // Unreachable by construction (same-transaction load, no deletes).
        /* v8 ignore next */
        if (!updated) throw notFound(`Reference ${id}`);

        const after: Reference = { ...before, ...patch } as Reference;

        await activityLog.recordChange(
          {
            entity: 'reference_material',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('reference.service.ts', 'update', 'reference updated', { reference_id: id });
        return after;
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadReferenceForWrite(id, trx);

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Reference ${id}`);

        const after: Reference = { ...before, archived_at: at, updated_at: at };

        await activityLog.recordChange(
          { entity: 'reference_material', entityId: id, action: 'archived', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('reference.service.ts', 'archive', 'reference archived', { reference_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const reference = await repository.findById(id, { includeArchived: true }, trx);
        if (!reference) throw notFound(`Reference ${id}`);
        if (reference.archived_at === null) {
          throw validationFailed(`Reference ${id} is not archived (FR-REF-01).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }
        if (reference.task_id !== null) {
          await loadTaskForWrite(reference.task_id, trx);
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: null, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Reference ${id}`);

        const after: Reference = { ...reference, archived_at: null, updated_at: at };

        await activityLog.recordChange(
          { entity: 'reference_material', entityId: id, action: 'restored', before: loggableFields(reference), after: loggableFields(after) },
          trx,
        );

        logger.info('reference.service.ts', 'restore', 'reference restored', { reference_id: id });
        return after;
      });
    },
  };
}
