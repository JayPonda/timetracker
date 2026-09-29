import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The one place the version is read (`VERSIONING.md`).
 *
 * `VERSIONING.md` says the version lives in exactly one place — `version` in the
 * root `package.json` — and is injected everywhere rather than typed in by hand.
 * That was not true: `/health` fell back to the literal `'0.1.0'` whenever
 * `npm_package_version` was unset, which it always is in the container, because
 * the image starts with `node api/main.js` and that variable only exists for
 * processes launched through a package script. So the displayed version was a
 * hardcoded string that would still read `0.1.0` at 0.12.0.
 *
 * Resolution order, most trustworthy first:
 *
 * 1. `PDM_VERSION` — set at build time by the Dockerfile, so a container built
 *    from a given tag reports that tag even if the file is unreadable.
 * 2. The root `package.json` — the real single source, readable in a `pnpm dev`
 *    run and in the image.
 * 3. `'0.0.0-unknown'`. A visibly wrong version beats a confidently wrong one:
 *    nobody believes `0.0.0-unknown` is a release, so the gap gets noticed.
 *
 * This module reads no clock and touches no database, so it is safe to import
 * anywhere.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The literal a caller sees if every other source is unavailable. */
export const UNKNOWN_VERSION = '0.0.0-unknown';

/** `apps/api/src` → the repository root, which is two levels up. */
function repositoryRoot(): string {
  return resolve(here, '..', '..', '..');
}

/**
 * Reads `version` from a `package.json` at `path`. Returns undefined rather than
 * throwing: a missing or malformed file is a packaging problem to report, not a
 * reason for `/health` to return a 500.
 */
function versionFromPackageJson(path: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      typeof (parsed as { version: unknown }).version === 'string'
    ) {
      return (parsed as { version: string }).version;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * The version this build reports.
 *
 * `packagePaths` exists so a test can point the file lookup at a temporary
 * directory. Without it the fallback branch is unreachable from a test, and an
 * unreachable branch is an untested branch.
 */
export function resolveVersion(packagePaths: readonly string[] = defaultPackagePaths()): string {
  const fromEnv = process.env.PDM_VERSION;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }

  for (const candidate of packagePaths) {
    const found = versionFromPackageJson(candidate);
    if (found !== undefined && found !== '') {
      return found;
    }
  }

  return UNKNOWN_VERSION;
}

/**
 * Where to look for the root `package.json`. Two candidates, because the
 * location differs between a `pnpm dev` run (tsconfig-built output under
 * `dist/`) and the image (`/app/api/version.js`).
 */
function defaultPackagePaths(): readonly string[] {
  return [
    join(repositoryRoot(), 'package.json'),
    join(here, '..', '..', 'package.json'),
  ];
}

/** The resolved version, for the many call sites that only need to read it. */
export const VERSION: string = resolveVersion();
