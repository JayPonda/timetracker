import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { assertSchemaReady } from '../index.js';

/**
 * The migrator's **exit code** is the contract the `pdm-migrate` container
 * depends on: `docker compose` waits for `service_completed_successfully`, and
 * that condition reads the exit code and nothing else.
 *
 * So this is a process-level test, not a function call. Calling `migrate()`
 * directly would pass while the container silently started the app anyway.
 */

const here = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(here, '..', '..', '..');

let root: string;
let counter = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdm-migrate-cli-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function env() {
  counter += 1;
  const dataDir = join(root, `data-${String(counter)}`);
  const backupDir = join(root, `backups-${String(counter)}`);
  return {
    dataDir,
    backupDir,
    ...process.env,
    PDM_DATA_DIR: dataDir,
    PDM_BACKUP_DIR: backupDir,
    TZ: 'UTC',
  };
}

/**
 * Runs the CLI as a child process and returns its exit code.
 *
 * The container runs the compiled `node api/cli/migrate.js`; in a checkout the
 * same entry point is `pnpm --filter api migrate`, which is also what the
 * server's refusal message tells the owner to run.
 */
function runMigrate(e: NodeJS.ProcessEnv): { code: number; output: string } {
  try {
    const stdout = execFileSync('pnpm', ['--filter', 'api', 'migrate'], {
      cwd: API_ROOT,
      env: e,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, output: String(stdout) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      output: `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}`,
    };
  }
}

describe('DEP-09: the migrator container succeeds only on a clean migration', () => {
  it('exits 0 and applies every migration on a clean database', () => {
    const e = env();
    const result = runMigrate(e);

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('0001_schema_migrations');
    expect(result.output).toContain('0002_settings');
  }, 120000);

  it('exits 0 on a second run, because it is idempotent', () => {
    const e = env();
    expect(runMigrate(e).code).toBe(0);

    const second = runMigrate(e);
    expect(second.code, second.output).toBe(0);
    expect(second.output).toContain('up to date');
  }, 120000);

  it('leaves the schema ready for the server to accept', () => {
    // The pairing the compose file depends on: migrator exits 0, then the server
    // starts. If the gate did not agree with the migrator, `pdm` would refuse.
    const e = env();
    const first = runMigrate(e);
    expect(first.code, first.output).toBe(0);

    const db = openDb({ file: join(e.PDM_DATA_DIR as string, 'pdm.db') });
    expect(() => assertSchemaReady(db)).not.toThrow();
    db.close();
  }, 120000);
});
