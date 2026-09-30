import { useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTodoSchema, updateTodoSchema, type Todo } from '@pdm/shared';
import { Sidebar } from '../../components/Sidebar';
import { EMPTY_TODO_FORM, TaskDetailView, type TodoFormValues } from './TaskDetailView';
import {
  archiveTodo,
  createTodo,
  fetchTask,
  fetchTodos,
  reorderTodos,
  restoreTodo,
  updateTodo,
} from './api';

/**
 * One task and its phases (`FR-TODO-01`, `FR-TODO-02`, `FR-PHASE-05`, `UI-08`).
 *
 * Data and field state live here; `TaskDetailView` renders. A rejected save
 * sets an error and leaves every typed value where it is. Reorder sends the
 * complete visible order, which is what the endpoint requires — the buttons
 * move one step, the request carries the whole list.
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

export function TaskDetailPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { id } = useParams();
  const taskId = Number(id);
  const taskIdValid = Number.isInteger(taskId) && taskId > 0;

  const [showArchivedTodos, setShowArchivedTodos] = useState(false);
  const [addValues, setAddValues] = useState<TodoFormValues>(EMPTY_TODO_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<TodoFormValues>(EMPTY_TODO_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: ({ signal }) => fetchTask(signal, taskId),
    enabled: taskIdValid,
  });
  const todosQuery = useQuery({
    queryKey: ['todos', taskId, showArchivedTodos],
    queryFn: ({ signal }) => fetchTodos(signal, taskId, showArchivedTodos),
    enabled: taskIdValid,
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['todos', taskId] });
  };

  const handleAdd = async (): Promise<void> => {
    if (!taskIdValid) return;
    const parsed = createTodoSchema.safeParse({
      title: addValues.title,
      note: addValues.note,
      estimate_hours:
        addValues.estimateHours.trim() === '' ? null : Number(addValues.estimateHours),
    });
    if (!parsed.success) {
      setAddError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setAdding(true);
    setAddError(null);
    try {
      await createTodo(taskId, parsed.data);
      setAddValues(EMPTY_TODO_FORM);
      await refresh();
    } catch (error) {
      setAddError(errorMessage(error, 'Could not create the todo.'));
    } finally {
      setAdding(false);
    }
  };

  const handleStartEdit = (todo: Todo): void => {
    setEditingId(todo.id);
    setEditValues({
      title: todo.title,
      note: todo.note,
      estimateHours: todo.estimate_hours === null ? '' : String(todo.estimate_hours),
    });
    setEditError(null);
    setActionError(null);
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (editingId === null) return;
    const original = todosQuery.data?.find((todo) => todo.id === editingId);
    if (!original) {
      setEditError('That todo is no longer in this list. Reload and try again.');
      return;
    }

    const estimate =
      editValues.estimateHours.trim() === '' ? null : Number(editValues.estimateHours);
    const patch: Record<string, unknown> = {};
    if (editValues.title !== original.title) patch.title = editValues.title;
    if (editValues.note !== original.note) patch.note = editValues.note;
    if (estimate !== original.estimate_hours) patch.estimate_hours = estimate;
    if (Object.keys(patch).length === 0) {
      setEditError('Nothing to update: change a field before saving.');
      return;
    }

    const parsed = updateTodoSchema.safeParse(patch);
    if (!parsed.success) {
      setEditError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      await updateTodo(editingId, parsed.data);
      setEditingId(null);
      await refresh();
    } catch (error) {
      setEditError(errorMessage(error, 'Could not update the todo.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const runAction = async (todoId: number, action: (id: number) => Promise<unknown>): Promise<void> => {
    setBusyId(todoId);
    setActionError(null);
    try {
      await action(todoId);
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error, 'That change did not go through.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleTick = (todo: Todo): Promise<void> =>
    runAction(todo.id, (todoId) => updateTodo(todoId, { done: !todo.done }));

  const handleMove = async (todoId: number, direction: -1 | 1): Promise<void> => {
    if (!taskIdValid) return;
    const order = (todosQuery.data ?? []).map((todo) => todo.id);
    const index = order.indexOf(todoId);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= order.length) return;
    const next = [...order];
    [next[index], next[swapWith]] = [next[swapWith] as number, next[index] as number];
    setBusyId(todoId);
    setActionError(null);
    try {
      await reorderTodos(taskId, next as number[]);
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error, 'Could not reorder the todos.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen flex bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-800 flex items-center px-4 gap-3">
          <h1 className="font-semibold">Task</h1>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            phases, and later its links, criteria and references
          </span>
        </header>
        <main className="flex-1 p-6">
          {!taskIdValid ? (
            <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
              That is not a task address.
            </p>
          ) : (
            <TaskDetailView
              task={taskQuery.data}
              loading={taskQuery.isPending}
              loadError={
                taskQuery.error ? errorMessage(taskQuery.error, 'Could not load the task.') : null
              }
              todos={todosQuery.data}
              todosLoading={todosQuery.isPending}
              todosError={
                todosQuery.error ? errorMessage(todosQuery.error, 'Could not load todos.') : null
              }
              showArchivedTodos={showArchivedTodos}
              onToggleShowArchivedTodos={setShowArchivedTodos}
              addValues={addValues}
              onAddChange={setAddValues}
              onAdd={() => void handleAdd()}
              addError={addError}
              adding={adding}
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
              onTick={(todo) => void handleTick(todo)}
              onMove={(todoId, direction) => void handleMove(todoId, direction)}
              onArchive={(todoId) => void runAction(todoId, archiveTodo)}
              onRestore={(todoId) => void runAction(todoId, restoreTodo)}
              busyId={busyId}
              actionError={actionError}
            />
          )}
        </main>
      </div>
    </div>
  );
}
