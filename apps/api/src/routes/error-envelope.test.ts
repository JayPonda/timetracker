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
        url: '/api/test-throws',
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

    const res = await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} });
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
      await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} })
    ).json<ErrorEnvelope>();
    const issues = (body.error.details as { issues: Array<{ path: string }> }).issues;

    expect(issues[0]?.path).toBe('name');
  });

  it('omits details entirely when the service supplied none', async () => {
    // A client branching on `details` should not have to distinguish "absent" from
    // "present but empty".
    const { app } = await appThatThrows(new AppError(ERROR_CODES.CAPABILITY_DENIED, 'nope'));

    const body = (
      await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} })
    ).json<ErrorEnvelope>();
    expect(body.error.details).toBeUndefined();
  });
});

describe('criterion 9: an unparsed Zod failure is still a 422 naming the field', () => {
  it('does not become a 500 because a handler skipped safeParse', async () => {
    // A malformed body is the client's mistake, and saying so is the useful
    // answer. Falling through to the 500 branch would report it as a server fault.
    const { app } = await appThatThrows(z.object({ name: z.string() }).safeParse({}).error);

    const res = await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} });
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
      await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} })
    ).json<ErrorEnvelope>();

    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('SQLITE');
    expect(body.error.message).not.toContain('pdm.db');
  });

  it('uses the internal code, so a client can tell a fault from a refusal', async () => {
    const { app } = await appThatThrows(new Error('boom'));

    const body = (
      await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} })
    ).json<ErrorEnvelope>();
    expect(body.error.code).toBe(ERROR_CODES.INTERNAL);
  });

  it('still returns 500', async () => {
    const { app } = await appThatThrows(new Error('boom'));
    expect(
      (await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} })).statusCode,
    ).toBe(500);
  });
});

describe('every error response carries the request id', () => {
  it('is present on a refusal', async () => {
    const { app } = await appThatThrows(new AppError(ERROR_CODES.NOT_FOUND, 'gone'));

    const res = await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} });
    expect(res.json<ErrorEnvelope>().error.request_id).toBeTruthy();
  });

  it('is present on a 500', async () => {
    const { app } = await appThatThrows(new Error('boom'));

    const res = await app.inject({ method: 'POST', url: '/api/test-throws', payload: {} });
    expect(res.json<ErrorEnvelope>().error.request_id).toBe(res.headers['x-request-id']);
  });

  it('is present on a not-found', async () => {
    const { app } = await createTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(res.json<ErrorEnvelope>().error.request_id).toBe(res.headers['x-request-id']);
  });

  it('honours an inbound x-request-id', async () => {
    const { app } = await appThatThrows(new Error('boom'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/test-throws',
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
      url: '/api/nothing-here',
      headers: { 'x-request-id': 'x'.repeat(5_000) },
    });

    // The value is echoed into a response body and into log lines, so an
    // unbounded client-supplied string is a log-injection vector.
    expect(res.json<ErrorEnvelope>().error.request_id).not.toBe('x'.repeat(5_000));
    expect(res.json<ErrorEnvelope>().error.request_id?.length).toBeLessThanOrEqual(128);
  });

  it('generates a uuid when none is offered', async () => {
    const { app } = await createTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/nothing-here' });
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

    const res = await app.inject({ method: 'POST', url: '/api/test-protected', payload: {} });
    const body = res.json<ErrorEnvelope>();

    // Before the code/status split, a 403 arrived as `validation_failed`, so a
    // client could not tell "you typed it wrong" from "you may not do this".
    expect(res.statusCode).toBe(body.error.status);
    expect(body.error.code).toBe(ERROR_CODES.CAPABILITY_DENIED);
  });
});
