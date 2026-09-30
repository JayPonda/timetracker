import type { JSX } from 'react';
import type { Task, Todo } from '@pdm/shared';
import { TaskCriteria, type TaskCriteriaProps } from './TaskCriteria';
import { TaskLinks, type TaskLinksProps } from './TaskLinks';
import { TaskReferences, type TaskReferencesProps } from './TaskReferences';

/**
 * The task detail screen, split from its data like every other screen: what
 * must be right here is presentation — phases in timeline order, done in words
 * as well as in a checkbox, no Delete button — so it renders from props and is
 * asserted without a browser.
 *
 * Reorder is up/down buttons, not drag and drop. That is deliberate twice over:
 * every control must work from the keyboard (`UI-07`), which drag and drop does
 * not, and a button moves one step with a complete order behind it, which is
 * exactly what the reorder endpoint requires.
 */

export interface TodoFormValues {
  title: string;
  note: string;
  estimateHours: string;
}

export const EMPTY_TODO_FORM: TodoFormValues = { title: '', note: '', estimateHours: '' };

export interface TaskDetailViewProps {
  readonly task: Task | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly todos: readonly Todo[] | undefined;
  readonly todosLoading: boolean;
  readonly todosError: string | null;
  readonly showArchivedTodos: boolean;
  readonly onToggleShowArchivedTodos: (show: boolean) => void;
  readonly addValues: TodoFormValues;
  readonly onAddChange: (values: TodoFormValues) => void;
  readonly onAdd: () => void;
  readonly addError: string | null;
  readonly adding: boolean;
  readonly editingId: number | null;
  readonly editValues: TodoFormValues;
  readonly onEditChange: (values: TodoFormValues) => void;
  readonly onStartEdit: (todo: Todo) => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: () => void;
  readonly editError: string | null;
  readonly savingEdit: boolean;
  readonly onTick: (todo: Todo) => void;
  readonly onMove: (id: number, direction: -1 | 1) => void;
  readonly onArchive: (id: number) => void;
  readonly onRestore: (id: number) => void;
  readonly busyId: number | null;
  readonly actionError: string | null;
  readonly linksProps: TaskLinksProps;
  readonly criteriaProps: TaskCriteriaProps;
  readonly referencesProps: TaskReferencesProps;
}

const inputClass =
  'mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm';
const labelClass = 'block text-xs font-medium text-neutral-600 dark:text-neutral-300';
const buttonClass =
  'px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50';

