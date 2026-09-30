import { z } from 'zod';
import {
  CAPABILITIES,
  createTagSchema,
  listTagsQuerySchema,
  updateTagSchema,
} from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Tag routes (`FR-TAG-01`, `FR-TAG-05`, `MCP-14`).
 *
 * Declared, guarded and audited like every other route. Reading and creating
 * are `tag:read`/`tag:create`, which the assistant holds; renaming, archiving
 * and restoring are `tag:update`, which it never holds.
 *
 * Handlers do HTTP plumbing only (ground rule 1).
 */

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationFailed('A tag id must be a positive whole number.', {
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

export function tagRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/api/v1/tags',
      capabilities: [CAPABILITIES.TAG_READ],
      description: 'List tags, archived ones only when asked for (DATA-11)',
      handler: async (req, reply) => {
        const query = parseOrThrow(listTagsQuerySchema, req.query ?? {});
        const tags = await req.server.services.tags.list({
          includeArchived: query.include_archived,
        });
        return reply.status(200).send({ tags });
      },
    },
    {
      method: 'GET',
      url: '/api/v1/tags/:id',
      capabilities: [CAPABILITIES.TAG_READ],
      description: 'Read one tag',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const tag = await req.server.services.tags.get(id);
        return reply.status(200).send({ tag });
      },
    },
    {
      method: 'POST',
      url: '/api/v1/tags',
      capabilities: [CAPABILITIES.TAG_CREATE],
      description: 'Create a tag; a live name is refused (FR-TAG-01)',
      handler: async (req, reply) => {
        const input = parseOrThrow(createTagSchema, req.body ?? {});
        const tag = await req.server.services.tags.create(input);
        logger.debug('tags.ts', 'POST /api/tags', 'created', { tag_id: tag.id });
        return reply.status(201).send({ tag });
      },
    },
    {
      method: 'PATCH',
      url: '/api/v1/tags/:id',
      capabilities: [CAPABILITIES.TAG_UPDATE],
      description: 'Rename or re-colour a tag (FR-TAG-01)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const input = parseOrThrow(updateTagSchema, req.body ?? {});
        const tag = await req.server.services.tags.update(id, input);
        return reply.status(200).send({ tag });
      },
    },
    {
      // Archive is a PATCH, not a DELETE: the tag stays on its entries
      // (FR-TAG-05, BR-13).
      method: 'PATCH',
      url: '/api/v1/tags/:id/archive',
      capabilities: [CAPABILITIES.TAG_UPDATE],
      description: 'Archive a tag; never deletes it (FR-TAG-05)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const tag = await req.server.services.tags.archive(id);
        return reply.status(200).send({ tag });
      },
    },
    {
      method: 'PATCH',
      url: '/api/v1/tags/:id/restore',
      capabilities: [CAPABILITIES.TAG_UPDATE],
      description: 'Restore an archived tag (FR-TAG-05)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const tag = await req.server.services.tags.restore(id);
        return reply.status(200).send({ tag });
      },
    },
  ];
}
