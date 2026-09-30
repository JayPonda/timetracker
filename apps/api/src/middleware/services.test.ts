import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { CAPABILITIES } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { decorateServices, servicesOf } from './services.js';
import { principalResolver } from '../routes/test-support.js';

let harness: TestApp | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

describe('a route receives its service rather than building one', () => {
  it('exposes the services on the app', async () => {
    harness = await createTestApp();

    // A handler that constructed its own service would hold a second Knex pool,
    // and the transaction it opened would not be the one its other writes joined.
    expect(servicesOf(harness.app).activityLog).toBeDefined();
  });

  it('is the same instance on every read, so state is not rebuilt per request', async () => {
    harness = await createTestApp();
    expect(servicesOf(harness.app).activityLog).toBe(servicesOf(harness.app).activityLog);
  });

  it('the activity log service it holds actually writes', async () => {
    // The decorator is not a placeholder: the service it carries is the real one,
    // against the real database. A stub here would make every future route test
    // pass while proving nothing.
    harness = await createTestApp();

    await servicesOf(harness.app).activityLog.recordChange({
      entity: 'task',
      entityId: 1,
      action: 'created',
      before: null,
      after: { name: 'A' },
    });

    expect(await servicesOf(harness.app).activityLog.countForEntity('task', 1)).toBe(1);
  });

  it('is built even when the principal resolver is overridden', async () => {
    harness = await createTestApp({
      principalResolver: principalResolver({ kind: 'mcp_token', holds: [CAPABILITIES.TASK_READ] }),
    });

    expect(servicesOf(harness.app).activityLog).toBeDefined();
  });
});

describe('a handler that asks for services it does not have fails loudly', () => {
  it('throws rather than returning undefined, because a silent undefined becomes a TypeError', async () => {
    // The failure this prevents is a confusing one. A handler that got
    // `undefined` back would die three lines later on `undefined.tasks.create`,
    // and the stack would point at the handler instead of at the missing
    // decoration. This is the same reasoning as ground rule 12's "a logger that
    // takes down its caller is worse than no log", inverted: here the caller
    // depends on the value existing, so a clear throw is the useful answer.
    const bare = Fastify();

    expect(() => servicesOf(bare)).toThrow(/not decorated/);
  });

  it('names the fix in the message, so the reader is not left guessing', async () => {
    const bare = Fastify();

    expect(() => servicesOf(bare)).toThrow(/decorateServices/);
  });

  it('works again once the decorator is installed, so the check is not a blanket refusal', async () => {
    harness = await createTestApp();
    const bare = Fastify();
    expect(() => servicesOf(bare)).toThrow();

    decorateServices(bare, servicesOf(harness.app));

    expect(servicesOf(bare).activityLog).toBeDefined();
  });
});
