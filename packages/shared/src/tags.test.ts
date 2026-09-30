import { describe, expect, it } from 'vitest';
import { createTagSchema, tagSchema, updateTagSchema } from './tags.js';

describe('FR-TAG-01: a tag is created from a name with a safe default colour', () => {
  it('defaults the colour the owner did not choose', () => {
    expect(createTagSchema.parse({ name: 'review' })).toEqual({
      name: 'review',
      colour: '#6b7280',
    });
  });

  it('rejects a blank name before it reaches the database', () => {
    expect(createTagSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects a two-line name, which would break every picker and pill', () => {
    expect(createTagSchema.safeParse({ name: 'one\ntwo' }).success).toBe(false);
  });

  it('rejects a colour name, because it would be written into a style attribute', () => {
    expect(createTagSchema.safeParse({ name: 'review', colour: 'red' }).success).toBe(false);
  });
});

describe('FR-TAG-01: an update is partial, but it must say something', () => {
  it('accepts a new name alone', () => {
    expect(updateTagSchema.parse({ name: 'deep-review' })).toEqual({ name: 'deep-review' });
  });

  it('rejects an empty body', () => {
    expect(updateTagSchema.safeParse({}).success).toBe(false);
  });
});

describe('FR-TAG-05: a returned tag carries its archive state', () => {
  it('accepts the storage shape', () => {
    const tag = {
      id: 1,
      uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
      name: 'review',
      colour: '#4f46e5',
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
      archived_at: null,
    };

    expect(tagSchema.parse(tag)).toEqual(tag);
  });
});
