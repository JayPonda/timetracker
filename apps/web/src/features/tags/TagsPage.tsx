import { useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTagSchema, updateTagSchema, type Tag } from '@pdm/shared';
import { Sidebar } from '../../components/Sidebar';
import { EMPTY_TAG_FORM, TagsView, type TagFormValues } from './TagsView';
import { archiveTag, createTag, fetchTags, restoreTag, updateTag } from './api';

/**
 * The tag manager (`FR-TAG-01`, `FR-TAG-05`, `UI-04/08/17`).
 *
 * Data and field state live here; `TagsView` renders. A rejected save — a
 * taken name above all — sets an error and leaves every typed value where it
 * is (`UI-08`). Tagging entries themselves waits for entries in 0.3.0; this
 * screen manages the names those entries will use.
 */

// Shared with the view: no mutation happens here — every change spreads — so
// one frozen-shaped constant serves as both the initial and the reset value.
const EMPTY_FORM: TagFormValues = EMPTY_TAG_FORM;

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

export function TagsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [createValues, setCreateValues] = useState<TagFormValues>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<TagFormValues>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tagsQuery = useQuery({
    queryKey: ['tags', showArchived],
    queryFn: ({ signal }) => fetchTags(signal, showArchived),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
  };

  const handleCreate = async (): Promise<void> => {
    const parsed = createTagSchema.safeParse(createValues);
    if (!parsed.success) {
      setCreateError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      await createTag(parsed.data);
      setCreateValues(EMPTY_FORM);
      await refresh();
    } catch (error) {
      setCreateError(errorMessage(error, 'Could not create the tag.'));
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = (tag: Tag): void => {
    setEditingId(tag.id);
    setEditValues({ name: tag.name, colour: tag.colour });
    setEditError(null);
    setActionError(null);
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (editingId === null) return;
    const original = tagsQuery.data?.find((tag) => tag.id === editingId);
    if (!original) {
      setEditError('That tag is no longer in this list. Reload and try again.');
      return;
    }

    const patch: Record<string, unknown> = {};
    if (editValues.name !== original.name) patch.name = editValues.name;
    if (editValues.colour !== original.colour) patch.colour = editValues.colour;
    if (Object.keys(patch).length === 0) {
      setEditError('Nothing to update: change a field before saving.');
      return;
    }

    const parsed = updateTagSchema.safeParse(patch);
    if (!parsed.success) {
      setEditError(firstIssueMessage(toIssues(parsed.error)));
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      await updateTag(editingId, parsed.data);
      setEditingId(null);
      await refresh();
    } catch (error) {
      setEditError(errorMessage(error, 'Could not update the tag.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const runAction = async (id: number, action: (tagId: number) => Promise<unknown>): Promise<void> => {
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
          <h1 className="font-semibold">Tags</h1>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            create, rename, archive, restore
          </span>
        </header>
        <main className="flex-1 p-6">
          <TagsView
            tags={tagsQuery.data}
            loading={tagsQuery.isPending}
            loadError={
              tagsQuery.error ? errorMessage(tagsQuery.error, 'Could not load tags.') : null
            }
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
            onArchive={(id) => void runAction(id, archiveTag)}
            onRestore={(id) => void runAction(id, restoreTag)}
            busyId={busyId}
            actionError={actionError}
          />
        </main>
      </div>
    </div>
  );
}
