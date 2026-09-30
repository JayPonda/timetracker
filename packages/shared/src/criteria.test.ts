import { describe, expect, it } from 'vitest';
import {
  createCriterionSchema,
  criterionSchema,
  reorderCriteriaSchema,
  updateCriterionSchema,
} from './criteria.js';

describe('FR-AC-01: a criterion is added as a short statement', () => {
  it('accepts the statement', () => {
    expect(createCriterionSchema.parse({ text: 'The spec reads cleanly' })).toEqual({
      text: 'The spec reads cleanly',
    });
  });

  it('rejects a blank statement before it reaches the database', () => {
    expect(createCriterionSchema.safeParse({ text: '   ' }).success).toBe(false);
  });

  it('rejects an essay, because a criterion is a short statement', () => {
    expect(createCriterionSchema.safeParse({ text: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('FR-AC-01: an update carries the statement', () => {
  it('accepts new text', () => {
    expect(updateCriterionSchema.parse({ text: 'New words' })).toEqual({ text: 'New words' });
  });

  it('rejects an empty body', () => {
    expect(updateCriterionSchema.safeParse({}).success).toBe(false);
  });
});

describe('FR-AC-01: a reorder is the complete order', () => {
  it('accepts distinct ids', () => {
    expect(reorderCriteriaSchema.parse({ order: [2, 1] }).order).toEqual([2, 1]);
  });

  it('rejects a repeated id', () => {
    expect(reorderCriteriaSchema.safeParse({ order: [1, 1] }).success).toBe(false);
  });
});

describe('FR-AC-02: a returned criterion is a statement with a position, never a verdict', () => {
  it('accepts the storage shape', () => {
    const criterion = {
      id: 1,
      uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
      task_id: 7,
      text: 'The spec reads cleanly',
      position: 0,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
      archived_at: null,
    };

    expect(criterionSchema.parse(criterion)).toEqual(criterion);
  });
});
