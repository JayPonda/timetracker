import type { JSX } from 'react';
import type { Project, Task } from '@pdm/shared';
import type { TaskFilters } from './api';

/**
 * The tasks screen, split from its data for the same reason as `ProjectsView`:
 * what must be right here is presentation — status in words, archived rows
 * labelled, no Delete button, no End button, a rejected save that keeps what
 * was typed — so it renders from props and is asserted without a browser.
 *
 * **No timer Start button yet.** `FR-VIEW-01` wants one per row, but a Start
 * button that does not start a timer is a lie, and the timer is 0.3.0. It
 * arrives with the thing it starts.
 */

export interface TaskFormValues {
  name: string;
  description: string;
  projectId: number | null;
  score: string;
  estimateHours: string;
}

export const EMPTY_TASK_FORM: TaskFormValues = {
  name: '',
  description: '',
  projectId: null,
  score: '',
  estimateHours: '',
};

export interface TasksViewProps {
  readonly tasks: readonly Task[] | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly filters: TaskFilters;
  readonly onFiltersChange: (filters: TaskFilters) => void;
  readonly liveProjects: readonly Project[];
  readonly createValues: TaskFormValues;
  readonly onCreateChange: (values: TaskFormValues) => void;
  readonly onCreate: () => void;
  readonly createError: string | null;
  readonly creating: boolean;
  readonly editingId: number | null;
  readonly editValues: TaskFormValues;
  readonly onEditChange: (values: TaskFormValues) => void;
  readonly onStartEdit: (task: Task) => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: () => void;
  readonly editError: string | null;
  readonly savingEdit: boolean;
  readonly onMoveStatus: (id: number, status: 'open' | 'in_progress') => void;
  readonly onArchive: (id: number) => void;
  readonly onRestore: (id: number) => void;
  readonly busyId: number | null;
  readonly actionError: string | null;
}

const inputClass =
  'mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm';
const labelClass = 'block text-xs font-medium text-neutral-600 dark:text-neutral-300';
const buttonClass =
  'px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50';

function statusWord(status: Task['status']): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'ended') return 'Ended';
  return 'Open';
}

