import { z } from 'zod';
import {
  CAPABILITIES,
  createReferenceSchema,
  listReferencesQuerySchema,
  updateReferenceSchema,
} from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Reference-material routes (`FR-REF-01`, `FR-REF-02`, `MCP-14`).
 *
 * Declared, guarded and audited like every other route. Adding a reference is
 * `task:create`, which the assistant holds; changing, archiving or restoring
 * one is `task:update`, which it never holds.
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

export function referenceRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/tasks/:id/references',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'List a task’s reference materials, newest first (FR-REF-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const query = parseOrThrow(listReferencesQuerySchema, req.query ?? {});
        const references = await req.server.services.references.listByTask(taskId, {
          includeArchived: query.include_archived,
        });
        return reply.status(200).send({ references });
      },
    },
    {
      method: 'POST',
      url: '/tasks/:id/references',
      capabilities: [CAPABILITIES.TASK_CREATE],
      description: 'Add a reference material to a task (FR-REF-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const input = parseOrThrow(createReferenceSchema, req.body ?? {});
        const reference = await req.server.services.references.create(taskId, input);
        logger.debug('references.ts', 'POST /tasks/:id/references', 'created', {
          reference_id: reference.id,
          task_id: taskId,
        });
        return reply.status(201).send({ reference });
      },
    },
    {
      method: 'GET',
      url: '/references/:id',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'Read one reference material',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'reference');
        const reference = await req.server.services.references.get(id);
        return reply.status(200).send({ reference });
      },
    },
    {
      method: 'PATCH',
      url: '/references/:id',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Edit a reference material (FR-REF-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'reference');
        const input = parseOrThrow(updateReferenceSchema, req.body ?? {});
        const reference = await req.server.services.references.update(id, input);
        return reply.status(200).send({ reference });
      },
    },
    {
      method: 'PATCH',
      url: '/references/:id/archive',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Archive a reference material (FR-REF-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'reference');
        const reference = await req.server.services.references.archive(id);
        return reply.status(200).send({ reference });
      },
    },
    {
      method: 'PATCH',
      url: '/references/:id/restore',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Restore an archived reference material (FR-REF-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'reference');
        const reference = await req.server.services.references.restore(id);
        return reply.status(200).send({ reference });
      },
    },
  ];
}
