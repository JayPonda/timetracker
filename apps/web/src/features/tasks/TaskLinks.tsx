import type { JSX } from 'react';
import type { TaskLink } from '@pdm/shared';

/**
 * The links section of the task detail page, split from its data like every
 * other screen: what must be right here is presentation — at most three slots,
 * a refused fourth that says so, no Delete button — so it renders from props
 * and is asserted without a browser.
 */

export interface TaskLinkFormValues {
  label: string;
  url: string;
}

export const EMPTY_TASK_LINK_FORM: TaskLinkFormValues = { label: '', url: '' };

export interface TaskLinksProps {
  readonly links: readonly TaskLink[] | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly addValues: TaskLinkFormValues;
  readonly onAddChange: (values: TaskLinkFormValues) => void;
  readonly onAdd: () => void;
  readonly addError: string | null;
  readonly adding: boolean;
  readonly editingId: number | null;
  readonly editValues: TaskLinkFormValues;
  readonly onEditChange: (values: TaskLinkFormValues) => void;
  readonly onStartEdit: (link: TaskLink) => void;
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

export function TaskLinks(props: TaskLinksProps): JSX.Element {
  const {
    links,
    loading,
    loadError,
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
    onArchive,
    onRestore,
    busyId,
    actionError,
  } = props;

  const live = (links ?? []).filter((link) => link.archived_at === null);

  return (
    <section aria-label="Links">
      <h3 className="text-sm font-medium">Links — at most three per task</h3>

      <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-4">
        <h4 className="text-xs font-medium">New link</h4>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="new-link-label" className={labelClass}>
              Label
            </label>
            <input
              id="new-link-label"
              className={inputClass}
              value={addValues.label}
              onChange={(event) => onAddChange({ ...addValues, label: event.target.value })}
              placeholder="Spec"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="new-link-url" className={labelClass}>
              URL
            </label>
            <input
              id="new-link-url"
              className={inputClass}
              value={addValues.url}
              onChange={(event) => onAddChange({ ...addValues, url: event.target.value })}
              placeholder="https://example.com/spec"
              inputMode="url"
            />
          </div>
        </div>
        <div className="mt-2">
          <button
            type="button"
            disabled={adding}
            onClick={onAdd}
            className="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add link'}
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
      {loading ? <p className="mt-4 text-sm text-neutral-500">Loading links…</p> : null}
      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      ) : null}
      {!loading && !loadError && live.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          No links yet. Add the first one above.
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {live.map((link) => {
          const busy = busyId === link.id;
          return (
            <li key={link.id} className="rounded border border-neutral-200 dark:border-neutral-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium underline"
                  >
                    {link.label || link.url}
                  </a>
                  {link.label ? (
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 break-all">
                      {link.url}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onStartEdit(link)}
                    className={buttonClass}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onArchive(link.id)}
                    className={buttonClass}
                  >
                    {busy ? 'Archiving…' : 'Archive'}
                  </button>
                </div>
              </div>

              {editingId === link.id ? (
                <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                  <h4 className="text-xs font-medium">Edit link</h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`edit-link-label-${link.id}`} className={labelClass}>
                        Label
                      </label>
                      <input
                        id={`edit-link-label-${link.id}`}
                        className={inputClass}
                        value={editValues.label}
                        onChange={(event) =>
                          onEditChange({ ...editValues, label: event.target.value })
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`edit-link-url-${link.id}`} className={labelClass}>
                        URL
                      </label>
                      <input
                        id={`edit-link-url-${link.id}`}
                        className={inputClass}
                        value={editValues.url}
                        onChange={(event) =>
                          onEditChange({ ...editValues, url: event.target.value })
                        }
                        inputMode="url"
                      />
                    </div>
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

      {(links ?? []).some((link) => link.archived_at !== null) ? (
        <div className="mt-4">
          <h4 className="text-xs font-medium">Archived links</h4>
          <ul className="mt-2 space-y-2">
            {(links ?? [])
              .filter((link) => link.archived_at !== null)
              .map((link) => (
                <li
                  key={link.id}
                  className="flex items-center justify-between gap-3 rounded border border-neutral-200 dark:border-neutral-800 p-3 text-sm"
                >
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {link.label || link.url} (Archived)
                  </span>
                  <button
                    type="button"
                    disabled={busyId === link.id}
                    onClick={() => onRestore(link.id)}
                    className={buttonClass}
                  >
                    {busyId === link.id ? 'Restoring…' : 'Restore'}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
