import type { JSX } from 'react';
import type { Reference, ReferenceType } from '@pdm/shared';

/**
 * The references section of the task detail page, split from its data like
 * every other screen: what must be right here is presentation — every item
 * shows its kind in words, archived items sit in their own subsection, no
 * Delete button — so it renders from props and is asserted without a browser.
 */

export interface ReferenceFormValues {
  title: string;
  body: string;
  url: string;
  type: ReferenceType;
}

export const EMPTY_REFERENCE_FORM: ReferenceFormValues = {
  title: '',
  body: '',
  url: '',
  type: 'note',
};

export const REFERENCE_TYPES: readonly ReferenceType[] = [
  'note',
  'link',
  'snippet',
  'lesson',
  'decision',
];

export interface TaskReferencesProps {
  readonly references: readonly Reference[] | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly addValues: ReferenceFormValues;
  readonly onAddChange: (values: ReferenceFormValues) => void;
  readonly onAdd: () => void;
  readonly addError: string | null;
  readonly adding: boolean;
  readonly editingId: number | null;
  readonly editValues: ReferenceFormValues;
  readonly onEditChange: (values: ReferenceFormValues) => void;
  readonly onStartEdit: (reference: Reference) => void;
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

function typeWord(type: ReferenceType): string {
  if (type === 'lesson') return 'Lesson learned';
  return type[0]?.toUpperCase() + type.slice(1);
}

export function TaskReferences(props: TaskReferencesProps): JSX.Element {
  const {
    references,
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

  const live = (references ?? []).filter((reference) => reference.archived_at === null);
  const archived = (references ?? []).filter((reference) => reference.archived_at !== null);

  return (
    <section aria-label="Reference materials">
      <h3 className="text-sm font-medium">Reference materials — what this task teaches later</h3>

      <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-4">
        <h4 className="text-xs font-medium">New reference</h4>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="new-reference-title" className={labelClass}>
              Title
            </label>
            <input
              id="new-reference-title"
              className={inputClass}
              value={addValues.title}
              onChange={(event) => onAddChange({ ...addValues, title: event.target.value })}
              placeholder="What I learned"
            />
          </div>
          <div>
            <label htmlFor="new-reference-type" className={labelClass}>
              Kind
            </label>
            <select
              id="new-reference-type"
              className={inputClass}
              value={addValues.type}
              onChange={(event) =>
                onAddChange({ ...addValues, type: event.target.value as ReferenceType })
              }
            >
              {REFERENCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeWord(type)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-reference-url" className={labelClass}>
              URL (optional)
            </label>
            <input
              id="new-reference-url"
              className={inputClass}
              value={addValues.url}
              onChange={(event) => onAddChange({ ...addValues, url: event.target.value })}
              placeholder="https://…"
              inputMode="url"
            />
          </div>
        </div>
        <div className="mt-2">
          <label htmlFor="new-reference-body" className={labelClass}>
            Body
          </label>
          <textarea
            id="new-reference-body"
            className={inputClass}
            value={addValues.body}
            onChange={(event) => onAddChange({ ...addValues, body: event.target.value })}
            rows={3}
          />
        </div>
        <div className="mt-2">
          <button
            type="button"
            disabled={adding}
            onClick={onAdd}
            className="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add reference'}
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
      {loading ? <p className="mt-4 text-sm text-neutral-500">Loading references…</p> : null}
      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      ) : null}
      {!loading && !loadError && live.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          Nothing kept yet. The first lesson learned here outlives the task.
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {live.map((reference) => {
          const busy = busyId === reference.id;
          return (
            <li
              key={reference.id}
              className="rounded border border-neutral-200 dark:border-neutral-800 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {reference.title}{' '}
                    <span className="font-normal text-xs text-neutral-500 dark:text-neutral-400">
                      ({typeWord(reference.type)})
                    </span>
                  </p>
                  {reference.url ? (
                    <p className="mt-0.5 text-xs break-all">
                      <a
                        href={reference.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-neutral-600 dark:text-neutral-300"
                      >
                        {reference.url}
                      </a>
                    </p>
                  ) : null}
                  {reference.body ? (
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                      {reference.body}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onStartEdit(reference)}
                    className={buttonClass}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onArchive(reference.id)}
                    className={buttonClass}
                  >
                    {busy ? 'Archiving…' : 'Archive'}
                  </button>
                </div>
              </div>

              {editingId === reference.id ? (
                <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                  <h4 className="text-xs font-medium">Edit reference</h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor={`edit-reference-title-${reference.id}`} className={labelClass}>
                        Title
                      </label>
                      <input
                        id={`edit-reference-title-${reference.id}`}
                        className={inputClass}
                        value={editValues.title}
                        onChange={(event) =>
                          onEditChange({ ...editValues, title: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor={`edit-reference-type-${reference.id}`} className={labelClass}>
                        Kind
                      </label>
                      <select
                        id={`edit-reference-type-${reference.id}`}
                        className={inputClass}
                        value={editValues.type}
                        onChange={(event) =>
                          onEditChange({ ...editValues, type: event.target.value as ReferenceType })
                        }
                      >
                        {REFERENCE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {typeWord(type)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`edit-reference-url-${reference.id}`} className={labelClass}>
                        URL (optional)
                      </label>
                      <input
                        id={`edit-reference-url-${reference.id}`}
                        className={inputClass}
                        value={editValues.url}
                        onChange={(event) =>
                          onEditChange({ ...editValues, url: event.target.value })
                        }
                        inputMode="url"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label htmlFor={`edit-reference-body-${reference.id}`} className={labelClass}>
                      Body
                    </label>
                    <textarea
                      id={`edit-reference-body-${reference.id}`}
                      className={inputClass}
                      value={editValues.body}
                      onChange={(event) =>
                        onEditChange({ ...editValues, body: event.target.value })
                      }
                      rows={3}
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

      {archived.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-medium">Archived references</h4>
          <ul className="mt-2 space-y-2">
            {archived.map((reference) => (
              <li
                key={reference.id}
                className="flex items-center justify-between gap-3 rounded border border-neutral-200 dark:border-neutral-800 p-3 text-sm"
              >
                <span className="text-neutral-500 dark:text-neutral-400">
                  {reference.title} ({typeWord(reference.type)}, Archived)
                </span>
                <button
                  type="button"
                  disabled={busyId === reference.id}
                  onClick={() => onRestore(reference.id)}
                  className={buttonClass}
                >
                  {busyId === reference.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
