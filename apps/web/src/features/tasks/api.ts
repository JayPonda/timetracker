import {
  criterionResponseSchema,
  errorEnvelopeSchema,
  listCriteriaResponseSchema,
  listHistoryResponseSchema,
  listProjectsResponseSchema,
  listReferencesResponseSchema,
  listTaskLinksResponseSchema,
  listTasksResponseSchema,
  listTodosResponseSchema,
  referenceResponseSchema,
  taskLinkResponseSchema,
  taskResponseSchema,
  todoResponseSchema,
  type CreateCriterionInput,
  type CreateReferenceInput,
  type CreateTaskInput,
  type CreateTaskLinkInput,
  type CreateTodoInput,
  type Criterion,
  type HistoryEntry,
  type ListTasksQuery,
  type Project,
  type Reference,
  type Task,
  type TaskLink,
  type Todo,
  type UpdateCriterionInput,
  type UpdateReferenceInput,
  type UpdateTaskInput,
  type UpdateTaskLinkInput,
  type UpdateTodoInput,
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

export async function fetchTask(signal: AbortSignal, id: number): Promise<Task> {
  const res = await fetch(`/tasks/${id}`, { signal, headers: { accept: 'application/json' } });
  return readTask(res, 'Could not load the task');
}

export async function fetchHistory(signal: AbortSignal, taskId: number): Promise<HistoryEntry[]> {
  const res = await fetch(`/tasks/${taskId}/history`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await apiError(res, 'Could not load the history');
  return listHistoryResponseSchema.parse(await res.json()).history;
}

export async function fetchTodos(
  signal: AbortSignal,
  taskId: number,
  includeArchived: boolean,
): Promise<Todo[]> {
  const path = includeArchived
    ? `/tasks/${taskId}/todos?include_archived=true`
    : `/tasks/${taskId}/todos`;
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw await apiError(res, 'Could not load todos');
  return listTodosResponseSchema.parse(await res.json()).todos;
}

async function readTodo(res: Response, fallback: string): Promise<Todo> {
  if (!res.ok) throw await apiError(res, fallback);
  return todoResponseSchema.parse(await res.json()).todo;
}

export async function createTodo(taskId: number, input: CreateTodoInput): Promise<Todo> {
  const res = await fetch(`/tasks/${taskId}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTodo(res, 'Could not create the todo');
}

export async function updateTodo(id: number, input: UpdateTodoInput): Promise<Todo> {
  const res = await fetch(`/todos/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTodo(res, 'Could not update the todo');
}

export async function reorderTodos(taskId: number, order: readonly number[]): Promise<Todo[]> {
  const res = await fetch(`/tasks/${taskId}/todos/reorder`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) throw await apiError(res, 'Could not reorder the todos');
  return listTodosResponseSchema.parse(await res.json()).todos;
}

export async function archiveTodo(id: number): Promise<Todo> {
  const res = await fetch(`/todos/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTodo(res, 'Could not archive the todo');
}

export async function restoreTodo(id: number): Promise<Todo> {
  const res = await fetch(`/todos/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTodo(res, 'Could not restore the todo');
}

export async function fetchTaskLinks(signal: AbortSignal, taskId: number): Promise<TaskLink[]> {
  // Archived links render in their own subsection, so they are fetched, not
  // filtered. The subsection is the `DATA-11` opt-in, stated in words.
  const res = await fetch(`/tasks/${taskId}/links?include_archived=true`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await apiError(res, 'Could not load links');
  return listTaskLinksResponseSchema.parse(await res.json()).links;
}

async function readTaskLink(res: Response, fallback: string): Promise<TaskLink> {
  if (!res.ok) throw await apiError(res, fallback);
  return taskLinkResponseSchema.parse(await res.json()).link;
}

export async function createTaskLink(taskId: number, input: CreateTaskLinkInput): Promise<TaskLink> {
  const res = await fetch(`/tasks/${taskId}/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTaskLink(res, 'Could not add the link');
}

export async function updateTaskLink(id: number, input: UpdateTaskLinkInput): Promise<TaskLink> {
  const res = await fetch(`/task-links/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readTaskLink(res, 'Could not update the link');
}

export async function archiveTaskLink(id: number): Promise<TaskLink> {
  const res = await fetch(`/task-links/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTaskLink(res, 'Could not archive the link');
}

export async function restoreTaskLink(id: number): Promise<TaskLink> {
  const res = await fetch(`/task-links/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readTaskLink(res, 'Could not restore the link');
}

export async function fetchCriteria(
  signal: AbortSignal,
  taskId: number,
  includeArchived: boolean,
): Promise<Criterion[]> {
  const path = includeArchived
    ? `/tasks/${taskId}/criteria?include_archived=true`
    : `/tasks/${taskId}/criteria`;
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw await apiError(res, 'Could not load acceptance criteria');
  return listCriteriaResponseSchema.parse(await res.json()).criteria;
}

async function readCriterion(res: Response, fallback: string): Promise<Criterion> {
  if (!res.ok) throw await apiError(res, fallback);
  return criterionResponseSchema.parse(await res.json()).criterion;
}

export async function createCriterion(taskId: number, input: CreateCriterionInput): Promise<Criterion> {
  const res = await fetch(`/tasks/${taskId}/criteria`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readCriterion(res, 'Could not add the criterion');
}

export async function updateCriterion(id: number, input: UpdateCriterionInput): Promise<Criterion> {
  const res = await fetch(`/criteria/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readCriterion(res, 'Could not update the criterion');
}

export async function reorderCriteria(taskId: number, order: readonly number[]): Promise<Criterion[]> {
  const res = await fetch(`/tasks/${taskId}/criteria/reorder`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) throw await apiError(res, 'Could not reorder the criteria');
  return listCriteriaResponseSchema.parse(await res.json()).criteria;
}

export async function archiveCriterion(id: number): Promise<Criterion> {
  const res = await fetch(`/criteria/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readCriterion(res, 'Could not archive the criterion');
}

export async function restoreCriterion(id: number): Promise<Criterion> {
  const res = await fetch(`/criteria/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readCriterion(res, 'Could not restore the criterion');
}

export async function fetchReferences(signal: AbortSignal, taskId: number): Promise<Reference[]> {
  // Archived references render in their own subsection, so they are fetched,
  // not filtered — the subsection is the `DATA-11` opt-in, stated in words.
  const res = await fetch(`/tasks/${taskId}/references?include_archived=true`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await apiError(res, 'Could not load references');
  return listReferencesResponseSchema.parse(await res.json()).references;
}

async function readReference(res: Response, fallback: string): Promise<Reference> {
  if (!res.ok) throw await apiError(res, fallback);
  return referenceResponseSchema.parse(await res.json()).reference;
}

export async function createReference(taskId: number, input: CreateReferenceInput): Promise<Reference> {
  const res = await fetch(`/tasks/${taskId}/references`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readReference(res, 'Could not add the reference');
}

export async function updateReference(id: number, input: UpdateReferenceInput): Promise<Reference> {
  const res = await fetch(`/references/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  return readReference(res, 'Could not update the reference');
}

export async function archiveReference(id: number): Promise<Reference> {
  const res = await fetch(`/references/${id}/archive`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readReference(res, 'Could not archive the reference');
}

export async function restoreReference(id: number): Promise<Reference> {
  const res = await fetch(`/references/${id}/restore`, {
    method: 'PATCH',
    headers: { accept: 'application/json' },
  });
  return readReference(res, 'Could not restore the reference');
}
