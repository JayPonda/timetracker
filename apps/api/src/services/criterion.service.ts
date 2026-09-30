import {
  nowMs,
  newUid,
  type CreateCriterionInput,
  type Criterion,
  type UpdateCriterionInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createCriterionRepository,
  type CriterionRepository,
  type Executor,
} from '../repositories/criterion.repository.js';
import { createTaskRepository, type TaskRepository } from '../repositories/task.repository.js';
import { createProjectRepository, type ProjectRepository } from '../repositories/project.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Acceptance criteria (`FR-AC-01`, `FR-AC-02`, `FR-STAT-05`).
 *
 * **No delete method, and no met/not-met here.** This slice records what “done”
 * means; whether it was met is decided at closure in 0.5.0, which snapshots the
 * text into `closure_criterion_results` precisely so that editing a criterion
 * later cannot rewrite what “done” meant. Archiving removes a criterion from
 * later closures without touching past records (`FR-AC-01`).
 *
 * Position is ordering, not content — reorder writes no history row, as with
 * todos. Writes are refused on an archived task and on a task hidden by an
 * archived project (`BR-16`).
 */
export interface CriterionService {
  create(taskId: number, input: CreateCriterionInput): Promise<Criterion>;
  get(id: number, options?: { includeArchived?: boolean }): Promise<Criterion>;
  listByTask(taskId: number, options?: { includeArchived?: boolean }): Promise<Criterion[]>;
  update(id: number, input: UpdateCriterionInput): Promise<Criterion>;
  reorder(taskId: number, order: readonly number[]): Promise<Criterion[]>;
  archive(id: number): Promise<Criterion>;
  restore(id: number): Promise<Criterion>;
}

function loggableFields(criterion: Criterion): Record<string, unknown> {
  return { text: criterion.text, archived_at: criterion.archived_at };
}

