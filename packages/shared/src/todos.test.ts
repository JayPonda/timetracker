import { describe, expect, it } from 'vitest';
import {
  createTodoSchema,
  reorderTodosSchema,
  todoSchema,
  updateTodoSchema,
} from './todos.js';

describe('FR-TODO-01: a todo is added from a title with safe defaults', () => {
  it('defaults to undone with room for a note and an estimate', () => {
    expect(createTodoSchema.parse({ title: 'Draft the outline' })).toEqual({
      title: 'Draft the outline',
      note: '',
      estimate_hours: null,
    });
  });

  it('rejects a blank title before it reaches the database', () => {
    expect(createTodoSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});

describe('FR-TODO-02: ticking is a flag, and the service owns the date', () => {
  it('accepts done without a done_at — the client never supplies one', () => {
    expect(updateTodoSchema.parse({ done: true })).toEqual({ done: true });
  });

  it('rejects an empty body, because a PATCH that changes nothing is not an edit', () => {
    expect(updateTodoSchema.safeParse({}).success).toBe(false);
  });
});

describe('FR-TODO-01: a reorder is the complete order', () => {
  it('accepts distinct ids', () => {
    expect(reorderTodosSchema.parse({ order: [3, 1, 2] }).order).toEqual([3, 1, 2]);
  });

  it('rejects a repeated id, which would drop a phase silently', () => {
    expect(reorderTodosSchema.safeParse({ order: [1, 1, 2] }).success).toBe(false);
  });

  it('rejects an empty order, which says nothing', () => {
    expect(reorderTodosSchema.safeParse({ order: [] }).success).toBe(false);
  });
});

describe('DATA-07: a returned todo uses epoch milliseconds, not ISO strings', () => {
  it('accepts the storage shape with its boolean done flag', () => {
    const todo = {
      id: 1,
      uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
      task_id: 7,
      title: 'Draft the outline',
      note: '',
      done: false,
      done_at: null,
      estimate_hours: null,
      position: 0,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
      archived_at: null,
    };

    expect(todoSchema.parse(todo)).toEqual(todo);
  });
});
