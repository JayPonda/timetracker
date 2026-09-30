import { describe, expect, it } from 'vitest';
import { createTaskLinkSchema, taskLinkSchema, updateTaskLinkSchema } from './task-links.js';

describe('FR-TASK-03: a link is a label and a URL the owner can open', () => {
  it('accepts a labelled https URL', () => {
    expect(
      createTaskLinkSchema.parse({ label: 'Spec', url: 'https://example.com/spec' }),
    ).toEqual({ label: 'Spec', url: 'https://example.com/spec' });
  });

  it('defaults a missing label to empty rather than inventing one', () => {
    expect(createTaskLinkSchema.parse({ url: 'https://example.com' }).label).toBe('');
  });

  it('rejects text that is not a URL before it reaches the database', () => {
    expect(createTaskLinkSchema.safeParse({ url: 'not a link' }).success).toBe(false);
  });

  it('rejects a relative path, which navigates nowhere', () => {
    expect(createTaskLinkSchema.safeParse({ url: '/just/a/path' }).success).toBe(false);
  });
});

describe('FR-TASK-03: an update is partial, but it must say something', () => {
  it('accepts a new label alone', () => {
    expect(updateTaskLinkSchema.parse({ label: 'New label' })).toEqual({ label: 'New label' });
  });

  it('rejects an empty body', () => {
    expect(updateTaskLinkSchema.safeParse({}).success).toBe(false);
  });
});

describe('DATA-01: a returned link carries its slot', () => {
  it('accepts the storage shape with a position in 1–3', () => {
    const link = {
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

    expect(taskLinkSchema.parse(link)).toEqual(link);
  });

  it('rejects a position outside the three slots', () => {
    expect(
      taskLinkSchema.safeParse({
        id: 1,
        uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
        task_id: 7,
        label: '',
        url: 'https://example.com',
        position: 4,
        created_at: 1,
        updated_at: 1,
        archived_at: null,
      }).success,
    ).toBe(false);
  });
});
