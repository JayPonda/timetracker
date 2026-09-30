import {
  nowMs,
  newUid,
  type CreateTagInput,
  type Tag,
  type UpdateTagInput,
} from '@pdm/shared';
import type { Knex } from 'knex';
import { logger } from '../lib/logger.js';
import { notFound, validationFailed } from '../lib/errors.js';
import {
  createTagRepository,
  type Executor,
  type TagRepository,
} from '../repositories/tag.repository.js';
import type { ActivityLogService } from './activity-log.service.js';

/**
 * Tags (`FR-TAG-01`, `FR-TAG-05`, `FR-STAT-05`).
 *
 * **No delete method.** `FR-TAG-05` is that a tag is never deleted: archiving
 * hides it from pickers while it stays on its entries, so per-tag totals do
 * not change. Entries arrive in 0.3.0; until then the second half of that
 * sentence is structural — nothing here can touch entries, because no
 * statement in this file names them.
 *
 * **Names are unique among live tags, and clashes fail with the name in the
 * message.** The partial unique index would refuse with a constraint error;
 * the service refuses first with one that tells the owner what to do — use the
 * live tag, or restore the archived one. Every write runs in one transaction
 * with its history entry.
 */
export interface TagService {
  create(input: CreateTagInput): Promise<Tag>;
  get(id: number, options?: { includeArchived?: boolean }): Promise<Tag>;
  list(options?: { includeArchived?: boolean }): Promise<Tag[]>;
  update(id: number, input: UpdateTagInput): Promise<Tag>;
  archive(id: number): Promise<Tag>;
  restore(id: number): Promise<Tag>;
}

function loggableFields(tag: Tag): Record<string, unknown> {
  return { name: tag.name, colour: tag.colour, archived_at: tag.archived_at };
}

function clash(name: string): never {
  throw validationFailed(
    `A live tag named “${name}” already exists. Use it, or archive it first and try again (FR-TAG-01).`,
    { issues: [{ path: 'name', message: 'name is taken by a live tag', code: 'taken' }] },
  );
}

export function createTagService(knex: Knex, activityLog: ActivityLogService): TagService {
  const repository: TagRepository = createTagRepository(knex);

  const loadForWrite = async (id: number, executor: Executor): Promise<Tag> => {
    const tag = await repository.findById(id, { includeArchived: true }, executor);
    if (!tag) throw notFound(`Tag ${id}`);
    return tag;
  };

  return {
    async create(input) {
      return knex.transaction(async (trx) => {
        if (await repository.findLiveByName(input.name, trx)) {
          clash(input.name);
        }

        const at = nowMs();
        const uid = newUid();
        const row = {
          uid,
          name: input.name,
          colour: input.colour,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };

        const id = await repository.insert(row, trx);
        const created: Tag = { id, ...row };

        await activityLog.recordChange(
          { entity: 'tag', entityId: id, action: 'created', before: null, after: loggableFields(created) },
          trx,
        );

        logger.info('tag.service.ts', 'create', 'tag created', { tag_id: id, uid });
        return created;
      });
    },

    async get(id, options) {
      return knex.transaction(async (trx) => {
        const tag = await repository.findById(id, { includeArchived: options?.includeArchived }, trx);
        if (!tag) throw notFound(`Tag ${id}`);
        return tag;
      });
    },

    async list(options) {
      return knex.transaction(async (trx) => repository.list(options, trx));
    },

    async update(id, input) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at !== null) {
          throw validationFailed(
            `Tag ${id} is archived. Restore it before editing it (FR-TAG-05).`,
            { issues: [{ path: 'archived_at', message: 'restore before editing', code: 'archived' }] },
          );
        }

        if (input.name !== undefined && input.name !== before.name) {
          const holder = await repository.findLiveByName(input.name, trx);
          if (holder && holder.id !== id) {
            clash(input.name);
          }
        }

        const patch: Record<string, unknown> = { updated_at: nowMs() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.colour !== undefined) patch.colour = input.colour;

        const updated = await repository.patch(id, patch, trx);
        // Unreachable by construction (same-transaction load, no deletes).
        /* v8 ignore next */
        if (!updated) throw notFound(`Tag ${id}`);

        const after: Tag = { ...before, ...patch } as Tag;

        await activityLog.recordChange(
          {
            entity: 'tag',
            entityId: id,
            action: 'updated',
            before: loggableFields(before),
            after: loggableFields(after),
          },
          trx,
        );

        logger.info('tag.service.ts', 'update', 'tag updated', { tag_id: id });
        return after;
      });
    },

    async archive(id) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at !== null) {
          throw validationFailed(`Tag ${id} is already archived (FR-TAG-05).`, {
            issues: [{ path: 'archived_at', message: 'already archived', code: 'already_archived' }],
          });
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: at, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Tag ${id}`);

        const after: Tag = { ...before, archived_at: at, updated_at: at };

        // The tag stays on its entries: nothing here touches `time_entry_tags`,
        // so per-tag totals cannot move with the archive (`FR-TAG-05`).
        await activityLog.recordChange(
          { entity: 'tag', entityId: id, action: 'archived', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('tag.service.ts', 'archive', 'tag archived', { tag_id: id });
        return after;
      });
    },

    async restore(id) {
      return knex.transaction(async (trx) => {
        const before = await loadForWrite(id, trx);

        if (before.archived_at === null) {
          throw validationFailed(`Tag ${id} is not archived (FR-TAG-05).`, {
            issues: [{ path: 'archived_at', message: 'not archived', code: 'not_archived' }],
          });
        }

        // A new live tag may have taken the name while this one was archived.
        // Restoring past it would fail on the unique index with a constraint
        // error, so the service refuses first with the name in the message.
        const holder = await repository.findLiveByName(before.name, trx);
        if (holder && holder.id !== id) {
          clash(before.name);
        }

        const at = nowMs();
        const updated = await repository.patch(id, { archived_at: null, updated_at: at }, trx);
        // Same unreachable-by-construction guard.
        /* v8 ignore next */
        if (!updated) throw notFound(`Tag ${id}`);

        const after: Tag = { ...before, archived_at: null, updated_at: at };

        await activityLog.recordChange(
          { entity: 'tag', entityId: id, action: 'restored', before: loggableFields(before), after: loggableFields(after) },
          trx,
        );

        logger.info('tag.service.ts', 'restore', 'tag restored', { tag_id: id });
        return after;
      });
    },
  };
}
