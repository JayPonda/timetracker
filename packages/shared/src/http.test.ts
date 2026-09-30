import { describe, expect, it } from 'vitest';
import {
  API_V1,
  UI_V1,
  UI_ENTRY_PATH,
  UNPREFIXED_ROUTES,
  isDeclaredRouteAllowed,
  isUiPath,
  readyResponseSchema,
} from './http.js';

/**
 * The URL scheme (ADR 0013).
 *
 * These tests exist because the split is enforced at boot rather than agreed by
 * convention. The enforcement is only as trustworthy as this list, so the list
 * itself is asserted: a fourth unprefixed route added to the allowlist without
 * a decision, or a path that slips past the check, is the failure to catch here.
 */
describe('ADR 0013: every API route is under /api/v1 and every UI route is under /ui/v1', () => {
  it('declares the two versioned namespaces as literals', () => {
    // A literal, not `/api/${SCHEME_VERSION}`. A derived prefix would move every
    // existing path the moment the version changed, which would make a v2 a
    // breaking cutover instead of a second set of routes beside the first.
    expect(API_V1).toBe('/api/v1');
    expect(UI_V1).toBe('/ui/v1');
  });

  it('points the root redirect at a real UI route', () => {
    // A redirect to a path that does not exist is worse than no redirect: it
    // moves the owner away from the address that works.
    expect(UI_ENTRY_PATH.startsWith(`${UI_V1}/`)).toBe(true);
  });

  it('carries no shared version constant that could move both at once', () => {
    // The property that makes a future v2 additive. A regression here — someone
    // "tidying" the literal back into a template — would still pass the two
    // assertions above, so it needs its own test.
    expect(API_V1).not.toContain('$');
    expect(UI_V1).not.toContain('$');
  });
});

describe('ADR 0013: only the probes and the root redirect are unprefixed', () => {
  it('allows exactly the three agreed paths', () => {
    expect([...UNPREFIXED_ROUTES]).toEqual(['/health', '/ready', '/']);
  });

  it('refuses a bare API path, so a missed prefix cannot reach the network', () => {
    // The whole point of the allowlist: `/tasks` unprefixed is ambiguous between
    // the JSON list and the HTML screen, so it is not a legal path at all.
    expect(isDeclaredRouteAllowed('/tasks')).toBe(false);
    expect(isDeclaredRouteAllowed('/projects')).toBe(false);
  });

  it('refuses an unprefixed sub-resource of a real route', () => {
    // A prefix check written as `startsWith` on the first segment alone would
    // let this through, because `/tasks/42` does start with a known segment.
    expect(isDeclaredRouteAllowed('/tasks/42/todos')).toBe(false);
    expect(isDeclaredRouteAllowed('/health/detail')).toBe(false);
  });

  it('refuses a probe name reached by a near miss', () => {
    expect(isDeclaredRouteAllowed('/healthz')).toBe(false);
    expect(isDeclaredRouteAllowed('/ready/')).toBe(false);
  });

  it('refuses the unversioned /api, which is the whole point of the split', () => {
    // The mistake this scheme exists to prevent: `/api/tasks` beside
    // `/api/v1/tasks`. The first is refused, not a silent alias.
    expect(isDeclaredRouteAllowed('/api/tasks')).toBe(false);
    expect(isDeclaredRouteAllowed('/api/v1')).toBe(false);
  });

  it('refuses a UI path, because pages are served by the static mount', () => {
    // A page must never be a *declared* route. If it could be, it would acquire
    // a capability guard — and an HTML response has no principal to guard.
    expect(isDeclaredRouteAllowed('/ui/v1/tasks')).toBe(false);
  });

  it('refuses a path that only looks like the API prefix', () => {
    // `startsWith('/api/v1')` without the separator would admit `/api/v1beta`.
    expect(isDeclaredRouteAllowed('/api/v1beta/tasks')).toBe(false);
  });

  it('allows a versioned API route, including a deep one', () => {
    expect(isDeclaredRouteAllowed('/api/v1/tasks')).toBe(true);
    expect(isDeclaredRouteAllowed('/api/v1/tasks/42/criteria')).toBe(true);
  });

  it('allows the three agreed unprefixed routes', () => {
    for (const url of ['/health', '/ready', '/']) {
      expect(isDeclaredRouteAllowed(url)).toBe(true);
    }
  });
});

describe('ADR 0013: the SPA fallback reaches only the UI namespace', () => {
  it('allows the versioned UI base and everything under it', () => {
    expect(isUiPath('/ui/v1')).toBe(true);
    expect(isUiPath('/ui/v1/')).toBe(true);
    expect(isUiPath('/ui/v1/tasks/42')).toBe(true);
    expect(isUiPath('/ui/v1/assets/index-abc123.js')).toBe(true);
  });

  it('refuses the unversioned /ui, which was never served', () => {
    // The UI lives at `/ui/v1`. A bare `/ui` is a version that does not exist,
    // and handing it a page would show an owner a blank screen at a
    // half-remembered address instead of saying it is not found.
    expect(isUiPath('/ui')).toBe(false);
    expect(isUiPath('/ui/')).toBe(false);
    expect(isUiPath('/ui/tasks')).toBe(false);
  });

  it('refuses a path that only looks like the UI base', () => {
    // `/uix` and `/ui-api` are the two mistakes a prefix check makes by
    // accident, and both would be a namespace leak if they got through.
    expect(isUiPath('/uix')).toBe(false);
    expect(isUiPath('/ui-api')).toBe(false);
  });

  it('refuses the API namespace and the probes', () => {
    expect(isUiPath('/api/v1/tasks')).toBe(false);
    expect(isUiPath('/health')).toBe(false);
    expect(isUiPath('/ready')).toBe(false);
  });

  it('refuses every unknown unprefixed path, which is the regression it prevents', () => {
    // The fallback used to exclude `/api` specifically, so a mistyped `/tasks`
    // returned the whole app shell with a 200.
    expect(isUiPath('/tasks')).toBe(false);
    expect(isUiPath('/')).toBe(false);
  });
});

describe('ADR 0013: the readiness answer is not the health answer renamed', () => {
  it('carries only what a readiness question needs', () => {
    const parsed = readyResponseSchema.parse({
      status: 'ready',
      db: 'ok',
      migrations_pending: 0,
      now_ms: 1_700_000_000_000,
    });

    expect(parsed.status).toBe('ready');
    // `version` and `uptime_s` belong to `/health`. Their absence here is what
    // makes the two routes distinguishable rather than two spellings of one.
    expect(parsed).not.toHaveProperty('version');
    expect(parsed).not.toHaveProperty('uptime_s');
  });

  it('accepts a reason only alongside not_ready', () => {
    expect(
      readyResponseSchema.safeParse({
        status: 'not_ready',
        db: 'error',
        migrations_pending: 0,
        reason: 'database is unreachable',
        now_ms: 1_700_000_000_000,
      }).success,
    ).toBe(true);
  });
});
