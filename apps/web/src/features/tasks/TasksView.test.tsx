import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project, Task } from '@pdm/shared';
import type { TaskFilters } from './api';
import { EMPTY_TASK_FORM, TasksView, type TasksViewProps } from './TasksView';

const PROJECT: Project = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  name: 'Client work',
  description: '',
  colour: '#4f46e5',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const OPEN_TASK: Task = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  project_id: 1,
  project_name: 'Client work',
  name: 'Write the spec',
  description: '',
  status: 'open',
  score: 3,
  estimate_hours: 2.5,
  planned_start: null,
  due_date: null,
  started_at: null,
  ended_at: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const LOOSE_TASK: Task = {
  ...OPEN_TASK,
  id: 2,
  project_id: null,
  project_name: null,
  name: 'Loose end',
  status: 'in_progress',
};

const FILTERS: TaskFilters = {
  projectId: 'all',
  status: 'all',
  sort: 'created_at',
  direction: 'desc',
  includeArchived: false,
};

function view(overrides: Partial<TasksViewProps> = {}): string {
  const props: TasksViewProps = {
    tasks: [OPEN_TASK, LOOSE_TASK],
    loading: false,
    loadError: null,
    filters: FILTERS,
    onFiltersChange: () => {},
    liveProjects: [PROJECT],
    createValues: EMPTY_TASK_FORM,
    onCreateChange: () => {},
    onCreate: () => {},
    createError: null,
    creating: false,
    editingId: null,
    editValues: EMPTY_TASK_FORM,
    onEditChange: () => {},
    onStartEdit: () => {},
    onCancelEdit: () => {},
    onSaveEdit: () => {},
    editError: null,
    savingEdit: false,
    onMoveStatus: () => {},
    onArchive: () => {},
    onRestore: () => {},
    busyId: null,
    actionError: null,
    ...overrides,
  };
  return renderToStaticMarkup(<TasksView {...props} />);
}

describe('FR-STAT-04: status is shown in words with its project', () => {
  it('words the status and names the project or “No project”', () => {
    const html = view();

    expect(html).toContain('Status: Open');
    expect(html).toContain('Status: In progress');
    expect(html).toContain('Client work');
    expect(html).toContain('No project');
  });

  it('offers the project picker and the “No project” bucket filter', () => {
    const html = view();

    expect(html).toContain('No project');
    expect(html).toContain('All projects');
  });
});

describe('FR-STAT-01: there is no path to ended on this screen', () => {
  it('has no End button', () => {
    const html = view();

    expect(html).not.toContain('End task');
    expect(html).not.toContain('>End<');
  });

  it('moves between open and in progress in words', () => {
    const html = view();

    expect(html).toContain('Move to In progress');
    expect(html).toContain('Move to Open');
  });
});

describe('UI-17: nothing on this screen deletes', () => {
  it('has no Delete button anywhere', () => {
    const html = view();

    expect(html).not.toContain('Delete');
    expect(html).not.toContain('delete');
  });
});
