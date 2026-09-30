import { z } from 'zod';
import { CAPABILITIES, createProjectSchema, listProjectsQuerySchema, updateProjectSchema } from '@pdm/shared';
import { validationDetails, validationFailed, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * Project routes (`FR-PRJ-01`…`FR-PRJ-04`, `MCP-14`).
 *
 * Declared, not registered by hand, so they inherit the default-deny guard and
 * the boot-time audit (criterion 12). **There is no `DELETE` declaration and
 * there cannot be one** — `RouteTable.declare` throws on `DELETE`, so removal is
 * a `PATCH` (criterion 7, `FR-PRJ-04`).
 *
 * **The capability split is the `MCP-14` promise, made once.** Reading and
 * creating are things the assistant may do; `project:write` covers rename, archive
 * and restore, and it is absent from `MCP_MAX_CAPABILITIES`. A token without that
 * capability gets a 403 from the guard before this file parses anything.
 *
 * A handler here does HTTP plumbing only: parse, validate, call the service,
 * shape the response. No SQL, and no business rule — if a decision appears in
 * this file it belongs in `project.service.ts` (ground rule 1).
 */

const ID_PARAM = '/api/v1/projects/:id';

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationFailed('A project id must be a positive whole number.', {
      issues: [{ path: 'id', message: 'must be a positive whole number', code: 'invalid' }],
    });
  }
  return id;
}

/**
 * Run a Zod schema over a payload, turning a failure into the `AppError` the
 * interface already knows how to render.
 *
 * The submitted value is **not** echoed back (criterion 9): the browser leaves
 * the field alone, which is what "preserve what the owner typed" actually means.
 */
function parseOrThrow<Output, Input>(schema: z.ZodType<Output, z.ZodTypeDef, Input>, value: unknown): Output {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = validationDetails(result.error);
  throw validationFailed(validationMessage(details), details);
}

export function projectRoutes(): readonly RouteDeclaration[] {
  return [
    {
      method: 'GET',
      url: '/api/v1/projects',
      capabilities: [CAPABILITIES.PROJECT_READ],
      description: 'List projects, archived ones only when asked for (DATA-11)',
      handler: async (req, reply) => {
        const query = parseOrThrow(listProjectsQuerySchema, req.query ?? {});
        const projects = await req.server.services.projects.list({
          includeArchived: query.include_archived,
        });
        return reply.status(200).send({ projects });
      },
    },
    {
      method: 'GET',
      url: `${ID_PARAM}`,
      capabilities: [CAPABILITIES.PROJECT_READ],
      description: 'Read one project',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const project = await req.server.services.projects.get(id);
        return reply.status(200).send({ project });
      },
    },
    {
      method: 'POST',
      url: '/api/v1/projects',
      capabilities: [CAPABILITIES.PROJECT_WRITE],
      description: 'Create a project (FR-PRJ-01)',
      handler: async (req, reply) => {
        const input = parseOrThrow(createProjectSchema, req.body ?? {});
        const project = await req.server.services.projects.create(input);
        logger.debug('projects.ts', 'POST /api/projects', 'created', { project_id: project.id });
        return reply.status(201).send({ project });
      },
    },
    {
      method: 'PATCH',
      url: ID_PARAM,
      capabilities: [CAPABILITIES.PROJECT_WRITE],
      description: 'Rename or re-colour a project (FR-PRJ-03)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const input = parseOrThrow(updateProjectSchema, req.body ?? {});
        const project = await req.server.services.projects.update(id, input);
        return reply.status(200).send({ project });
      },
    },
    {
      // Archive is a PATCH, not a DELETE. The method is the statement: this
      // endpoint hides a project and is reversible (FR-PRJ-04, BR-13).
      method: 'PATCH',
      url: `${ID_PARAM}/archive`,
      capabilities: [CAPABILITIES.PROJECT_WRITE],
      description: 'Archive a project; never deletes it (FR-PRJ-04)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const project = await req.server.services.projects.archive(id);
        return reply.status(200).send({ project });
      },
    },
    {
      method: 'PATCH',
      url: `${ID_PARAM}/restore`,
      capabilities: [CAPABILITIES.PROJECT_WRITE],
      description: 'Restore an archived project (FR-PRJ-03, BR-16)',
      handler: async (req, reply) => {
        const id = parseId((req.params as Record<string, string>).id);
        const project = await req.server.services.projects.restore(id);
        return reply.status(200).send({ project });
      },
    },
  ];
}
