import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@pdm/shared';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { servicesOf } from './services.js';
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
