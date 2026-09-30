import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskLink } from '@pdm/shared';
import { EMPTY_TASK_LINK_FORM, TaskLinks, type TaskLinksProps } from './TaskLinks';

const FIRST: TaskLink = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  task_id: 7,
  label: 'Spec',
  url: 'https://example.com/spec',
  position: 1,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const SECOND: TaskLink = {
  ...FIRST,
  id: 2,
  label: '',
  url: 'https://example.com/plan',
  position: 2,
};

const ARCHIVED: TaskLink = {
  ...FIRST,
  id: 3,
  label: 'Old',
  url: 'https://example.com/old',
  position: 3,
  archived_at: 1_700_000_007_200,
};

function view(overrides: Partial<TaskLinksProps> = {}): string {
  const props: TaskLinksProps = {
    links: [FIRST, SECOND, ARCHIVED],
    loading: false,
    loadError: null,
    addValues: EMPTY_TASK_LINK_FORM,
    onAddChange: () => {},
    onAdd: () => {},
    addError: null,
    adding: false,
    editingId: null,
    editValues: EMPTY_TASK_LINK_FORM,
    onEditChange: () => {},
    onStartEdit: () => {},
    onCancelEdit: () => {},
    onSaveEdit: () => {},
    editError: null,
    savingEdit: false,
    onArchive: () => {},
    onRestore: () => {},
    busyId: null,
    actionError: null,
    ...overrides,
  };
  return renderToStaticMarkup(<TaskLinks {...props} />);
}

describe('FR-TASK-03: links render as links, archived ones as restorable rows', () => {
  it('labels the unlabeled link with its URL and lists the archived one for restore', () => {
    const html = view();

    expect(html).toContain('Spec');
    expect(html).toContain('https://example.com/plan');
    expect(html).toContain('Old');
    expect(html).toContain('(Archived)');
    expect(html).toContain('Restore');
  });

  it('states the three-link limit in words', () => {
    expect(view()).toContain('at most three per task');
  });
});

describe('UI-17: nothing in this section deletes', () => {
  it('has no Delete button anywhere', () => {
    const html = view();

    expect(html).not.toContain('Delete');
    expect(html).not.toContain('delete');
  });
});
