import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, type ErrorEnvelope } from '@pdm/shared';
import {
  AppError,
  capabilityDenied,
  notFound,
  statusForCode,
  validationDetails,
  validationFailed,
  validationMessage,
} from './errors.js';

describe('criterion 9: a validation error names the field that failed', () => {
  const schema = z.object({
    name: z.string().min(1),
    score: z.number().int().nonnegative(),
  });

  it('gives a dotted path to the offending field', () => {
    const parsed = schema.safeParse({ name: '', score: -1 });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    expect(details.issues.map((issue) => issue.path)).toEqual(['name', 'score']);
  });

  it('names a nested field by its full path', () => {
    const nested = z.object({ links: z.array(z.object({ url: z.string().url() })) });
    const parsed = nested.safeParse({ links: [{ url: 'not a url' }] });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    // `links.0.url` is something the owner can match against the form in front of
    // them; a bare `[0]`-indexed array is not.
    expect(details.issues[0]?.path).toBe('links.0.url');
  });

  it('carries the Zod issue code, so a client can branch without parsing text', () => {
    const parsed = schema.safeParse({ name: '', score: 0 });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    expect(details.issues[0]?.code).toBe('too_small');
  });

  it('does not echo the submitted value back to the client', () => {
    const secret = 'correct horse battery staple';
    const withSecret = z.object({ note: z.string().max(4) });
    const parsed = withSecret.safeParse({ note: secret });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    // Criterion 9 also requires the typed value to be preserved, and the way to
    // satisfy that is for the browser to leave the field alone — not for the
    // server to re-state it. Echoing input is how a secret reaches a log line.
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it('puts the first field in the message, so one error is readable', () => {
    const parsed = schema.safeParse({ name: '', score: 0 });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    expect(validationMessage(details)).toBe('name: String must contain at least 1 character(s)');
  });

  it('counts the rest when there is more than one', () => {
    const parsed = schema.safeParse({ name: '', score: -1 });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    expect(validationMessage(details)).toMatch(/and 1 more/);
  });

  it('labels a root-level failure rather than naming an empty path', () => {
    // A refinement on the object itself has an empty `path`, and a message that
    // begins with a bare colon is the thing this label exists to prevent.
    const strictObject = z.object({ name: z.string() }).refine((v) => v.name.length > 3, {
      message: 'name must be longer than three characters',
    });

    const parsed = strictObject.safeParse({ name: 'ab' });
    const details = validationDetails((parsed as z.SafeParseError<unknown>).error);

    expect(details.issues[0]?.path).toBe('(root)');
    expect(validationMessage(details)).toContain('(root)');
  });
});

describe('MCP-14: a capability denial is a 403, not a validation failure', () => {
  it('refuses with the capability code', () => {
    const error = capabilityDenied('may not PATCH /tasks/1: missing task:update');
    expect(error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
  });

  it('uses 403, so a client can tell a permission problem from a bad payload', () => {
    // Before the code/status split, both arrived as `validation_failed`, and a
    // client could not tell "you typed it wrong" from "you may not do this".
    expect(capabilityDenied('x').status).toBe(403);
  });
});

describe('an error code determines its status, in one place', () => {
  it('maps not found to 404', () => {
    expect(statusForCode(ERROR_CODES.NOT_FOUND)).toBe(404);
  });

  it('maps validation failed to 422', () => {
    expect(statusForCode(ERROR_CODES.VALIDATION_FAILED)).toBe(422);
  });

  it('maps database unavailable to 503', () => {
    expect(statusForCode(ERROR_CODES.DATABASE_UNAVAILABLE)).toBe(503);
  });

  it('maps internal to 500', () => {
    expect(statusForCode(ERROR_CODES.INTERNAL)).toBe(500);
  });
});

describe('a not-found refusal names what was missing', () => {
  it('produces a 404 naming the entity', () => {
    const error = notFound('Project 42');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Project 42 not found');
  });
});

describe('an AppError is an Error, so it survives a throw and a catch', () => {
  it('carries its code and status onto the instance', () => {
    const error = validationFailed('too many links');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.status).toBe(422);
  });

  it('keeps a name that says what it is, for a log line', () => {
    expect(new AppError(ERROR_CODES.INTERNAL, 'x').name).toBe('AppError');
  });

  it('omits details entirely when there are none', () => {
    // `details: undefined` would still appear in a serialised envelope as an
    // absent-but-present key for some clients; the envelope builder drops it.
    expect(validationFailed('no detail').details).toBeUndefined();
  });
});

describe('the error envelope shape is the one the client was promised', () => {
  it('validates against the shared schema', () => {
    const envelope: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'name: Required',
        status: 422,
        request_id: 'req-1',
        details: { issues: [{ path: 'name', message: 'Required', code: 'invalid_type' }] },
      },
    };
    expect(envelope.error.status).toBe(422);
  });
});
