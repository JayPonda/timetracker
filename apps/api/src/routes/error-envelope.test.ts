import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CAPABILITIES, ERROR_CODES, type ErrorEnvelope } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { principalResolver, protectedRoute } from './test-support.js';
import { AppError, validationFailed, validationDetails } from '../lib/errors.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

/**
 * A route whose handler throws, so the error envelope can be observed through a
 * real request rather than by calling the handler directly.
 *
 * The throwable is passed in rather than hard-coded, so one server covers both a
 * service refusal and a schema failure, which are rendered differently.
 */
async function appThatThrows(throwable: unknown): Promise<TestApp> {
  harness = await createTestApp({
    principalResolver: principalResolver({ kind: 'local_user', holds: [CAPABILITIES.TASK_CREATE] }),
    extraRoutes: [
      {
        method: 'POST',
        url: '/api/v1/test-throws',
        capabilities: [CAPABILITIES.TASK_CREATE],
        description: 'test route whose handler throws',
        handler: async () => {
          throw throwable;
        },
      },
      ...protectedRoute([CAPABILITIES.TASK_READ]),
    ],
  });
  return harness;
}

describe('criterion 9: a service refusal reaches the client as a named field', () => {
  it('renders an AppError with its own code and status', async () => {
    const { app } = await appThatThrows(validationFailed('A task may have at most 3 links'));

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.message).toBe('A task may have at most 3 links');
  });

  it('carries the field issues in details, so the form can point at the input', async () => {
    const details = validationDetails(
      z.object({ name: z.string().min(1) }).safeParse({ name: '' }).error as z.ZodError,
    );
    const { app } = await appThatThrows(validationFailed('name: Required', details));

    const body = (
      await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} })
    ).json<ErrorEnvelope>();
    const issues = (body.error.details as { issues: Array<{ path: string }> }).issues;

    expect(issues[0]?.path).toBe('name');
  });

  it('omits details entirely when the service supplied none', async () => {
    // A client branching on `details` should not have to distinguish "absent" from
    // "present but empty".
    const { app } = await appThatThrows(new AppError(ERROR_CODES.CAPABILITY_DENIED, 'nope'));

    const body = (
      await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} })
    ).json<ErrorEnvelope>();
    expect(body.error.details).toBeUndefined();
  });
});

describe('criterion 9: an unparsed Zod failure is still a 422 naming the field', () => {
  it('does not become a 500 because a handler skipped safeParse', async () => {
    // A malformed body is the client's mistake, and saying so is the useful
    // answer. Falling through to the 500 branch would report it as a server fault.
    const { app } = await appThatThrows(z.object({ name: z.string() }).safeParse({}).error);

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.message).toContain('name');
  });
});

describe('a 5xx does not leak its message or its stack', () => {
  it('replaces the message with a generic one', async () => {
    // A SQLite error can name a file path and a constraint name; both are
    // information the client does not need and a log line should carry instead.
    const { app } = await appThatThrows(
      new Error('SQLITE_CONSTRAINT: UNIQUE failed: /Users/owner/data/pdm.db'),
    );

    const body = (
      await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} })
    ).json<ErrorEnvelope>();

    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('SQLITE');
    expect(body.error.message).not.toContain('pdm.db');
  });

  it('uses the internal code, so a client can tell a fault from a refusal', async () => {
    const { app } = await appThatThrows(new Error('boom'));

    const body = (
      await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} })
    ).json<ErrorEnvelope>();
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('still returns 500', async () => {
    const { app } = await appThatThrows(new Error('boom'));
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} })).statusCode,
    ).toBe(500);
  });
});

