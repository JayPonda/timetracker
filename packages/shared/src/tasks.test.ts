import { describe, expect, it } from 'vitest';
import { createTaskSchema, listTasksQuerySchema, taskSchema, updateTaskSchema } from './tasks.js';

describe('FR-TASK-01: a task is created from a name with safe defaults', () => {
  it('defaults to open, unestimated and filed under “No project”', () => {
    const input = createTaskSchema.parse({ name: 'Write the spec' });

    expect(input).toEqual({
      name: 'Write the spec',
      description: '',
      project_id: null,
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
    });
  });

  it('rejects a blank name before it reaches the database', () => {
    expect(createTaskSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('FR-STAT-01: ended is not a writable status', () => {
  it('refuses ended on create', () => {
    const result = createTaskSchema.safeParse({ name: 'A', status: 'ended' });

    expect(result.success).toBe(false);
  });

  it('refuses ended on update', () => {
    const result = updateTaskSchema.safeParse({ status: 'ended' });

    expect(result.success).toBe(false);
  });
});

describe('FR-TASK-07: dates must make sense', () => {
  it('rejects a due date before the planned start', () => {
    const result = createTaskSchema.safeParse({
      name: 'A',
      planned_start: 2_000,
      due_date: 1_000,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a partial update that inverts the two dates', () => {
    const result = updateTaskSchema.safeParse({ planned_start: 2_000, due_date: 1_000 });

    expect(result.success).toBe(false);
  });
});

describe('FR-TASK-12: an update is partial, but it must say something', () => {
  it('rejects an empty body', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });

  it('accepts an explicit null project_id, which is a move to “No project”', () => {
    expect(updateTaskSchema.parse({ project_id: null })).toEqual({ project_id: null });
  });
});

describe('FR-VIEW-03: the list query composes filters and sorts', () => {
  it('defaults to newest first and archived rows out', () => {
    expect(listTasksQuerySchema.parse({})).toEqual({
      sort: 'created_at',
      direction: 'desc',
      include_archived: false,
    });
  });

  it('spells the “No project” bucket as none, not as a magic number', () => {
    expect(listTasksQuerySchema.parse({ project_id: 'none' }).project_id).toBe('none');
  });

  it('accepts a numeric project id', () => {
    expect(listTasksQuerySchema.parse({ project_id: '3' }).project_id).toBe(3);
  });
});

describe('DATA-07: a returned task uses epoch milliseconds, not ISO strings', () => {
  it('accepts the storage shape with its joined project name', () => {
    const task = {
      id: 1,
      uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
      project_id: null,
      project_name: null,
      name: 'Write the spec',
      description: '',
      status: 'open',
      score: null,
      estimate_hours: null,
      planned_start: null,
      due_date: null,
      started_at: null,
      ended_at: null,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
      archived_at: null,
    };

    expect(taskSchema.parse(task)).toEqual(task);
  });
});
