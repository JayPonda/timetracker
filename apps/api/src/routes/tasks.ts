import { z } from 'zod';
import {
  CAPABILITIES,
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Task routes, core slice (`FR-TASK-01/02/04/05/06/07/12/13`, `FR-VIEW-03`, `MCP-14`).
 *
 * Declared, guarded and audited like every other route (criterion 12). The
 * capability split is the `MCP-14` promise for tasks: the assistant may read
 * (`task:read`) and create (`task:create`), and may never mutate — `task:update`
 * is absent from `MCP_MAX_CAPABILITIES`, so rename, status moves, archive and
 * restore are all refused before a handler runs. There is deliberately **no**
 * route that can set `ended`; `task:close` exists for 0.5.0 and nothing here
 * needs it (`FR-STAT-01`).
 *
 * Handlers do HTTP plumbing only: parse, validate, call the service, shape the
 * response. No SQL, no business rules (ground rule 1).
 */

const ID_PARAM = '/tasks/:id';

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationFailed('A task id must be a positive whole number.', {
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

export function taskRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/tasks',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'List tasks with project/status filters and sorting (FR-VIEW-03, DATA-11)',
      handler: async (req, reply) => {
        const query = parseOrThrow(listTasksQuerySchema, req.query ?? {});
        const tasks = await req.server.services.tasks.list({
          projectId: query.project_id,
          status: query.status,
          sort: query.sort,
          direction: query.direction,
          includeArchived: query.include_archived,
        });
        return reply.status(200).send({ tasks });
      },
    },
    {
      method: 'GET',
      url: `${ID_PARAM}`,
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'Read one task',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const task = await req.server.services.tasks.get(id);
        return reply.status(200).send({ task });
      },
    },
    {
      method: 'POST',
      url: '/tasks',
      capabilities: [CAPABILITIES.TASK_CREATE],
      description: 'Create a task (FR-TASK-01)',
      handler: async (req, reply) => {
        const input = parseOrThrow(createTaskSchema, req.body ?? {});
        const task = await req.server.services.tasks.create(input);
        logger.debug('tasks.ts', 'POST /tasks', 'created', { task_id: task.id });
        return reply.status(201).send({ task });
      },
    },
    {
      method: 'PATCH',
      url: ID_PARAM,
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Edit a task; never accepts ended (FR-TASK-12, FR-STAT-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const input = parseOrThrow(updateTaskSchema, req.body ?? {});
        const task = await req.server.services.tasks.update(id, input);
        return reply.status(200).send({ task });
      },
    },
    {
      // Archive is a PATCH, not a DELETE: it hides the task and is reversible
      // (FR-TASK-13, BR-13).
      method: 'PATCH',
      url: `${ID_PARAM}/archive`,
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Archive a task; never deletes it (FR-TASK-13)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const task = await req.server.services.tasks.archive(id);
        return reply.status(200).send({ task });
      },
    },
    {
      method: 'PATCH',
      url: `${ID_PARAM}/restore`,
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Restore an archived task (FR-TASK-13)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const task = await req.server.services.tasks.restore(id);
        return reply.status(200).send({ task });
      },
    },
  ];
}
