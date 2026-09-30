import {
  nowMs,
  newUid,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createProjectRepository,
  type ProjectRepository,
  type Executor,
} from '../repositories/project.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Projects (`FR-PRJ-01`…`FR-PRJ-04`, `BR-16`, `DATA-11`, criteria 3 and 8).
 *
 * **There is no delete method and no delete route.** `FR-PRJ-04` is that a
 * project must never be deleted, and the three layers that could each have let
 * one through are all closed: this service has no such method, the route table
 * throws on `DELETE` (criterion 7), and the database has a `BEFORE DELETE`
 * trigger (`DATA-10`). Archive is a `PATCH`, and archive is reversible — which is
 * the whole point of it, since an archive that cannot be undone is a delete with
 * extra steps and a nicer name.
 *
 * **Every write runs in one transaction with its activity-log entry** (`FR-STAT-05`).
 * A project renamed without that history row is a rename nobody can find out
 * about, and a history row committed for a rename that then failed records
 * something that did not happen. The two are not separable without a bug, so
 * they are not written separately.
 */
export interface ProjectService {
  create(input: CreateProjectInput): Promise<Project>;
  /** A live project. An archived one is 404 unless `includeArchived` is set. */
  get(id: number, options?: { includeArchived?: boolean }): Promise<Project>;
  list(options?: { includeArchived?: boolean }): Promise<Project[]>;
  update(id: number, input: UpdateProjectInput): Promise<Project>;
  archive(id: number): Promise<Project>;
  restore(id: number): Promise<Project>;
}

/**
 * The fields whose change is worth a history line.
 *
 * `id` and `uid` are excluded because neither is editable, and `created_at` is
 * excluded because it is a fact about the row rather than a decision about it.
 * `archived_at` **is** included: archiving and restoring are the two events a
 * project history exists mostly to show.
 */
function loggableFields(project: Project): Record<string, unknown> {
  return {
    name: project.name,
    description: project.description,
    colour: project.colour,
    archived_at: project.archived_at,
  };
}

export function createProjectService(
  knex: Knex,
  activityLog: ActivityLogService,
): ProjectService {
  const repository: ProjectRepository = createProjectRepository(knex);

  /**
   * Load a project that a write is about to happen to.
   *
   * Archived rows are **in scope here** even though they are hidden from reads,
   * because restore is precisely the operation that acts on one. A restore that
   * could not see its own target would be unwriteable.
   */
  const loadForWrite = async (id: number, executor: Executor): Promise<Project> => {
    const project = await repository.findById(id, { includeArchived: true }, executor);
    if (!project) throw notFound(`Project ${id}`);
    return project;
  };

  return {
    async create(input) {
      return knex.transaction(async (trx) => {
        const at = nowMs();
        const uid = newUid();
        const row = {
          uid,
          name: input.name,
          description: input.description,
          colour: input.colour,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: Project = { id, ...row };

        await activityLog.recordChange(
          {
            entity: 'project',
            entityId: id,
            action: 'created',
            before: null,
            after: loggableFields(created),
          },
          trx,
        );

        logger.info('project.service.ts', 'create', 'project created', { project_id: id, uid });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const project = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!project) throw notFound(`Project ${id}`);
        return project;
      });
    },

    async list(options) {
      return knex.transaction(async (trx) => repository.list(options, trx));
    },

    async update(id, input) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        // **An archived project is not editable; restore it first.**
        //
        // This is a judgement call, and it is made here rather than left to the
        // interface, because an interface that hides the Edit button for an
        // archived project is a convention and a service that accepts the write
        // is a fact. Fail closed: a project the owner thinks they archived stays
        // exactly as they left it.
        if (before.archived_at !== null) {
          throw validationFailed(
            `Project ${id} is archived. Restore it before editing it (FR-PRJ-03).`,
            { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
          );
        }

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.colour !== undefined) patch.colour = input.colour;

        const updated = await repository.patch(id, patch, trx);
        if (!updated) throw notFound(`Project ${id}`);

        const after: Project = { ...before, ...patch } as Project;

        await activityLog.recordChange(
          {
            entity: 'project',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('project.service.ts', 'update', 'project updated', { project_id: id });
        return after;
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        // Archiving twice is refused rather than treated as a no-op, so a
        // double click does not move `archived_at` forward and make the history
        // say the project was archived at a time it was not.
        if (before.archived_at !== null) {
          throw validationFailed(`Project ${id} is already archived (FR-PRJ-04).`, {
            issues: [{ path: 'archived_at', message: 'already archived', code: 'already_archived' }],
          });
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        if (!updated) throw notFound(`Project ${id}`);

        const after: Project = { ...before, archived_at: at, updated_at: at };

        // FR-PRJ-04 and BR-16 also say the project's **tasks** are hidden while
        // it is archived. That half is not this service's to do: it is a filter
        // on the task list, and it is proven in `task.service.ts`. Recording it
        // here so the requirement is not silently half-implemented.
        await activityLog.recordChange(
          {
            entity: 'project',
            entityId: id,
            action: 'archived',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('project.service.ts', 'archive', 'project archived', { project_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at === null) {
          throw validationFailed(`Project ${id} is not archived (FR-PRJ-03).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: null, updated_at: at }, trx);
        if (!updated) throw notFound(`Project ${id}`);

        const after: Project = { ...before, archived_at: null, updated_at: at };

        await activityLog.recordChange(
          {
            entity: 'project',
            entityId: id,
            action: 'restored',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('project.service.ts', 'restore', 'project restored', { project_id: id });
        return after;
      });
    },
  };
}
