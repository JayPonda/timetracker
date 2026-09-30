import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Tag } from '@pdm/shared';
import { EMPTY_TAG_FORM, TagsView, type TagsViewProps } from './TagsView';

const LIVE: Tag = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  name: 'review',
  colour: '#4f46e5',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const ARCHIVED: Tag = {
  ...LIVE,
  id: 2,
  name: 'meeting',
  archived_at: 1_700_000_003_600,
};

function view(overrides: Partial<TagsViewProps> = {}): string {
  const props: TagsViewProps = {
    tags: [LIVE, ARCHIVED],
    loading: false,
    loadError: null,
    showArchived: true,
    onToggleShowArchived: () => {},
    createValues: EMPTY_TAG_FORM,
    onCreateChange: () => {},
    onCreate: () => {},
    createError: null,
    creating: false,
    editingId: null,
    editValues: EMPTY_TAG_FORM,
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
  return renderToStaticMarkup(<TagsView {...props} />);
}

describe('FR-TAG-05: archived tags are labelled and restorable', () => {
  it('words the status instead of relying on colour', () => {
    const html = view();

    expect(html).toContain('Status: Active');
    expect(html).toContain('Status: Archived');
  });

  it('offers Restore for an archived tag and Archive for a live one', () => {
    const html = view();

    expect(html).toContain('Restore');
    expect(html).toContain('Archive');
  });

  it('has no Delete button anywhere', () => {
    const html = view();

    expect(html).not.toContain('Delete');
    expect(html).not.toContain('delete');
  });
});

describe('DATA-11: the archive toggle is explicit', () => {
  it('labels the archived control in words', () => {
    expect(view()).toContain('Show archived');
  });
});
