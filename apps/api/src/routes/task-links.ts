import { z } from 'zod';
import {
  CAPABILITIES,
  createTaskLinkSchema,
  updateTaskLinkSchema,
} from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Task-link routes (`FR-TASK-03`, `DATA-01`, `BR-04`, criterion 1, `MCP-14`).
 *
 * Declared, guarded and audited like every other route. Adding a link is
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

export function taskLinkRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/tasks/:id/links',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'List a task’s links in slot order (FR-TASK-03)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const links = await req.server.services.taskLinks.listByTask(taskId);
        return reply.status(200).send({ links });
      },
    },
    {
      method: 'POST',
      url: '/tasks/:id/links',
      capabilities: [CAPABILITIES.TASK_CREATE],
      description: 'Add a link to a task; the 4th is refused (FR-TASK-03, BR-04)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const input = parseOrThrow(createTaskLinkSchema, req.body ?? {});
        const link = await req.server.services.taskLinks.create(taskId, input);
        logger.debug('task-links.ts', 'POST /tasks/:id/links', 'created', {
          link_id: link.id,
          task_id: taskId,
        });
        return reply.status(201).send({ link });
      },
    },
    {
      method: 'GET',
      url: '/task-links/:id',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'Read one task link',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'task link');
        const link = await req.server.services.taskLinks.get(id);
        return reply.status(200).send({ link });
      },
    },
    {
      method: 'PATCH',
      url: '/task-links/:id',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Edit a task link’s label or URL (FR-TASK-03)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'task link');
        const input = parseOrThrow(updateTaskLinkSchema, req.body ?? {});
        const link = await req.server.services.taskLinks.update(id, input);
        return reply.status(200).send({ link });
      },
    },
    {
      method: 'PATCH',
      url: '/task-links/:id/archive',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Archive a task link, freeing its slot (FR-TASK-03)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'task link');
        const link = await req.server.services.taskLinks.archive(id);
        return reply.status(200).send({ link });
      },
    },
    {
      method: 'PATCH',
      url: '/task-links/:id/restore',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Restore an archived task link into a free slot (FR-TASK-03)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'task link');
        const link = await req.server.services.taskLinks.restore(id);
        return reply.status(200).send({ link });
      },
    },
  ];
}
