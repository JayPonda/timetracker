import {
  errorEnvelopeSchema,
  listProjectsResponseSchema,
  listTasksResponseSchema,
  taskResponseSchema,
  type CreateTaskInput,
  type ListTasksQuery,
  type Project,
  type Task,
  type UpdateTaskInput,
} from '@pdm/shared';

/**
 * The tasks API, same-origin only.
 *
 * Relative paths by construction (ADR 0001, `NFR-PRIV-01`): nothing here can
 * leave the laptop. Responses are parsed with the shared schemas, so the
 * browser validates with the same contract the server enforces.
 */

async function apiError(res: Response, fallback: string): Promise<Error> {
  try {
    const envelope = errorEnvelopeSchema.parse(await res.json());
    return new Error(envelope.error.message || `${fallback} (HTTP ${res.status})`);
  } catch {
    return new Error(`${fallback} (HTTP ${res.status})`);
  }
}

async function readTask(res: Response, fallback: string): Promise<Task> {
  if (!res.ok) throw await apiError(res, fallback);
  return taskResponseSchema.parse(await res.json()).task;
}

export interface TaskFilters {
  readonly projectId: number | 'none' | 'all';
  readonly status: 'all' | Task['status'];
  readonly sort: ListTasksQuery['sort'];
  readonly direction: ListTasksQuery['direction'];
  readonly includeArchived: boolean;
}

export async function fetchTasks(signal: AbortSignal, filters: TaskFilters): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filters.projectId === 'none') params.set('project_id', 'none');
  if (typeof filters.projectId === 'number') params.set('project_id', String(filters.projectId));
  if (filters.status !== 'all') params.set('status', filters.status);
  params.set('sort', filters.sort);
  params.set('direction', filters.direction);
  if (filters.includeArchived) params.set('include_archived', 'true');

  const res = await fetch(`/tasks?${params.toString()}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await apiError(res, 'Could not load tasks');
  return listTasksResponseSchema.parse(await res.json()).tasks;
}

/** Live projects for the picker. Archived ones are never offered (`DATA-11`). */
export async function fetchLiveProjects(signal: AbortSignal): Promise<Project[]> {
  const res = await fetch('/projects', { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw await apiError(res, 'Could not load projects');
  return listProjectsResponseSchema.parse(await res.json()).projects;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const res = await fetch('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTask(res, 'Could not create the task');
}

export async function updateTask(id: number, input: UpdateTaskInput): Promise<Task> {
  const res = await fetch(`/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTask(res, 'Could not update the task');
}

export async function archiveTask(id: number): Promise<Task> {
  const res = await fetch(`/tasks/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTask(res, 'Could not archive the task');
}

export async function restoreTask(id: number): Promise<Task> {
  const res = await fetch(`/tasks/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTask(res, 'Could not restore the task');
}
