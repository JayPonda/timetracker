import { describe, expect, it } from 'vitest';
import { UI_ENTRY_PATH } from '@pdm/shared';
import { createTestApp } from '../test/helpers.js';

/**
 * `GET /` — the bare root (ADR 0013).
 *
 * The root is the one address a human types, and the one a stale bookmark points
 * at. Everything this app serves is versioned now, so the strictest reading of
 * the scheme is that `/` does not exist; these tests pin the decision that it
 * redirects instead, because a correct 404 at the front door reads as a broken
 * app.
 */
describe('ADR 0013: the bare root sends a browser to the UI', () => {
  it('redirects to the first real screen', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe(UI_ENTRY_PATH);
  });

  it('redirects into the versioned UI namespace', async () => {
    // A redirect that pointed at `/ui` would land on a version that was never
    // served, which answers 404 — the redirect would work and still be useless.
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.headers.location).toMatch(/^\/ui\/v1\//);
  });

  it('uses 308 so the method is preserved and the answer can be cached', async () => {
    // 302 lets a client cache a temporary answer, and a 301 or 302 on a later
    // POST invites a method rewrite. 308 says "this moved, stop asking".
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(308);
  });

  it('is public, because a redirect needs no capability', async () => {
    // No principal is installed, so a guarded route would answer 403 here.
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).not.toBe(403);
  });

  it('does not answer with a body, so no page is served unversioned', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.body).not.toContain('<!doctype html>');
  });
});
