import { useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_PROJECT_COLOUR,
  createProjectSchema,
  updateProjectSchema,
  type Project,
} from '@pdm/shared';
import { Sidebar } from '../../components/Sidebar';
import { ProjectsView, type ProjectFormValues } from './ProjectsView';
import { archiveProject, createProject, fetchProjects, restoreProject, updateProject } from './api';

/**
 * The projects screen (`FR-PRJ-01`…`FR-PRJ-04`, `UI-04`, `UI-08`, `UI-17`).
 *
 * This file owns fetching and field state; `ProjectsView` owns presentation.
 * A rejected save sets an error and leaves every typed value where it is. That
 * is the whole of `UI-08` on this screen: the browser never clears a field
 * because the server said no.
 */

const EMPTY_FORM: ProjectFormValues = { name: '', description: '', colour: DEFAULT_PROJECT_COLOUR };

function firstIssueMessage(error: { issues: ReadonlyArray<{ path: string; message: string }> }): string {
  const first = error.issues[0];
  if (!first) return 'That change was not accepted.';
  return `${first.path}: ${first.message}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ProjectsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [createValues, setCreateValues] = useState<ProjectFormValues>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<ProjectFormValues>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', showArchived],
    queryFn: ({ signal }) => fetchProjects(signal, showArchived),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const handleCreate = async (): Promise<void> => {
    const parsed = createProjectSchema.safeParse(createValues);
    if (!parsed.success) {
      setCreateError(firstIssueMessage({ issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
        message: issue.message,
      })) }));
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      await createProject(parsed.data);
      setCreateValues(EMPTY_FORM);
      await refresh();
    } catch (error) {
      // Values stay: clearing the form would destroy what the owner typed, which
      // is exactly what UI-08 forbids.
      setCreateError(errorMessage(error, 'Could not create the project.'));
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = (project: Project): void => {
    setEditingId(project.id);
    setEditValues({ name: project.name, description: project.description, colour: project.colour });
    setEditError(null);
    setActionError(null);
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (editingId === null) return;
    const original = projectsQuery.data?.find((project) => project.id === editingId);
    if (!original) {
      setEditError('That project is no longer in this list. Reload and try again.');
      return;
    }

    const patch: Record<string, string> = {};
    if (editValues.name !== original.name) patch.name = editValues.name;
    if (editValues.description !== original.description) patch.description = editValues.description;
    if (editValues.colour !== original.colour) patch.colour = editValues.colour;
    if (Object.keys(patch).length === 0) {
      setEditError('Nothing to update: change a field before saving.');
      return;
    }

    const parsed = updateProjectSchema.safeParse(patch);
    if (!parsed.success) {
      setEditError(firstIssueMessage({ issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
        message: issue.message,
      })) }));
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      await updateProject(editingId, parsed.data);
      setEditingId(null);
      await refresh();
    } catch (error) {
      setEditError(errorMessage(error, 'Could not update the project.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleArchive = async (id: number): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await archiveProject(id);
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error, 'Could not archive the project.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (id: number): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await restoreProject(id);
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error, 'Could not restore the project.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen flex bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-800 flex items-center px-4 gap-3">
          <h1 className="font-semibold">Projects</h1>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">create, edit, archive, restore</span>
        </header>
        <main className="flex-1 p-6">
          <ProjectsView
            projects={projectsQuery.data}
            loading={projectsQuery.isPending}
            loadError={projectsQuery.error ? errorMessage(projectsQuery.error, 'Could not load projects.') : null}
            showArchived={showArchived}
            onToggleShowArchived={setShowArchived}
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
            onArchive={(id) => void handleArchive(id)}
            onRestore={(id) => void handleRestore(id)}
            busyId={busyId}
            actionError={actionError}
          />
        </main>
      </div>
    </div>
  );
}
