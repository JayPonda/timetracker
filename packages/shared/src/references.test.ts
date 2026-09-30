import { describe, expect, it } from 'vitest';
import { createReferenceSchema, referenceSchema, updateReferenceSchema } from './references.js';

describe('FR-REF-02: a reference has a title, a body, an optional URL and a type', () => {
  it('defaults an untidy input to a note with no URL', () => {
    expect(createReferenceSchema.parse({ title: 'What I learned' })).toEqual({
      title: 'What I learned',
      body: '',
      url: null,
      type: 'note',
    });
  });

  it('accepts every type the SRS names', () => {
    for (const type of ['note', 'link', 'snippet', 'lesson', 'decision'] as const) {
      expect(createReferenceSchema.parse({ title: 'T', type }).type).toBe(type);
    }
  });

  it('rejects a blank title before it reaches the database', () => {
    expect(createReferenceSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('rejects a non-URL when a URL is given', () => {
    expect(createReferenceSchema.safeParse({ title: 'T', url: 'not a link' }).success).toBe(false);
  });

  it('rejects a blank URL, which is neither a link nor an absence', () => {
    expect(createReferenceSchema.safeParse({ title: 'T', url: '   ' }).success).toBe(false);
  });
});

describe('FR-REF-01: an update is partial, but it must say something', () => {
  it('accepts a new body alone', () => {
    expect(updateReferenceSchema.parse({ body: 'New words' })).toEqual({ body: 'New words' });
  });

  it('rejects an empty body', () => {
    expect(updateReferenceSchema.safeParse({}).success).toBe(false);
  });
});

describe('FR-REF-02: a returned reference carries every field', () => {
  it('accepts the storage shape', () => {
    const reference = {
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

    expect(referenceSchema.parse(reference)).toEqual(reference);
  });
});
