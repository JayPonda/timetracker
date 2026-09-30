import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectSchema,
  updateProjectSchema,
} from './projects.js';

describe('FR-PRJ-01: a project is created from a name with safe defaults', () => {
  it('fills in the description and colour the owner did not choose', () => {
    const input = createProjectSchema.parse({ name: 'Client work' });

    expect(input).toEqual({
      name: 'Client work',
      description: '',
      colour: '#6b7280',
    });
  });

  it('rejects a blank name before it reaches the database', () => {
    const result = createProjectSchema.safeParse({ name: '   ' });

    expect(result.success).toBe(false);
  });
});

describe('FR-PRJ-01: a colour is a hex value, not arbitrary style text', () => {
  it('accepts a six-digit hex colour', () => {
    expect(createProjectSchema.parse({ name: 'A', colour: '#4f46e5' }).colour).toBe('#4f46e5');
  });

  it('rejects a colour name, because it would be written into a style attribute', () => {
    const result = createProjectSchema.safeParse({ name: 'A', colour: 'red' });

    expect(result.success).toBe(false);
  });
});

describe('FR-PRJ-03: an update is partial, but it must say something', () => {
  it('accepts one changed field', () => {
    expect(updateProjectSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' });
  });

  it('rejects an empty body, because a PATCH that changes nothing is not an edit', () => {
    const result = updateProjectSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

describe('DATA-11: archived projects stay out unless they were asked for', () => {
  it('defaults the archive answer to no', () => {
    expect(listProjectsQuerySchema.parse({}).include_archived).toBe(false);
  });

  it('accepts an explicit yes', () => {
    expect(listProjectsQuerySchema.parse({ include_archived: 'true' }).include_archived).toBe(true);
  });
});

describe('DATA-07: a returned project uses epoch milliseconds, not ISO strings', () => {
  it('accepts the storage shape', () => {
    const project = {
      id: 1,
      uid: '0195b3b1-8f2a-7a1b-9c9c-8c0f0f0f0f0f',
      name: 'Client work',
      description: '',
      colour: '#6b7280',
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
      archived_at: null,
    };

    expect(projectSchema.parse(project)).toEqual(project);
  });
});
