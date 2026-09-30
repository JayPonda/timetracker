import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Criterion } from '@pdm/shared';
import { EMPTY_CRITERION_FORM, TaskCriteria, type TaskCriteriaProps } from './TaskCriteria';

const FIRST: Criterion = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  task_id: 7,
  text: 'The spec reads cleanly',
  position: 0,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const SECOND: Criterion = {
  ...FIRST,
  id: 2,
  text: 'Stays readable',
  position: 1,
};

const ARCHIVED: Criterion = {
  ...FIRST,
  id: 3,
  text: 'Old wording',
  position: 2,
  archived_at: 1_700_000_007_200,
};

function view(overrides: Partial<TaskCriteriaProps> = {}): string {
  const props: TaskCriteriaProps = {
    criteria: [FIRST, SECOND, ARCHIVED],
    loading: false,
    loadError: null,
    showArchived: true,
    onToggleShowArchived: () => {},
    addValues: EMPTY_CRITERION_FORM,
    onAddChange: () => {},
    onAdd: () => {},
    addError: null,
    adding: false,
    editingId: null,
    editValues: EMPTY_CRITERION_FORM,
    onEditChange: () => {},
    onStartEdit: () => {},
    onCancelEdit: () => {},
    onSaveEdit: () => {},
    editError: null,
    savingEdit: false,
    onMove: () => {},
    onArchive: () => {},
    onRestore: () => {},
    busyId: null,
    actionError: null,
    ...overrides,
  };
  return renderToStaticMarkup(<TaskCriteria {...props} />);
}

describe('FR-AC-03: the definition of done is its own section, with no tick box', () => {
  it('names the section for what it is and lists every statement in order', () => {
    const html = view();

    expect(html).toContain('what “done” means');
    expect(html.indexOf('The spec reads cleanly')).toBeLessThan(html.indexOf('Stays readable'));
    expect(html).toContain('(Archived)');
    expect(html).toContain('Restore');
  });

  it('has no tick box on a criterion: a condition is not a step', () => {
    const html = view();

    // The Show-archived toggle is a checkbox and stays one; what must not
    // exist is a per-criterion tick, which is the `Mark "…"` control the todo
    // list renders. Asserting on the bare input type would forbid the toggle
    // too, which is the test overreaching its requirement.
    expect(html).not.toContain('aria-label="Mark');
  });

  it('offers move, edit and archive — and no delete', () => {
    const html = view();

    expect(html).toContain('Move earlier');
    expect(html).toContain('Move later');
    expect(html).toContain('Edit');
    expect(html).toContain('Archive');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('delete');
  });
});