export function createCriterionService(knex: Knex, activityLog: ActivityLogService): CriterionService {
  const repository: CriterionRepository = createCriterionRepository(knex);
  const tasks: TaskRepository = createTaskRepository(knex);
  const projects: ProjectRepository = createProjectRepository(knex);

  const loadTaskForWrite = async (taskId: number, executor: Executor): Promise<void> => {
    const task = await tasks.findById(taskId, { includeArchived: true }, executor);
    if (!task) throw notFound(`Task ${taskId}`);
    if (task.archived_at !== null) {
      throw validationFailed(
        `Task ${taskId} is archived. Restore it before changing its criteria (FR-TASK-13).`,
        { issues: [{ path: 'task_id', message: 'task is archived', code: 'archived' }] },
      );
    }
    if (task.project_id !== null) {
      const project = await projects.findById(task.project_id, { includeArchived: true }, executor);
      if (project && project.archived_at !== null) {
        throw validationFailed(
          `Task ${taskId} belongs to archived project ${project.id}. Restore the project before changing its criteria (BR-16).`,
          { issues: [{ path: 'task_id', message: 'project is archived', code: 'archived' }] },
        );
      }
    }
  };

  const loadCriterionForWrite = async (id: number, executor: Executor): Promise<Criterion> => {
    const criterion = await repository.findById(id, { includeArchived: true }, executor);
    if (!criterion) throw notFound(`Acceptance criterion ${id}`);
    if (criterion.archived_at !== null) {
      throw validationFailed(
        `Acceptance criterion ${id} is archived. Restore it before editing it (FR-AC-01).`,
        { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
      );
    }
    await loadTaskForWrite(criterion.task_id, executor);
    return criterion;
  };

  return {
    async create(taskId, input) {
      return knex.transaction(async (trx) => {
        await loadTaskForWrite(taskId, trx);

        const at = nowMs();
        const row = {
          uid: newUid(),
          task_id: taskId,
          text: input.text,
          position: (await repository.maxPosition(taskId, trx)) + 1,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: Criterion = { id, ...row };

        await activityLog.recordChange(
          { entity: 'acceptance_criterion', entityId: id, action: 'created', before: null, after: loggableFields(created) },
          trx,
        );

        logger.info('criterion.service.ts', 'create', 'criterion created', {
          criterion_id: id,
          task_id: taskId,
        });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const criterion = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!criterion) throw notFound(`Acceptance criterion ${id}`);
        return criterion;
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
        const before = await loadCriterionForWrite(id, trx);

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.text !== undefined) patch.text = input.text;

        const updated = await repository.patch(id, patch, trx);
        // Unreachable by construction (same-transaction load, no deletes).
        /* v8 ignore next */
        if (!updated) throw notFound(`Acceptance criterion ${id}`);

        const after: Criterion = { ...before, ...patch } as Criterion;

        await activityLog.recordChange(
          {
            entity: 'acceptance_criterion',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('criterion.service.ts', 'update', 'criterion updated', { criterion_id: id });
        return after;
      });
    },

    async reorder(taskId, order) {
      return knex.transaction(async (trx) => {
        await loadTaskForWrite(taskId, trx);
        const live = await repository.listByTask(taskId, undefined, trx);
        const liveIds = new Set(live.map((criterion) => criterion.id));
        const orderedIds = new Set(order);

        const unknown = [...orderedIds].filter((id) => !liveIds.has(id));
        if (unknown.length > 0) {
          throw validationFailed(
            `Cannot reorder: criteria ${unknown.join(', ')} are not live criteria of task ${taskId} (FR-AC-01).`,
            { issues: [{ path: 'order', message: 'names a criterion outside this task', code: 'invalid' }] },
          );
        }
        const missing = live.map((criterion) => criterion.id).filter((id) => !orderedIds.has(id));
        if (missing.length > 0) {
          throw validationFailed(
            `Cannot reorder: criteria ${missing.join(', ')} of task ${taskId} are missing from the order (FR-AC-01).`,
            { issues: [{ path: 'order', message: 'must name every live criterion', code: 'invalid' }] },
          );
        }

        const at = nowMs();
        for (const [position, id] of order.entries()) {
          const applied = await repository.patch(id, { position, updated_at: at }, trx);
          // Same unreachable-by-construction guard: every id was just verified live.
          /* v8 ignore next */
          if (!applied) throw notFound(`Acceptance criterion ${id}`);
        }

        logger.info('criterion.service.ts', 'reorder', 'criteria reordered', {
          task_id: taskId,
          count: order.length,
        });
        return repository.listByTask(taskId, undefined, trx);
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadCriterionForWrite(id, trx);

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Acceptance criterion ${id}`);

        const after: Criterion = { ...before, archived_at: at, updated_at: at };

        await activityLog.recordChange(
          { entity: 'acceptance_criterion', entityId: id, action: 'archived', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('criterion.service.ts', 'archive', 'criterion archived', { criterion_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const criterion = await repository.findById(id, { includeArchived: true }, trx);
        if (!criterion) throw notFound(`Acceptance criterion ${id}`);
        if (criterion.archived_at === null) {
          throw validationFailed(`Acceptance criterion ${id} is not archived (FR-AC-01).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }
        await loadTaskForWrite(criterion.task_id, trx);

        // Appended at the end, as with todos: positions added while archived
        // may already occupy the old slot.
        const at = nowMs();
        const position = (await repository.maxPosition(criterion.task_id, trx)) + 1;
        const updated = await repository.patch(
          id,
          { archived_at: null, position, updated_at: at },
          trx,
        );
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Acceptance criterion ${id}`);

        const after: Criterion = { ...criterion, archived_at: null, position, updated_at: at };

        await activityLog.recordChange(
          { entity: 'acceptance_criterion', entityId: id, action: 'restored', before: loggableFields(criterion), after: loggableFields(after) },
          trx,
        );

        logger.info('criterion.service.ts', 'restore', 'criterion restored', { criterion_id: id });
        return after;
      });
    },
  };
}
