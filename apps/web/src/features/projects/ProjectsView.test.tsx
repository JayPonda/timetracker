import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project } from '@pdm/shared';
import { ProjectsView, type ProjectFormValues, type ProjectsViewProps } from './ProjectsView';

const FORM: ProjectFormValues = { name: '', description: '', colour: '#6b7280' };

const LIVE: Project = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  name: 'Client work',
  description: 'Website',
  colour: '#4f46e5',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const ARCHIVED: Project = {
  ...LIVE,
  id: 2,
  name: 'Old project',
  archived_at: 1_700_000_003_600,
};

function view(overrides: Partial<ProjectsViewProps> = {}): string {
  const props: ProjectsViewProps = {
    projects: [LIVE, ARCHIVED],
    loading: false,
    loadError: null,
    showArchived: true,
    onToggleShowArchived: () => {},
    createValues: FORM,
    onCreateChange: () => {},
    onCreate: () => {},
    createError: null,
    creating: false,
    editingId: null,
    editValues: FORM,
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
  return renderToStaticMarkup(<ProjectsView {...props} />);
}

describe('UI-04 and UI-17: archived projects are labelled and reversible', () => {
  it('words the status instead of relying on colour', () => {
    const html = view();

    expect(html).toContain('Status: Active');
    expect(html).toContain('Status: Archived');
  });

  it('offers Restore for an archived project and Archive for a live one', () => {
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

  it('explains an empty default list without sending the owner hunting', () => {
    const html = view({ projects: [], showArchived: false });

    expect(html).toContain('No live projects');
  });
});
