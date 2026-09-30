import type { JSX } from 'react';
import type { Tag } from '@pdm/shared';

/**
 * The tag manager, split from its data like every other screen: what must be
 * right here is presentation — one live tag per name, archived rows labelled
 * in words, no Delete button, a rejected save that keeps what was typed — so
 * it renders from props and is asserted without a browser.
 */

export interface TagFormValues {
  name: string;
  colour: string;
}

export const EMPTY_TAG_FORM: TagFormValues = { name: '', colour: '#6b7280' };

export interface TagsViewProps {
  readonly tags: readonly Tag[] | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly showArchived: boolean;
  readonly onToggleShowArchived: (show: boolean) => void;
  readonly createValues: TagFormValues;
  readonly onCreateChange: (values: TagFormValues) => void;
  readonly onCreate: () => void;
  readonly createError: string | null;
  readonly creating: boolean;
  readonly editingId: number | null;
  readonly editValues: TagFormValues;
  readonly onEditChange: (values: TagFormValues) => void;
  readonly onStartEdit: (tag: Tag) => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: () => void;
  readonly editError: string | null;
  readonly savingEdit: boolean;
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

export function TagsView(props: TagsViewProps): JSX.Element {
  const {
    tags,
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
        <h2 className="text-lg font-medium">Tags</h2>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => onToggleShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        One live tag per name. Archiving hides a tag from pickers; it stays on its entries.
      </p>

      <section aria-label="Create a tag" className="mt-4 rounded border border-neutral-200 dark:border-neutral-800 p-4">
        <h3 className="text-sm font-medium">New tag</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="new-tag-name" className={labelClass}>
              Name
            </label>
            <input
              id="new-tag-name"
              className={inputClass}
              value={createValues.name}
              onChange={(event) => onCreateChange({ ...createValues, name: event.target.value })}
              placeholder="review"
            />
          </div>
          <div>
            <label htmlFor="new-tag-colour" className={labelClass}>
              Colour
            </label>
            <input
              id="new-tag-colour"
              className={inputClass}
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
              {creating ? 'Creating…' : 'Create tag'}
            </button>
          </div>
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

      {loading ? <p className="mt-4 text-sm text-neutral-500">Loading tags…</p> : null}
      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && (tags ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          {showArchived ? 'No tags yet.' : 'No live tags. Create one above, or turn on “Show archived”.'}
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {(tags ?? []).map((tag) => {
          const archived = tag.archived_at !== null;
          const busy = busyId === tag.id;
          return (
            <li key={tag.id} className="rounded border border-neutral-200 dark:border-neutral-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 rounded-full border border-neutral-400"
                    style={{ backgroundColor: tag.colour }}
                  />
                  <p className="text-sm font-medium">{tag.name}</p>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    Status: {archived ? 'Archived' : 'Active'}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onStartEdit(tag)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onArchive(tag.id)}
                      className={buttonClass}
                    >
                      {busy ? 'Archiving…' : 'Archive'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRestore(tag.id)}
                      className={buttonClass}
                    >
                      {busy ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>

              {editingId === tag.id && !archived ? (
                <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                  <h4 className="text-xs font-medium">Edit tag</h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`edit-tag-name-${tag.id}`} className={labelClass}>
                        Name
                      </label>
                      <input
                        id={`edit-tag-name-${tag.id}`}
                        className={inputClass}
                        value={editValues.name}
                        onChange={(event) => onEditChange({ ...editValues, name: event.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edit-tag-colour-${tag.id}`} className={labelClass}>
                        Colour
                      </label>
                      <input
                        id={`edit-tag-colour-${tag.id}`}
                        className={inputClass}
                        value={editValues.colour}
                        onChange={(event) => onEditChange({ ...editValues, colour: event.target.value })}
                      />
                    </div>
                    <div className="flex items-end gap-2">
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