describe('every error response carries the request id', () => {
  it('is present on a refusal', async () => {
    const { app } = await appThatThrows(new AppError(ERROR_CODES.NOT_FOUND, 'gone'));

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} });
    expect(res.json<ErrorEnvelope>().error.request_id).toBeTruthy();
  });

  it('is present on a 500', async () => {
    const { app } = await appThatThrows(new Error('boom'));

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws', payload: {} });
    expect(res.json<ErrorEnvelope>().error.request_id).toBe(res.headers['x-request-id']);
  });

  it('is present on a not-found', async () => {
    const { app } = await createTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(res.json<ErrorEnvelope>().error.request_id).toBe(res.headers['x-request-id']);
  });

  it('honours an inbound x-request-id', async () => {
    const { app } = await appThatThrows(new Error('boom'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/test-throws',
      payload: {},
      headers: { 'x-request-id': 'from-the-owner' },
    });

    // The whole point of the id is correlating a bug report with a log line.
    expect(res.json<ErrorEnvelope>().error.request_id).toBe('from-the-owner');
  });

  it('ignores an absurdly long inbound id rather than echoing it', async () => {
    const { app } = await createTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/nothing-here',
      headers: { 'x-request-id': 'x'.repeat(5_000) },
    });

    // The value is echoed into a response body and into log lines, so an
    // unbounded client-supplied string is a log-injection vector.
    expect(res.json<ErrorEnvelope>().error.request_id).not.toBe('x'.repeat(5_000));
    expect(res.json<ErrorEnvelope>().error.request_id?.length).toBeLessThanOrEqual(128);
  });

  it('generates a uuid when none is offered', async () => {
    const { app } = await createTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(res.json<ErrorEnvelope>().error.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('the response status and the envelope code agree', () => {
  it('for a capability refusal', async () => {
    const { app } = await createTestApp({
      principalResolver: principalResolver({ kind: 'mcp_token', holds: [CAPABILITIES.TASK_READ] }),
      extraRoutes: protectedRoute([CAPABILITIES.TASK_CREATE]),
    });

    const res = await app.inject({ method: 'POST', url: '/api/v1/test-protected', payload: {} });
    const body = res.json<ErrorEnvelope>();

    // Before the code/status split, a 403 arrived as `validation_failed`, so a
    // client could not tell "you typed it wrong" from "you may not do this".
    expect(res.statusCode).toBe(body.error.status);
    expect(body.error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
  });
});

/**
 * `resolveError` maps whatever was thrown into the envelope, and three of its
 * shapes are not `AppError`: a Fastify schema rejection (400), a not-found
 * raised as an error rather than by the not-found handler (404), and anything
 * unrecognised (500).
 *
 * These are defensive mappings for errors the application's own code does not
 * currently raise — every route validates with zod and returns a 404 through the
 * not-found handler. They are still mapped, because the moment a route adopts a
 * Fastify schema, or a plugin throws something with a `statusCode`, a 500 would
 * be the wrong answer and the mapping is what prevents it. The test pins the
 * mapping rather than the current absence of the cause.
 */
describe('the error mapper recognises a non-AppError statusCode', () => {
  /** A bare error carrying a statusCode, the shape Fastify and plugins use. */
  function httpError(statusCode: number, message: string): Error {
    return Object.assign(new Error(message), { statusCode });
  }

  it('maps a 400 to a 422 with the validation code', async () => {
    const { app } = await appThatThrows(httpError(400, 'body must have required property name'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });
    const body = res.json<ErrorEnvelope>();

    // 400 becomes 422 on purpose: this API's refusals are 422, and a client
    // should not have to learn a second validation status from Fastify.
    expect(res.statusCode).toBe(422);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('keeps the message, because it names the field that was wrong', async () => {
    const { app } = await appThatThrows(httpError(400, 'body must have required property name'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });

    expect(res.json<ErrorEnvelope>().error.message).toContain('required property name');
  });

  it('maps a 404 to a 404 with the not-found code', async () => {
    const { app } = await appThatThrows(httpError(404, 'No such widget'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });
    const body = res.json<ErrorEnvelope>();

    expect(res.statusCode).toBe(404);
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('keeps a 404 message rather than replacing it', async () => {
    const { app } = await appThatThrows(httpError(404, 'No such widget'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });

    expect(res.json<ErrorEnvelope>().error.message).toBe('No such widget');
  });

  it('does not pass a 403 through, because an unrecognised status is a fault', async () => {
    const { app } = await appThatThrows(httpError(403, 'Not allowed'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });
    const body = res.json<ErrorEnvelope>();

    // Only 400 and 404 are trusted. A capability refusal in this app is an
    // `AppError`, raised by the middleware and mapped before this point — so a
    // bare error carrying 403 means something unrecognised failed, and saying
    // 500 is the honest answer. Echoing 403 would blame the client for a fault
    // on our side and tell them to fix a request that was fine.
    expect(res.statusCode).toBe(500);
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL);
    expect(body.error.message).toBe('Internal server error');
  });

  it('treats a statusCode below 400 as unknown, so it becomes a 500', async () => {
    // A `statusCode: 200` on a thrown error means something is confused. Trusting
    // it would produce a 200 with an error body, which no client can interpret.
    const { app } = await appThatThrows(httpError(200, 'not really an error'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });

    expect(res.statusCode).toBe(500);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('uses the generic message for a 500, never the thrown one', async () => {
    const { app } = await appThatThrows(new Error('SQLITE_CONSTRAINT: /data/pdm.db'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });

    // The thrown message names a file path and a constraint. It goes to the log,
    // which an owner can read; it does not go to the client.
    expect(res.json<ErrorEnvelope>().error.message).toBe('Internal server error');
  });

  it('handles a thrown string, which has no statusCode at all', async () => {
    const { app } = await appThatThrows('just a string');
    const res = await app.inject({ method: 'POST', url: '/api/v1/test-throws' });

    expect(res.statusCode).toBe(500);
    expect(res.json<ErrorEnvelope>().error.code).toBe(ERROR_CODES.INTERNAL);
  });
});
