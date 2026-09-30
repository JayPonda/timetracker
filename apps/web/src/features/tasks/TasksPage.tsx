import { useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTaskSchema,
  updateTaskSchema,
  type Task,
} from '@pdm/shared';
import { Sidebar } from '../../components/Sidebar';
import { EMPTY_TASK_FORM, TasksView, type TaskFormValues } from './TasksView';
import {
  archiveTask,
  createTask,
  fetchLiveProjects,
  fetchTasks,
  restoreTask,
  updateTask,
  type TaskFilters,
} from './api';

/**
 * The tasks screen (`FR-TASK-01/02/04/05/06/12/13`, `FR-STAT-04/05`, `FR-VIEW-03`,
 * `UI-04/08/17`).
 *
 * Data and field state live here; `TasksView` renders. A rejected save sets an
 * error and leaves every typed value where it is (`UI-08`). Dates are not
 * editable on this screen yet: the API stores epoch milliseconds and a date
 * picker that silently used the browser zone instead of `PDM_TZ` would write
 * wrong dates with confidence, so they wait for the task detail work.
 */

function firstIssueMessage(error: {
  issues: ReadonlyArray<{ path: string; message: string }>;
}): string {
  const first = error.issues[0];
  if (!first) return 'That change was not accepted.';
  return `${first.path}: ${first.message}`;
}

function toIssues(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;
}): {
  issues: ReadonlyArray<{ path: string; message: string }>;
} {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
      message: issue.message,
    })),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Form strings to schema input. Empty means “none”, never zero. */
function toNumbers(values: Pick<TaskFormValues, 'score' | 'estimateHours'>): {
  score: number | null;
  estimate_hours: number | null;
} {
  return {
    score: values.score.trim() === '' ? null : Number(values.score),
    estimate_hours: values.estimateHours.trim() === '' ? null : Number(values.estimateHours),
  };
}

const DEFAULT_FILTERS: TaskFilters = {
  projectId: 'all',
  status: 'all',
  sort: 'created_at',
  direction: 'desc',
  includeArchived: false,
};

export function TasksPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [createValues, setCreateValues] = useState<TaskFormValues>(EMPTY_TASK_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<TaskFormValues>(EMPTY_TASK_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['tasks', filters],
    queryFn: ({ signal }) => fetchTasks(signal, filters),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'live'],
    queryFn: ({ signal }) => fetchLiveProjects(signal),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const handleCreate = async (): Promise<void> => {
    const numbers = toNumbers(createValues);
    const parsed = createTaskSchema.safeParse({
      name: createValues.name,
      description: createValues.description,
      project_id: createValues.projectId,
      score: numbers.score,
      estimate_hours: numbers.estimate_hours,
    });
    if (!parsed.success) {
      setCreateError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      await createTask(parsed.data);
      setCreateValues(EMPTY_TASK_FORM);
      await refresh();
    } catch (error) {
      setCreateError(errorMessage(error, 'Could not create the task.'));
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = (task: Task): void => {
    setEditingId(task.id);
    setEditValues({
      name: task.name,
      description: task.description,
      projectId: task.project_id,
      score: task.score === null ? '' : String(task.score),
      estimateHours: task.estimate_hours === null ? '' : String(task.estimate_hours),
    });
    setEditError(null);
    setActionError(null);
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (editingId === null) return;
    const original = tasksQuery.data?.find((task) => task.id === editingId);
    if (!original) {
      setEditError('That task is no longer in this list. Reload and try again.');
      return;
    }

    const numbers = toNumbers(editValues);
    const patch: Record<string, unknown> = {};
    if (editValues.name !== original.name) patch.name = editValues.name;
    if (editValues.description !== original.description) patch.description = editValues.description;
    if (editValues.projectId !== original.project_id) patch.project_id = editValues.projectId;
    if (numbers.score !== original.score) patch.score = numbers.score;
    if (numbers.estimate_hours !== original.estimate_hours) {
      patch.estimate_hours = numbers.estimate_hours;
    }
    if (Object.keys(patch).length === 0) {
      setEditError('Nothing to update: change a field before saving.');
      return;
    }

    const parsed = updateTaskSchema.safeParse(patch);
    if (!parsed.success) {
      setEditError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      await updateTask(editingId, parsed.data);
      setEditingId(null);
      await refresh();
    } catch (error) {
      setEditError(errorMessage(error, 'Could not update the task.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const runAction = async (id: number, action: (taskId: number) => Promise<unknown>): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await action(id);
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error, 'That change did not go through.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen flex bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-800 flex items-center px-4 gap-3">
          <h1 className="font-semibold">Tasks</h1>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            create, edit, move, archive, restore
          </span>
        </header>
        <main className="flex-1 p-6">
          <TasksView
            tasks={tasksQuery.data}
            loading={tasksQuery.isPending}
            loadError={
              tasksQuery.error ? errorMessage(tasksQuery.error, 'Could not load tasks.') : null
            }
            filters={filters}
            onFiltersChange={setFilters}
            liveProjects={projectsQuery.data ?? []}
            createValues={createValues}
            onCreateChange={setCreateValues}
            onCreate={() => void handleCreate()}
            createError={createError}
            creating={creating}
            editingId={editingId}
            editValues={editValues}
            onEditChange={setEditValues}
            onStartEdit={handleStartEdit}
            onCancelEdit={() => {
              setEditingId(null);
              setEditError(null);
            }}
            onSaveEdit={() => void handleSaveEdit()}
            editError={editError}
            savingEdit={savingEdit}
            onMoveStatus={(id, status) => void runAction(id, (taskId) => updateTask(taskId, { status }))}
            onArchive={(id) => void runAction(id, archiveTask)}
            onRestore={(id) => void runAction(id, restoreTask)}
            busyId={busyId}
            actionError={actionError}
          />
        </main>
      </div>
    </div>
  );
}
