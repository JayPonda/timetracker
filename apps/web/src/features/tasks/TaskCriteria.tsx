import type { JSX } from 'react';
import type { Criterion } from '@pdm/shared';

/**
 * The acceptance-criteria section of the task detail page, split from its data
 * like every other screen.
 *
 * **Separate from todos by construction, not by styling** (`FR-AC-03`,
 * `NFR-USE-02`): this is its own section with its own heading, its own list
 * and no checkbox anywhere. A criterion is a condition to be met, not a step
 * to be ticked, and a tick box here would invite the owner to “complete” the
 * definition of done — which decides nothing and records nothing.
 */

export interface CriterionFormValues {
  text: string;
}

export const EMPTY_CRITERION_FORM: CriterionFormValues = { text: '' };

export interface TaskCriteriaProps {
  readonly criteria: readonly Criterion[] | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly showArchived: boolean;
  readonly onToggleShowArchived: (show: boolean) => void;
  readonly addValues: CriterionFormValues;
  readonly onAddChange: (values: CriterionFormValues) => void;
  readonly onAdd: () => void;
  readonly addError: string | null;
  readonly adding: boolean;
  readonly editingId: number | null;
  readonly editValues: CriterionFormValues;
  readonly onEditChange: (values: CriterionFormValues) => void;
  readonly onStartEdit: (criterion: Criterion) => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: () => void;
  readonly editError: string | null;
  readonly savingEdit: boolean;
  readonly onMove: (id: number, direction: -1 | 1) => void;
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

export function TaskCriteria(props: TaskCriteriaProps): JSX.Element {
  const {
    criteria,
    loading,
    loadError,
    showArchived,
    onToggleShowArchived,
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
    onMove,
    onArchive,
    onRestore,
    busyId,
    actionError,
  } = props;

  const list = criteria ?? [];

  return (
    <section aria-label="Acceptance criteria">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">Acceptance criteria — what “done” means</h3>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => onToggleShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-4">
        <h4 className="text-xs font-medium">New criterion</h4>
        <div className="mt-2">
          <label htmlFor="new-criterion-text" className={labelClass}>
            Statement
          </label>
          <input
            id="new-criterion-text"
            className={inputClass}
            value={addValues.text}
            onChange={(event) => onAddChange({ text: event.target.value })}
            placeholder="The spec reads cleanly"
          />
        </div>
        <div className="mt-2">
          <button
            type="button"
            disabled={adding}
            onClick={onAdd}
            className="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-sm disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add criterion'}
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
      {loading ? <p className="mt-4 text-sm text-neutral-500">Loading criteria…</p> : null}
      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      ) : null}
      {!loading && !loadError && list.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          No definition of done yet. Without one the task cannot be ended later — add the first
          statement above.
        </p>
      ) : null}

      <ol className="mt-4 space-y-2">
        {list.map((criterion, index) => {
          const archived = criterion.archived_at !== null;
          const busy = busyId === criterion.id;
          return (
            <li
              key={criterion.id}
              className="rounded border border-neutral-200 dark:border-neutral-800 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 text-sm">
                  {criterion.text}{' '}
                  {archived ? (
                    <span className="font-normal text-xs text-neutral-500 dark:text-neutral-400">
                      (Archived)
                    </span>
                  ) : null}
                </p>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => onMove(criterion.id, -1)}
                      className={buttonClass}
                      title="Move earlier"
                    >
                      ↑
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy || index === list.length - 1}
                      onClick={() => onMove(criterion.id, 1)}
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
                      onClick={() => onStartEdit(criterion)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onArchive(criterion.id)}
                      className={buttonClass}
                    >
                      {busy ? 'Archiving…' : 'Archive'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRestore(criterion.id)}
                      className={buttonClass}
                    >
                      {busy ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>

              {editingId === criterion.id && !archived ? (
                <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800 p-3">
                  <h4 className="text-xs font-medium">Edit criterion</h4>
                  <div className="mt-2">
                    <label htmlFor={`edit-criterion-text-${criterion.id}`} className={labelClass}>
                      Statement
                    </label>
                    <input
                      id={`edit-criterion-text-${criterion.id}`}
                      className={inputClass}
                      value={editValues.text}
                      onChange={(event) => onEditChange({ text: event.target.value })}
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
  );
}
