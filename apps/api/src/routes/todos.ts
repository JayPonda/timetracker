import { z } from 'zod';
import {
  CAPABILITIES,
  createTodoSchema,
  listTodosQuerySchema,
  reorderTodosSchema,
  updateTodoSchema,
} from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Todo routes (`FR-TODO-01`, `FR-TODO-02`, `FR-PHASE-05`, `MCP-14`).
 *
 * Declared, guarded and audited like every other route. The capability split
 * follows the `MCP-14` promise literally: reading and creating are
 * `task:read`/`task:create`, which the assistant holds; renaming, ticking,
 * reordering, archiving and restoring are `task:update`, which it never holds.
 * Creating a todo is a creation, so the assistant may do it; changing one is a
 * mutation, so it may not.
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

export function todoRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/api/v1/tasks/:id/todos',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'List a task’s todos in timeline order (FR-TODO-01, DATA-11)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const query = parseOrThrow(listTodosQuerySchema, req.query ?? {});
        const todos = await req.server.services.todos.listByTask(taskId, {
          includeArchived: query.include_archived,
        });
        return reply.status(200).send({ todos });
      },
    },
    {
      method: 'POST',
      url: '/api/v1/tasks/:id/todos',
      capabilities: [CAPABILITIES.TASK_CREATE],
      description: 'Add a todo to a task (FR-TODO-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const input = parseOrThrow(createTodoSchema, req.body ?? {});
        const todo = await req.server.services.todos.create(taskId, input);
        logger.debug('todos.ts', 'POST /api/v1/tasks/:id/todos', 'created', {
          todo_id: todo.id,
          task_id: taskId,
        });
        return reply.status(201).send({ todo });
      },
    },
    {
      method: 'PATCH',
      url: '/api/v1/tasks/:id/todos/reorder',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Reorder a task’s todos with the complete order (FR-TODO-01)',
      handler: async (req, reply) => {
        const taskId = parseId((req.params as Record<string, string>).id, 'task');
        const input = parseOrThrow(reorderTodosSchema, req.body ?? {});
        const todos = await req.server.services.todos.reorder(taskId, input.order);
        return reply.status(200).send({ todos });
      },
    },
    {
      method: 'GET',
      url: '/api/v1/todos/:id',
      capabilities: [CAPABILITIES.TASK_READ],
      description: 'Read one todo',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'todo');
        const todo = await req.server.services.todos.get(id);
        return reply.status(200).send({ todo });
      },
    },
    {
      method: 'PATCH',
      url: '/api/v1/todos/:id',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Rename, retick or re-estimate a todo (FR-TODO-01, FR-TODO-02)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'todo');
        const input = parseOrThrow(updateTodoSchema, req.body ?? {});
        const todo = await req.server.services.todos.update(id, input);
        return reply.status(200).send({ todo });
      },
    },
    {
      method: 'PATCH',
      url: '/api/v1/todos/:id/archive',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Archive a todo; never deletes it (FR-PHASE-05)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'todo');
        const todo = await req.server.services.todos.archive(id);
        return reply.status(200).send({ todo });
      },
    },
    {
      method: 'PATCH',
      url: '/api/v1/todos/:id/restore',
      capabilities: [CAPABILITIES.TASK_UPDATE],
      description: 'Restore an archived todo (FR-PHASE-05)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id, 'todo');
        const todo = await req.server.services.todos.restore(id);
        return reply.status(200).send({ todo });
      },
    },
  ];
}
