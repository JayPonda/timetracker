import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Reference } from '@pdm/shared';
import { EMPTY_REFERENCE_FORM, TaskReferences, type TaskReferencesProps } from './TaskReferences';

const LESSON: Reference = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  task_id: 7,
  title: 'What I learned',
  body: 'Never trust a relative href.',
  url: 'https://example.com/lesson',
  type: 'lesson',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const NOTE: Reference = {
  ...LESSON,
  id: 2,
  title: 'Plain note',
  body: '',
  url: null,
  type: 'note',
};

const ARCHIVED: Reference = {
  ...LESSON,
  id: 3,
  title: 'Old reading',
  archived_at: 1_700_000_007_200,
};

function view(overrides: Partial<TaskReferencesProps> = {}): string {
  const props: TaskReferencesProps = {
    references: [LESSON, NOTE, ARCHIVED],
    loading: false,
    loadError: null,
    addValues: EMPTY_REFERENCE_FORM,
    onAddChange: () => {},
    onAdd: () => {},
    addError: null,
    adding: false,
    editingId: null,
    editValues: EMPTY_REFERENCE_FORM,
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
  return renderToStaticMarkup(<TaskReferences {...props} />);
}

describe('FR-REF-02: every item shows its kind in words', () => {
  it('words the type, links the URL, and lists the archived one for restore', () => {
    const html = view();

    expect(html).toContain('What I learned');
    expect(html).toContain('Lesson learned');
    expect(html).toContain('https://example.com/lesson');
    expect(html).toContain('Old reading');
    expect(html).toContain('Archived');
    expect(html).toContain('Restore');
  });

  it('offers every kind in the picker', () => {
    const html = view();

    for (const word of ['Note', 'Link', 'Snippet', 'Lesson learned', 'Decision']) {
      expect(html).toContain(word);
    }
  });
});

describe('UI-17: nothing in this section deletes', () => {
  it('has no Delete button anywhere', () => {
    const html = view();

    expect(html).not.toContain('Delete');
    expect(html).not.toContain('delete');
  });
});