export function TaskDetailView(props: TaskDetailViewProps): JSX.Element {
  const {
    task,
    loading,
    loadError,
    todos,
    todosLoading,
    todosError,
    showArchivedTodos,
    onToggleShowArchivedTodos,
    addValues,
    onAddChange,
    onAdd,
    addError,
    adding,
    editingId,
    editValues,
    onEditChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    editError,
    savingEdit,
    onTick,
    onMove,
    onArchive,
    onRestore,
    busyId,
    actionError,
    linksProps,
    criteriaProps,
    referencesProps,
  } = props;

  if (loading) return <p className="mt-4 text-sm text-neutral-500">Loading the task…</p>;
  if (loadError)
    return (
      <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
        {loadError}
      </p>
    );
  if (!task) return <p className="mt-4 text-sm text-neutral-500">That task is not here.</p>;

  return (
    <div>
      <h2 className="text-lg font-medium">{task.name}</h2>
      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        {task.project_name ?? 'No project'} · Status:{' '}
        {task.status === 'in_progress' ? 'In progress' : task.status === 'ended' ? 'Ended' : 'Open'}
        {task.score !== null ? ` · Score: ${task.score}` : ''}
        {task.estimate_hours !== null ? ` · Estimate: ${task.estimate_hours}h` : ''}
        {task.archived_at !== null ? ' · Archived' : ''}
      </p>
      {task.description ? (
        <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
          {task.description}
        </p>
      ) : null}

      <section aria-label="Todos" className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-medium">Todos — the phases of this task</h3>
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={showArchivedTodos}
              onChange={(event) => onToggleShowArchivedTodos(event.target.checked)}
            />
            Show archived
          </label>
        </div>

        <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-4">
          <h4 className="text-xs font-medium">New todo</h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="new-todo-title" className={labelClass}>
                Title
              </label>
              <input
                id="new-todo-title"
                className={inputClass}
                value={addValues.title}
                onChange={(event) => onAddChange({ ...addValues, title: event.target.value })}
                placeholder="Draft the outline"
              />
            </div>
            <div>
              <label htmlFor="new-todo-estimate" className={labelClass}>
                Estimate (h)
              </label>
              <input
                id="new-todo-estimate"
                className={inputClass}
                value={addValues.estimateHours}
                onChange={(event) => onAddChange({ ...addValues, estimateHours: event.target.value })}
                placeholder="—"
                inputMode="decimal"
              />
            </div>
          </div>
          <div className="mt-2">
            <label htmlFor="new-todo-note" className={labelClass}>
              Note
            </label>
            <textarea
              id="new-todo-note"
              className={inputClass}
              value={addValues.note}
              onChange={(event) => onAddChange({ ...addValues, note: event.target.value })}
              rows={2}
            />
          </div>
          <div className="mt-2">
            <button
              type="button"
              disabled={adding}
              onClick={onAdd}
              className="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add todo'}
            </button>
          </div>
          {addError ? (
            <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
              {addError}
            </p>
          ) : null}
        </div>

        {actionError ? (
          <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
            {actionError}
          </p>
        ) : null}
        {todosLoading ? <p className="mt-4 text-sm text-neutral-500">Loading todos…</p> : null}
        {todosError ? (
          <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
            {todosError}
          </p>
        ) : null}
        {!todosLoading && !todosError && (todos ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
            No phases yet. Add the first one above.
          </p>
        ) : null}

        <ol className="mt-4 space-y-2">
          {(todos ?? []).map((todo, index) => {
            const archived = todo.archived_at !== null;
            const busy = busyId === todo.id;
            return (
              <li
                key={todo.id}
                className="rounded border border-neutral-200 dark:border-neutral-800 p-3"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Mark “${todo.title}” ${todo.done ? 'not done' : 'done'}`}
                    checked={todo.done}
                    disabled={busy || archived}
                    onChange={() => onTick(todo)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {todo.title}{' '}
                      <span className="font-normal text-xs text-neutral-500 dark:text-neutral-400">
                        ({todo.done ? 'Done' : 'Not done'}
                        {archived ? ', Archived' : ''})
                      </span>
                    </p>
                    {todo.note ? (
                      <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
                        {todo.note}
                      </p>
                    ) : null}
                    {todo.estimate_hours !== null ? (
                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        Estimate: {todo.estimate_hours}h
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {!archived ? (
                      <button
                        type="button"
                        disabled={busy || index === 0}
                        onClick={() => onMove(todo.id, -1)}
                        className={buttonClass}
                        title="Move earlier"
                      >
                        ↑
                      </button>
                    ) : null}
                    {!archived ? (
                      <button
                        type="button"
                        disabled={busy || index === (todos ?? []).length - 1}
                        onClick={() => onMove(todo.id, 1)}
                        className={buttonClass}
                        title="Move later"
                      >
                        ↓
                      </button>
                    ) : null}
                    {!archived ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onStartEdit(todo)}
                        className={buttonClass}
                      >
                        Edit
                      </button>
                    ) : null}
                    {!archived ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onArchive(todo.id)}
                        className={buttonClass}
                      >
                        {busy ? 'Archiving…' : 'Archive'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRestore(todo.id)}
                        className={buttonClass}
                      >
                        {busy ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </div>
                </div>

                {editingId === todo.id && !archived ? (
                  <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                    <h4 className="text-xs font-medium">Edit todo</h4>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <label htmlFor={`edit-todo-title-${todo.id}`} className={labelClass}>
                          Title
                        </label>
                        <input
                          id={`edit-todo-title-${todo.id}`}
                          className={inputClass}
                          value={editValues.title}
                          onChange={(event) =>
                            onEditChange({ ...editValues, title: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor={`edit-todo-estimate-${todo.id}`} className={labelClass}>
                          Estimate (h)
                        </label>
                        <input
                          id={`edit-todo-estimate-${todo.id}`}
                          className={inputClass}
                          value={editValues.estimateHours}
                          onChange={(event) =>
                            onEditChange({ ...editValues, estimateHours: event.target.value })
                          }
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label htmlFor={`edit-todo-note-${todo.id}`} className={labelClass}>
                        Note
                      </label>
                      <textarea
                        id={`edit-todo-note-${todo.id}`}
                        className={inputClass}
                        value={editValues.note}
                        onChange={(event) =>
                          onEditChange({ ...editValues, note: event.target.value })
                        }
                        rows={2}
                      />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={onSaveEdit}
                        className={buttonClass}
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={onCancelEdit}
                        className={buttonClass}
                      >
                        Cancel
                      </button>
                    </div>
                    {editError ? (
                      <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
                        {editError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mt-6">
        <TaskLinks {...linksProps} />
      </div>

      <div className="mt-6">
        <TaskCriteria {...criteriaProps} />
      </div>

      <div className="mt-6">
        <TaskReferences {...referencesProps} />
      </div>
    </div>
  );
}
