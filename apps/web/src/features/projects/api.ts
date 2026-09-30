import {
  errorEnvelopeSchema,
  listProjectsResponseSchema,
  projectResponseSchema,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from '@pdm/shared';

/**
 * The projects API, same-origin only.
 *
 * Relative paths by construction: the page and the API are served by one process
 * (ADR 0001), so there is no base URL to configure and no request that can leave
 * the laptop (`NFR-PRIV-01`). Responses are parsed with the shared schemas, so
 * the browser validates with the same contract the server enforces.
 */

async function apiError(res: Response, fallback: string): Promise<Error> {
  try {
    const envelope = errorEnvelopeSchema.parse(await res.json());
    return new Error(envelope.error.message || `${fallback} (HTTP ${res.status})`);
  } catch {
    return new Error(`${fallback} (HTTP ${res.status})`);
  }
}

async function readProject(res: Response, fallback: string): Promise<Project> {
  if (!res.ok) throw await apiError(res, fallback);
  return projectResponseSchema.parse(await res.json()).project;
}

export async function fetchProjects(signal: AbortSignal, includeArchived: boolean): Promise<Project[]> {
  const path = includeArchived ? '/api/v1/projects?include_archived=true' : '/api/v1/projects';
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw await apiError(res, 'Could not load projects');
  return listProjectsResponseSchema.parse(await res.json()).projects;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const res = await fetch('/api/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readProject(res, 'Could not create the project');
}

export async function updateProject(id: number, input: UpdateProjectInput): Promise<Project> {
  const res = await fetch(`/api/v1/projects/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readProject(res, 'Could not update the project');
}

export async function archiveProject(id: number): Promise<Project> {
  const res = await fetch(`/api/v1/projects/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readProject(res, 'Could not archive the project');
}

export async function restoreProject(id: number): Promise<Project> {
  const res = await fetch(`/api/v1/projects/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readProject(res, 'Could not restore the project');
}