function ProjectSelect({
  id,
  value,
  projects,
  onChange,
}: {
  id: string;
  value: number | null;
  projects: readonly Project[];
  onChange: (value: number | null) => void;
}): JSX.Element {
  return (
    <select
      id={id}
      className={inputClass}
      value={value === null ? 'none' : String(value)}
      onChange={(event) =>
        onChange(event.target.value === 'none' ? null : Number(event.target.value))
      }
    >
      <option value="none">No project</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}

export function TasksView(props: TasksViewProps): JSX.Element {
  const {
    tasks,
    loading,
    loadError,
    filters,
    onFiltersChange,
    liveProjects,
    createValues,
    onCreateChange,
    onCreate,
    createError,
    creating,
    editingId,
    editValues,
    onEditChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    editError,
    savingEdit,
    onMoveStatus,
    onArchive,
    onRestore,
    busyId,
    actionError,
  } = props;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">Tasks</h2>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) => onFiltersChange({ ...filters, includeArchived: event.target.checked })}
          />
          Show archived
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="task-filter-project" className={labelClass}>
            Project
          </label>
          <select
            id="task-filter-project"
            className={inputClass}
            value={
              filters.projectId === 'all'
                ? 'all'
                : filters.projectId === 'none'
                  ? 'none'
                  : String(filters.projectId)
            }
            onChange={(event) => {
              const raw = event.target.value;
              onFiltersChange({
                ...filters,
                projectId: raw === 'all' ? 'all' : raw === 'none' ? 'none' : Number(raw),
              });
            }}
          >
            <option value="all">All projects</option>
            <option value="none">No project</option>
            {liveProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="task-filter-status" className={labelClass}>
            Status
          </label>
          <select
            id="task-filter-status"
            className={inputClass}
            value={filters.status}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                status: event.target.value as TaskFilters['status'],
              })
            }
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
          </select>
        </div>
        <div>
          <label htmlFor="task-filter-sort" className={labelClass}>
            Sort by
          </label>
          <select
            id="task-filter-sort"
            className={inputClass}
            value={filters.sort}
            onChange={(event) =>
              onFiltersChange({ ...filters, sort: event.target.value as TaskFilters['sort'] })
            }
          >
            <option value="created_at">Date created</option>
            <option value="name">Name</option>
            <option value="due_date">Due date</option>
            <option value="score">Score</option>
            <option value="estimate_hours">Estimate</option>
          </select>
        </div>
        <div>
          <label htmlFor="task-filter-direction" className={labelClass}>
            Direction
          </label>
          <select
            id="task-filter-direction"
            className={inputClass}
            value={filters.direction}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                direction: event.target.value as TaskFilters['direction'],
              })
            }
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </div>

      <section aria-label="Create a task" className="mt-4 rounded border border-neutral-200 dark:border-neutral-800 p-4">
        <h3 className="text-sm font-medium">New task</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="new-task-name" className={labelClass}>
              Name
            </label>
            <input
              id="new-task-name"
              className={inputClass}
              value={createValues.name}
              onChange={(event) => onCreateChange({ ...createValues, name: event.target.value })}
              placeholder="Write the spec"
            />
          </div>
          <div>
            <label htmlFor="new-task-project" className={labelClass}>
              Project
            </label>
            <ProjectSelect
              id="new-task-project"
              value={createValues.projectId}
              projects={liveProjects}
              onChange={(projectId) => onCreateChange({ ...createValues, projectId })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-task-score" className={labelClass}>
                Score
              </label>
              <input
                id="new-task-score"
                className={inputClass}
                value={createValues.score}
                onChange={(event) => onCreateChange({ ...createValues, score: event.target.value })}
                placeholder="—"
                inputMode="numeric"
              />
            </div>
            <div>
              <label htmlFor="new-task-estimate" className={labelClass}>
                Estimate (h)
              </label>
              <input
                id="new-task-estimate"
                className={inputClass}
                value={createValues.estimateHours}
                onChange={(event) =>
                  onCreateChange({ ...createValues, estimateHours: event.target.value })
                }
                placeholder="—"
                inputMode="decimal"
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="new-task-description" className={labelClass}>
            Description
          </label>
          <textarea
            id="new-task-description"
            className={inputClass}
            value={createValues.description}
            onChange={(event) => onCreateChange({ ...createValues, description: event.target.value })}
            rows={2}
          />
        </div>
        <div className="mt-3">
          <button
            type="button"
            disabled={creating}
            onClick={onCreate}
            className="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create task'}
          </button>
        </div>
        {createError ? (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
            {createError}
          </p>
        ) : null}
      </section>

      {actionError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </p>
      ) : null}

      {loading ? <p className="mt-4 text-sm text-neutral-500">Loading tasks…</p> : null}
      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && (tasks ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          No tasks match. Create one above, or loosen the filters.
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {(tasks ?? []).map((task) => {
          const archived = task.archived_at !== null;
          const busy = busyId === task.id;
          return (
            <li key={task.id} className="rounded border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{task.name}</h3>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {task.project_name ?? 'No project'} · Status: {statusWord(task.status)}
                    {task.score !== null ? ` · Score: ${task.score}` : ''}
                    {task.estimate_hours !== null ? ` · Estimate: ${task.estimate_hours}h` : ''}
                    {archived ? ' · Archived' : ''}
                  </p>
                  {task.description ? (
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                      {task.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {!archived && task.status === 'open' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onMoveStatus(task.id, 'in_progress')}
                      className={buttonClass}
                    >
                      Move to In progress
                    </button>
                  ) : null}
                  {!archived && task.status === 'in_progress' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onMoveStatus(task.id, 'open')}
                      className={buttonClass}
                    >
                      Move to Open
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onStartEdit(task)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onArchive(task.id)}
                      className={buttonClass}
                    >
                      {busy ? 'Archiving…' : 'Archive'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRestore(task.id)}
                      className={buttonClass}
                    >
                      {busy ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>

              {editingId === task.id && !archived ? (
                <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                  <h4 className="text-xs font-medium">Edit task</h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`edit-task-name-${task.id}`} className={labelClass}>
                        Name
                      </label>
                      <input
                        id={`edit-task-name-${task.id}`}
                        className={inputClass}
                        value={editValues.name}
                        onChange={(event) => onEditChange({ ...editValues, name: event.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edit-task-project-${task.id}`} className={labelClass}>
                        Project
                      </label>
                      <ProjectSelect
                        id={`edit-task-project-${task.id}`}
                        value={editValues.projectId}
                        projects={liveProjects}
                        onChange={(projectId) => onEditChange({ ...editValues, projectId })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`edit-task-score-${task.id}`} className={labelClass}>
                          Score
                        </label>
                        <input
                          id={`edit-task-score-${task.id}`}
                          className={inputClass}
                          value={editValues.score}
                          onChange={(event) =>
                            onEditChange({ ...editValues, score: event.target.value })
                          }
                          inputMode="numeric"
                        />
                      </div>
                      <div>
                        <label htmlFor={`edit-task-estimate-${task.id}`} className={labelClass}>
                          Estimate (h)
                        </label>
                        <input
                          id={`edit-task-estimate-${task.id}`}
                          className={inputClass}
                          value={editValues.estimateHours}
                          onChange={(event) =>
                            onEditChange({ ...editValues, estimateHours: event.target.value })
                          }
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <label htmlFor={`edit-task-description-${task.id}`} className={labelClass}>
                      Description
                    </label>
                    <textarea
                      id={`edit-task-description-${task.id}`}
                      className={inputClass}
                      value={editValues.description}
                      onChange={(event) =>
                        onEditChange({ ...editValues, description: event.target.value })
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
      </ul>
    </div>
  );
}
