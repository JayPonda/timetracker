import { z } from 'zod';
import {
  CAPABILITIES,
  createCriterionSchema,
  listCriteriaQuerySchema,
  reorderCriteriaSchema,
  updateCriterionSchema,
} from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Acceptance-criteria routes (`FR-AC-01`, `MCP-14`).
 *
 * Declared, guarded and audited like every other route. Adding a criterion is
 * `task:create`, which the assistant holds; changing, reordering, archiving or
 * restoring one is `task:update`, which it never holds.
 *
 * Handlers do HTTP plumbing only (ground rule 1).
 */

function parseId(raw: unknown, what: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationFailed(`A ${what} id must be a positive whole number.`, {
      issues: [{ path: 'id', message: 'must be a positive whole number', code: 'invalid' }],
    });
  }
  return id;
}

function parseOrThrow<Output, Input>(
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
  value: unknown,
): Output {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = validationDetails(result.error);
  throw validationFailed(validationMessage(details), details);
}

export function criterionRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/tasks/:id/criteria',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'List a task’s acceptance criteria in definition order (FR-AC-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const query = parseOrThrow(listCriteriaQuerySchema, req.query ?? {});
        const criteria = await req.server.services.criteria.listByTask(taskId, {
          includeArchived: query.include_archived,
        });
        return reply.status(200).send({ criteria });
      },
    },
    {
      method: 'POST',
      url: '/tasks/:id/criteria',
      capabilities: [CAPABILITIES.TASK_CREATE],
      description: 'Add an acceptance criterion to a task (FR-AC-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const input = parseOrThrow(createCriterionSchema, req.body ?? {});
        const criterion = await req.server.services.criteria.create(taskId, input);
        logger.debug('criteria.ts', 'POST /tasks/:id/criteria', 'created', {
          criterion_id: criterion.id,
          task_id: taskId,
        });
        return reply.status(201).send({ criterion });
      },
    },
    {
      method: 'PATCH',
      url: '/tasks/:id/criteria/reorder',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Reorder a task’s criteria with the complete order (FR-AC-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const input = parseOrThrow(reorderCriteriaSchema, req.body ?? {});
        const criteria = await req.server.services.criteria.reorder(taskId, input.order);
        return reply.status(200).send({ criteria });
      },
    },
    {
      method: 'GET',
      url: '/criteria/:id',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'Read one acceptance criterion',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'criterion');
        const criterion = await req.server.services.criteria.get(id);
        return reply.status(200).send({ criterion });
      },
    },
    {
      method: 'PATCH',
      url: '/criteria/:id',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Edit an acceptance criterion’s statement (FR-AC-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'criterion');
        const input = parseOrThrow(updateCriterionSchema, req.body ?? {});
        const criterion = await req.server.services.criteria.update(id, input);
        return reply.status(200).send({ criterion });
      },
    },
    {
      method: 'PATCH',
      url: '/criteria/:id/archive',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Archive a criterion; past closure records keep it (FR-AC-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'criterion');
        const criterion = await req.server.services.criteria.archive(id);
        return reply.status(200).send({ criterion });
      },
    },
    {
      method: 'PATCH',
      url: '/criteria/:id/restore',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Restore an archived criterion (FR-AC-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'criterion');
        const criterion = await req.server.services.criteria.restore(id);
        return reply.status(200).send({ criterion });
      },
    },
  ];
}
