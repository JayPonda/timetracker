import type { JSX } from 'react';
import type { Project } from '@pdm/shared';

/**
 * The projects screen, split from its data for the same reason as
 * `HealthSummary`: what must be right here is presentation — archived rows are
 * labelled in words, there is no Delete button, and a rejected save leaves the
 * typed values where they are — so it renders from props and is asserted without
 * a browser, a fetch stub or a query cache.
 */

export interface ProjectFormValues {
  name: string;
  description: string;
  colour: string;
}

export interface ProjectsViewProps {
  readonly projects: readonly Project[] | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly showArchived: boolean;
  readonly onToggleShowArchived: (show: boolean) => void;
  readonly createValues: ProjectFormValues;
  readonly onCreateChange: (values: ProjectFormValues) => void;
  readonly onCreate: () => void;
  readonly createError: string | null;
  readonly creating: boolean;
  readonly editingId: number | null;
  readonly editValues: ProjectFormValues;
  readonly onEditChange: (values: ProjectFormValues) => void;
  readonly onStartEdit: (project: Project) => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: () => void;
  readonly editError: string | null;
  readonly savingEdit: boolean;
  readonly onArchive: (id: number) => void;
  readonly onRestore: (id: number) => void;
  readonly busyId: number | null;
  readonly actionError: string | null;
}

export function ProjectsView(props: ProjectsViewProps): JSX.Element {
  const {
    projects,
    loading,
    loadError,
    showArchived,
    onToggleShowArchived,
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
    onArchive,
    onRestore,
    busyId,
    actionError,
  } = props;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">Projects</h2>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => onToggleShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>

      <section aria-label="Create a project" className="mt-4 rounded border border-neutral-200 dark:border-neutral-800 p-4">
        <h3 className="text-sm font-medium">New project</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="new-project-name" className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Name
            </label>
            <input
              id="new-project-name"
              className="mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
              value={createValues.name}
              onChange={(event) => onCreateChange({ ...createValues, name: event.target.value })}
              placeholder="Client work"
            />
          </div>
          <div>
            <label htmlFor="new-project-colour" className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Colour
            </label>
            <input
              id="new-project-colour"
              className="mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
              value={createValues.colour}
              onChange={(event) => onCreateChange({ ...createValues, colour: event.target.value })}
              placeholder="#6b7280"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              disabled={creating}
              onClick={onCreate}
              className="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="new-project-description" className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Description
          </label>
          <textarea
            id="new-project-description"
            className="mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
            value={createValues.description}
            onChange={(event) => onCreateChange({ ...createValues, description: event.target.value })}
            rows={2}
          />
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

      {loading ? <p className="mt-4 text-sm text-neutral-500">Loading projects…</p> : null}
      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && (projects ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          {showArchived ? 'No projects yet.' : 'No live projects. Create one above, or turn on “Show archived”.'}
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {(projects ?? []).map((project) => {
          const archived = project.archived_at !== null;
          const busy = busyId === project.id;
          return (
            <li key={project.id} className="rounded border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-full border border-neutral-400"
                      style={{ backgroundColor: project.colour }}
                    />
                    <h3 className="text-sm font-medium">{project.name}</h3>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      Status: {archived ? 'Archived' : 'Active'}
                    </span>
                  </div>
                  {project.description ? (
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{project.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onStartEdit(project)}
                      className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50"
                    >
                      Edit
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onArchive(project.id)}
                      className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50"
                    >
                      {busy ? 'Archiving…' : 'Archive'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRestore(project.id)}
                      className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50"
                    >
                      {busy ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>

              {editingId === project.id && !archived ? (
                <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                  <h4 className="text-xs font-medium">Edit project</h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`edit-project-name-${project.id}`} className="block text-xs text-neutral-600 dark:text-neutral-300">
                        Name
                      </label>
                      <input
                        id={`edit-project-name-${project.id}`}
                        className="mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
                        value={editValues.name}
                        onChange={(event) => onEditChange({ ...editValues, name: event.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edit-project-colour-${project.id}`} className="block text-xs text-neutral-600 dark:text-neutral-300">
                        Colour
                      </label>
                      <input
                        id={`edit-project-colour-${project.id}`}
                        className="mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
                        value={editValues.colour}
                        onChange={(event) => onEditChange({ ...editValues, colour: event.target.value })}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={onSaveEdit}
                        className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50"
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={onCancelEdit}
                        className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-xs disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <label htmlFor={`edit-project-description-${project.id}`} className="block text-xs text-neutral-600 dark:text-neutral-300">
                      Description
                    </label>
                    <textarea
                      id={`edit-project-description-${project.id}`}
                      className="mt-1 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
                      value={editValues.description}
                      onChange={(event) => onEditChange({ ...editValues, description: event.target.value })}
                      rows={2}
                    />
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
