import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UNKNOWN_VERSION, resolveVersion } from './version.js';

const originalEnv = process.env.PDM_VERSION;

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.PDM_VERSION;
  } else {
    process.env.PDM_VERSION = originalEnv;
  }
});

describe('VERSIONING.md: the version is read, not typed in by hand', () => {
  it('reports a real version from the root package.json', () => {
    delete process.env.PDM_VERSION;

    // The single source of truth. If this ever stops matching package.json,
    // VERSIONING.md's central claim is false again.
    expect(resolveVersion()).toBe('0.1.0');
  });

  it('prefers PDM_VERSION, so a tagged build reports its tag', () => {
    process.env.PDM_VERSION = '9.9.9';

    expect(resolveVersion()).toBe('9.9.9');
  });

  it('trims the injected value', () => {
    process.env.PDM_VERSION = '  0.2.0  ';

    expect(resolveVersion()).toBe('0.2.0');
  });

  it('ignores an empty PDM_VERSION rather than reporting an empty string', () => {
    process.env.PDM_VERSION = '   ';

    expect(resolveVersion()).toBe('0.1.0');
  });

  it('falls back to an obviously-wrong value when no package.json is readable', () => {
    delete process.env.PDM_VERSION;

    expect(resolveVersion([join(tmpdir(), 'pdm-does-not-exist', 'package.json')])).toBe(
      UNKNOWN_VERSION,
    );
  });

  it('reads a version from a package.json elsewhere', () => {
    delete process.env.PDM_VERSION;
    const file = join(mkdtempSync(join(tmpdir(), 'pdm-version-')), 'package.json');
    writeFileSync(file, JSON.stringify({ version: '0.7.3' }));

    expect(resolveVersion([file])).toBe('0.7.3');
  });

  it('ignores a package.json with no usable version field', () => {
    delete process.env.PDM_VERSION;
    const dir = mkdtempSync(join(tmpdir(), 'pdm-version-'));
    const noVersion = join(dir, 'a.json');
    const wrongType = join(dir, 'b.json');
    writeFileSync(noVersion, JSON.stringify({ name: 'pdm' }));
    writeFileSync(wrongType, JSON.stringify({ version: 42 }));

    expect(resolveVersion([noVersion, wrongType])).toBe(UNKNOWN_VERSION);
  });

  it('ignores a malformed package.json rather than throwing', () => {
    delete process.env.PDM_VERSION;
    const file = join(mkdtempSync(join(tmpdir(), 'pdm-version-')), 'package.json');
    writeFileSync(file, '{ not json');

    expect(resolveVersion([file])).toBe(UNKNOWN_VERSION);
  });
});
