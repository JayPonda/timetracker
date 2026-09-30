import { useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCriterionSchema,
  createReferenceSchema,
  createTaskLinkSchema,
  createTodoSchema,
  updateCriterionSchema,
  updateReferenceSchema,
  updateTaskLinkSchema,
  updateTodoSchema,
  type Criterion,
  type Reference,
  type ReferenceType,
  type TaskLink,
  type Todo,
} from '@pdm/shared';
import { Sidebar } from '../../components/Sidebar';
import { useHealth } from '../../lib/health';
import { EMPTY_TODO_FORM, TaskDetailView, type TodoFormValues } from './TaskDetailView';
import { EMPTY_CRITERION_FORM, type CriterionFormValues } from './TaskCriteria';
import { EMPTY_REFERENCE_FORM, type ReferenceFormValues } from './TaskReferences';
import { EMPTY_TASK_LINK_FORM, type TaskLinkFormValues } from './TaskLinks';
import {
  archiveCriterion,
  archiveReference,
  archiveTodo,
  archiveTaskLink,
  createCriterion,
  createReference,
  createTodo,
  createTaskLink,
  fetchCriteria,
  fetchHistory,
  fetchReferences,
  fetchTask,
  fetchTaskLinks,
  fetchTodos,
  reorderCriteria,
  reorderTodos,
  restoreCriterion,
  restoreReference,
  restoreTodo,
  restoreTaskLink,
  updateCriterion,
  updateReference,
  updateTodo,
  updateTaskLink,
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
  const [linkAddValues, setLinkAddValues] = useState<TaskLinkFormValues>(EMPTY_TASK_LINK_FORM);
  const [linkAddError, setLinkAddError] = useState<string | null>(null);
  const [linkAdding, setLinkAdding] = useState(false);
  const [linkEditingId, setLinkEditingId] = useState<number | null>(null);
  const [linkEditValues, setLinkEditValues] = useState<TaskLinkFormValues>(EMPTY_TASK_LINK_FORM);
  const [linkEditError, setLinkEditError] = useState<string | null>(null);
  const [linkSavingEdit, setLinkSavingEdit] = useState(false);
  const [linkBusyId, setLinkBusyId] = useState<number | null>(null);
  const [linkActionError, setLinkActionError] = useState<string | null>(null);
  const [showArchivedCriteria, setShowArchivedCriteria] = useState(false);
  const [criterionAddValues, setCriterionAddValues] = useState<CriterionFormValues>(EMPTY_CRITERION_FORM);
  const [criterionAddError, setCriterionAddError] = useState<string | null>(null);
  const [criterionAdding, setCriterionAdding] = useState(false);
  const [criterionEditingId, setCriterionEditingId] = useState<number | null>(null);
  const [criterionEditValues, setCriterionEditValues] = useState<CriterionFormValues>(EMPTY_CRITERION_FORM);
  const [criterionEditError, setCriterionEditError] = useState<string | null>(null);
  const [criterionSavingEdit, setCriterionSavingEdit] = useState(false);
  const [criterionBusyId, setCriterionBusyId] = useState<number | null>(null);
  const [criterionActionError, setCriterionActionError] = useState<string | null>(null);
  const [referenceAddValues, setReferenceAddValues] = useState<ReferenceFormValues>(EMPTY_REFERENCE_FORM);
  const [referenceAddError, setReferenceAddError] = useState<string | null>(null);
  const [referenceAdding, setReferenceAdding] = useState(false);
  const [referenceEditingId, setReferenceEditingId] = useState<number | null>(null);
  const [referenceEditValues, setReferenceEditValues] = useState<ReferenceFormValues>(EMPTY_REFERENCE_FORM);
  const [referenceEditError, setReferenceEditError] = useState<string | null>(null);
  const [referenceSavingEdit, setReferenceSavingEdit] = useState(false);
  const [referenceBusyId, setReferenceBusyId] = useState<number | null>(null);
  const [referenceActionError, setReferenceActionError] = useState<string | null>(null);

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

  const linksQuery = useQuery({
    queryKey: ['links', taskId],
    queryFn: ({ signal }) => fetchTaskLinks(signal, taskId),
    enabled: taskIdValid,
  });

  const criteriaQuery = useQuery({
    queryKey: ['criteria', taskId, showArchivedCriteria],
    queryFn: ({ signal }) => fetchCriteria(signal, taskId, showArchivedCriteria),
    enabled: taskIdValid,
  });
  const historyQuery = useQuery({
    queryKey: ['history', taskId],
    queryFn: ({ signal }) => fetchHistory(signal, taskId),
    enabled: taskIdValid,
  });
  const { data: health } = useHealth();

  const referencesQuery = useQuery({
    queryKey: ['references', taskId],
    queryFn: ({ signal }) => fetchReferences(signal, taskId),
    enabled: taskIdValid,
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['todos', taskId] });
    await queryClient.invalidateQueries({ queryKey: ['links', taskId] });
    await queryClient.invalidateQueries({ queryKey: ['criteria', taskId] });
    await queryClient.invalidateQueries({ queryKey: ['references', taskId] });
    await queryClient.invalidateQueries({ queryKey: ['history', taskId] });
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

  const handleLinkAdd = async (): Promise<void> => {
    if (!taskIdValid) return;
    const parsed = createTaskLinkSchema.safeParse(linkAddValues);
    if (!parsed.success) {
      setLinkAddError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setLinkAdding(true);
    setLinkAddError(null);
    try {
      await createTaskLink(taskId, parsed.data);
      setLinkAddValues(EMPTY_TASK_LINK_FORM);
      await refresh();
    } catch (error) {
      setLinkAddError(errorMessage(error, 'Could not add the link.'));
    } finally {
      setLinkAdding(false);
    }
  };

  const handleLinkStartEdit = (link: TaskLink): void => {
    setLinkEditingId(link.id);
    setLinkEditValues({ label: link.label, url: link.url });
    setLinkEditError(null);
    setLinkActionError(null);
  };

  const handleLinkSaveEdit = async (): Promise<void> => {
    if (linkEditingId === null) return;
    const original = linksQuery.data?.find((link) => link.id === linkEditingId);
    if (!original) {
      setLinkEditError('That link is no longer in this list. Reload and try again.');
      return;
    }

    const patch: Record<string, unknown> = {};
    if (linkEditValues.label !== original.label) patch.label = linkEditValues.label;
    if (linkEditValues.url !== original.url) patch.url = linkEditValues.url;
    if (Object.keys(patch).length === 0) {
      setLinkEditError('Nothing to update: change a field before saving.');
      return;
    }

    const parsed = updateTaskLinkSchema.safeParse(patch);
    if (!parsed.success) {
      setLinkEditError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setLinkSavingEdit(true);
    setLinkEditError(null);
    try {
      await updateTaskLink(linkEditingId, parsed.data);
      setLinkEditingId(null);
      await refresh();
    } catch (error) {
      setLinkEditError(errorMessage(error, 'Could not update the link.'));
    } finally {
      setLinkSavingEdit(false);
    }
  };

  const runLinkAction = async (linkId: number, action: (id: number) => Promise<unknown>): Promise<void> => {
    setLinkBusyId(linkId);
    setLinkActionError(null);
    try {
      await action(linkId);
      await refresh();
    } catch (error) {
      setLinkActionError(errorMessage(error, 'That change did not go through.'));
    } finally {
      setLinkBusyId(null);
    }
  };

  const handleCriterionAdd = async (): Promise<void> => {
    if (!taskIdValid) return;
    const parsed = createCriterionSchema.safeParse(criterionAddValues);
    if (!parsed.success) {
      setCriterionAddError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setCriterionAdding(true);
    setCriterionAddError(null);
    try {
      await createCriterion(taskId, parsed.data);
      setCriterionAddValues(EMPTY_CRITERION_FORM);
      await refresh();
    } catch (error) {
      setCriterionAddError(errorMessage(error, 'Could not add the criterion.'));
    } finally {
      setCriterionAdding(false);
    }
  };

  const handleCriterionStartEdit = (criterion: Criterion): void => {
    setCriterionEditingId(criterion.id);
    setCriterionEditValues({ text: criterion.text });
    setCriterionEditError(null);
    setCriterionActionError(null);
  };

  const handleCriterionSaveEdit = async (): Promise<void> => {
    if (criterionEditingId === null) return;
    const original = criteriaQuery.data?.find((criterion) => criterion.id === criterionEditingId);
    if (!original) {
      setCriterionEditError('That criterion is no longer in this list. Reload and try again.');
      return;
    }
    if (criterionEditValues.text === original.text) {
      setCriterionEditError('Nothing to update: change the statement before saving.');
      return;
    }

    const parsed = updateCriterionSchema.safeParse(criterionEditValues);
    if (!parsed.success) {
      setCriterionEditError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setCriterionSavingEdit(true);
    setCriterionEditError(null);
    try {
      await updateCriterion(criterionEditingId, parsed.data);
      setCriterionEditingId(null);
      await refresh();
    } catch (error) {
      setCriterionEditError(errorMessage(error, 'Could not update the criterion.'));
    } finally {
      setCriterionSavingEdit(false);
    }
  };

  const handleCriterionMove = async (criterionId: number, direction: -1 | 1): Promise<void> => {
    if (!taskIdValid) return;
    const order = (criteriaQuery.data ?? []).map((criterion) => criterion.id);
    const index = order.indexOf(criterionId);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= order.length) return;
    const next = [...order];
    [next[index], next[swapWith]] = [next[swapWith] as number, next[index] as number];
    setCriterionBusyId(criterionId);
    setCriterionActionError(null);
    try {
      await reorderCriteria(taskId, next as number[]);
      await refresh();
    } catch (error) {
      setCriterionActionError(errorMessage(error, 'Could not reorder the criteria.'));
    } finally {
      setCriterionBusyId(null);
    }
  };

  const runCriterionAction = async (
    criterionId: number,
    action: (id: number) => Promise<unknown>,
  ): Promise<void> => {
    setCriterionBusyId(criterionId);
    setCriterionActionError(null);
    try {
      await action(criterionId);
      await refresh();
    } catch (error) {
      setCriterionActionError(errorMessage(error, 'That change did not go through.'));
    } finally {
      setCriterionBusyId(null);
    }
  };

  /** Form strings to schema input. An empty URL is `null`: no URL, not a blank one. */
  const toReferenceInput = (values: ReferenceFormValues): Record<string, unknown> => ({
    title: values.title,
    body: values.body,
    url: values.url.trim() === '' ? null : values.url,
    type: values.type,
  });

  const handleReferenceAdd = async (): Promise<void> => {
    if (!taskIdValid) return;
    const parsed = createReferenceSchema.safeParse(toReferenceInput(referenceAddValues));
    if (!parsed.success) {
      setReferenceAddError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setReferenceAdding(true);
    setReferenceAddError(null);
    try {
      await createReference(taskId, parsed.data);
      setReferenceAddValues(EMPTY_REFERENCE_FORM);
      await refresh();
    } catch (error) {
      setReferenceAddError(errorMessage(error, 'Could not add the reference.'));
    } finally {
      setReferenceAdding(false);
    }
  };

  const handleReferenceStartEdit = (reference: Reference): void => {
    setReferenceEditingId(reference.id);
    setReferenceEditValues({
      title: reference.title,
      body: reference.body,
      url: reference.url ?? '',
      type: reference.type as ReferenceType,
    });
    setReferenceEditError(null);
    setReferenceActionError(null);
  };

  const handleReferenceSaveEdit = async (): Promise<void> => {
    if (referenceEditingId === null) return;
    const original = referencesQuery.data?.find((reference) => reference.id === referenceEditingId);
    if (!original) {
      setReferenceEditError('That reference is no longer in this list. Reload and try again.');
      return;
    }

    const values = toReferenceInput(referenceEditValues);
    const patch: Record<string, unknown> = {};
    if (values.title !== original.title) patch.title = values.title;
    if (values.body !== original.body) patch.body = values.body;
    if (values.url !== original.url) patch.url = values.url;
    if (values.type !== original.type) patch.type = values.type;
    if (Object.keys(patch).length === 0) {
      setReferenceEditError('Nothing to update: change a field before saving.');
      return;
    }

    const parsed = updateReferenceSchema.safeParse(patch);
    if (!parsed.success) {
      setReferenceEditError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setReferenceSavingEdit(true);
    setReferenceEditError(null);
    try {
      await updateReference(referenceEditingId, parsed.data);
      setReferenceEditingId(null);
      await refresh();
    } catch (error) {
      setReferenceEditError(errorMessage(error, 'Could not update the reference.'));
    } finally {
      setReferenceSavingEdit(false);
    }
  };

  const runReferenceAction = async (
    referenceId: number,
    action: (id: number) => Promise<unknown>,
  ): Promise<void> => {
    setReferenceBusyId(referenceId);
    setReferenceActionError(null);
    try {
      await action(referenceId);
      await refresh();
    } catch (error) {
      setReferenceActionError(errorMessage(error, 'That change did not go through.'));
    } finally {
      setReferenceBusyId(null);
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
              linksProps={{
                links: linksQuery.data,
                loading: linksQuery.isPending,
                loadError: linksQuery.error
                  ? errorMessage(linksQuery.error, 'Could not load links.')
                  : null,
                addValues: linkAddValues,
                onAddChange: setLinkAddValues,
                onAdd: () => void handleLinkAdd(),
                addError: linkAddError,
                adding: linkAdding,
                editingId: linkEditingId,
                editValues: linkEditValues,
                onEditChange: setLinkEditValues,
                onStartEdit: handleLinkStartEdit,
                onCancelEdit: () => {
                  setLinkEditingId(null);
                  setLinkEditError(null);
                },
                onSaveEdit: () => void handleLinkSaveEdit(),
                editError: linkEditError,
                savingEdit: linkSavingEdit,
                onArchive: (linkId) => void runLinkAction(linkId, archiveTaskLink),
                onRestore: (linkId) => void runLinkAction(linkId, restoreTaskLink),
                busyId: linkBusyId,
                actionError: linkActionError,
              }}
              criteriaProps={{
                criteria: criteriaQuery.data,
                loading: criteriaQuery.isPending,
                loadError: criteriaQuery.error
                  ? errorMessage(criteriaQuery.error, 'Could not load acceptance criteria.')
                  : null,
                showArchived: showArchivedCriteria,
                onToggleShowArchived: setShowArchivedCriteria,
                addValues: criterionAddValues,
                onAddChange: setCriterionAddValues,
                onAdd: () => void handleCriterionAdd(),
                addError: criterionAddError,
                adding: criterionAdding,
                editingId: criterionEditingId,
                editValues: criterionEditValues,
                onEditChange: setCriterionEditValues,
                onStartEdit: handleCriterionStartEdit,
                onCancelEdit: () => {
                  setCriterionEditingId(null);
                  setCriterionEditError(null);
                },
                onSaveEdit: () => void handleCriterionSaveEdit(),
                editError: criterionEditError,
                savingEdit: criterionSavingEdit,
                onMove: (criterionId, direction) => void handleCriterionMove(criterionId, direction),
                onArchive: (criterionId) => void runCriterionAction(criterionId, archiveCriterion),
                onRestore: (criterionId) => void runCriterionAction(criterionId, restoreCriterion),
                busyId: criterionBusyId,
                actionError: criterionActionError,
              }}
              referencesProps={{
                references: referencesQuery.data,
                loading: referencesQuery.isPending,
                loadError: referencesQuery.error
                  ? errorMessage(referencesQuery.error, 'Could not load references.')
                  : null,
                addValues: referenceAddValues,
                onAddChange: setReferenceAddValues,
                onAdd: () => void handleReferenceAdd(),
                addError: referenceAddError,
                adding: referenceAdding,
                editingId: referenceEditingId,
                editValues: referenceEditValues,
                onEditChange: setReferenceEditValues,
                onStartEdit: handleReferenceStartEdit,
                onCancelEdit: () => {
                  setReferenceEditingId(null);
                  setReferenceEditError(null);
                },
                onSaveEdit: () => void handleReferenceSaveEdit(),
                editError: referenceEditError,
                savingEdit: referenceSavingEdit,
                onArchive: (referenceId) => void runReferenceAction(referenceId, archiveReference),
                onRestore: (referenceId) => void runReferenceAction(referenceId, restoreReference),
                busyId: referenceBusyId,
                actionError: referenceActionError,
              }}
              history={historyQuery.data}
              historyLoading={historyQuery.isPending}
              historyError={
                historyQuery.error ? errorMessage(historyQuery.error, 'Could not load history.') : null
              }
              timeZone={health?.time_zone}
            />
          )}
        </main>
      </div>
    </div>
  );
}
