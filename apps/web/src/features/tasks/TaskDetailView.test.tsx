import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Task, Todo } from '@pdm/shared';
import { EMPTY_TODO_FORM, TaskDetailView, type TaskDetailViewProps } from './TaskDetailView';
import { EMPTY_TASK_LINK_FORM } from './TaskLinks';

const TASK: Task = {
  id: 7,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  project_id: 1,
  project_name: 'Client work',
  name: 'Write the spec',
  description: 'The whole thing',
  status: 'in_progress',
  score: 3,
  estimate_hours: 2.5,
  planned_start: null,
  due_date: null,
  started_at: 1_700_000_000_000,
  ended_at: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  archived_at: null,
};

const FIRST: Todo = {
  id: 1,
  uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
  task_id: 7,
  title: 'Draft the outline',
  note: '',
  done: true,
  done_at: 1_700_000_003_600,
  estimate_hours: null,
  position: 0,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_003_600,
  archived_at: null,
};

const SECOND: Todo = {
  ...FIRST,
  id: 2,
  title: 'Revise',
  done: false,
  done_at: null,
  position: 1,
};

const ARCHIVED: Todo = {
  ...FIRST,
  id: 3,
  title: 'Cut phase',
  position: 2,
  archived_at: 1_700_000_007_200,
};

function view(overrides: Partial<TaskDetailViewProps> = {}): string {
  const props: TaskDetailViewProps = {
    task: TASK,
    loading: false,
    loadError: null,
    todos: [FIRST, SECOND, ARCHIVED],
    todosLoading: false,
    todosError: null,
    showArchivedTodos: true,
    onToggleShowArchivedTodos: () => {},
    addValues: EMPTY_TODO_FORM,
    onAddChange: () => {},
    onAdd: () => {},
    addError: null,
    adding: false,
    editingId: null,
    editValues: EMPTY_TODO_FORM,
    onEditChange: () => {},
    onStartEdit: () => {},
    onCancelEdit: () => {},
    onSaveEdit: () => {},
    editError: null,
    savingEdit: false,
    onTick: () => {},
    onMove: () => {},
    onArchive: () => {},
    onRestore: () => {},
    busyId: null,
    actionError: null,
    linksProps: {
      links: [],
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
    },
    ...overrides,
  };
  return renderToStaticMarkup(<TaskDetailView {...props} />);
}

describe('FR-TODO-01: phases render in timeline order with their state in words', () => {
  it('lists every todo with done and archived in words, not colour', () => {
    const html = view();

    expect(html.indexOf('Draft the outline')).toBeLessThan(html.indexOf('Revise'));
    expect(html).toContain('(Done)');
    expect(html).toContain('(Not done)');
    expect(html).toContain('Archived');
  });

  it('offers tick, move, edit, archive and restore — and no delete', () => {
    const html = view();

    expect(html).toContain('Mark');
    expect(html).toContain('Move earlier');
    expect(html).toContain('Move later');
    expect(html).toContain('Edit');
    expect(html).toContain('Archive');
    expect(html).toContain('Restore');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('delete');
  });
});

describe('the header names the task and its project', () => {
  it('shows the name, project and status', () => {
    const html = view();

    expect(html).toContain('Write the spec');
    expect(html).toContain('Client work');
    expect(html).toContain('In progress');
  });
});
