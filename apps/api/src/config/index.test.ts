import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configSchema, ConfigError, loadConfig } from './index.js';

function envOf(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe('DEP-05: the app runs with no .env at all', () => {
  it('every value has a working default', () => {
    const config = loadConfig(envOf());

    expect(config.PDM_INTERNAL_PORT).toBe(8080);
    expect(config.PDM_DATA_DIR).toBe('/data');
    expect(config.PDM_BACKUP_DIR).toBe('/backups');
    expect(config.PDM_BACKUP_COUNT).toBe(14);
    expect(config.TZ).toBe('UTC');
  });

  it('an empty environment still parses', () => {
    expect(configSchema.safeParse({}).success).toBe(true);
  });
});

describe('DEP-02: the bind address is 0.0.0.0 inside the container', () => {
  it('defaults to 0.0.0.0, not 127.0.0.1', () => {
    // ADR 0001: Docker's published port is the network boundary. Binding to
    // loopback here would break the future MCP container's access path.
    expect(loadConfig(envOf()).PDM_BIND_HOST).toBe('0.0.0.0');
  });
});

describe('DEP-02, R5: PDM_PORT is honoured so a local clash is avoidable', () => {
  it('accepts a custom port', () => {
    expect(loadConfig(envOf({ PDM_INTERNAL_PORT: '9090' })).PDM_INTERNAL_PORT).toBe(9090);
  });

  it('coerces a string from the environment to a number', () => {
    expect(loadConfig(envOf({ PDM_INTERNAL_PORT: '9090' })).PDM_INTERNAL_PORT).toBe(9090);
  });
});

describe('DEP-05: an invalid value fails the boot and names the variable', () => {
  it('rejects a non-numeric port', () => {
    expect(() => loadConfig(envOf({ PDM_INTERNAL_PORT: 'eight thousand' }))).toThrow(ConfigError);
  });

  it('names the offending variable in the message', () => {
    // A misconfiguration discovered three weeks later is far more expensive than
    // a refused start, so the message must be actionable.
    expect(() => loadConfig(envOf({ PDM_INTERNAL_PORT: 'eight thousand' }))).toThrow(
      /PDM_INTERNAL_PORT/,
    );
  });

  it('reports every offending variable, not just the first', () => {
    try {
      loadConfig(envOf({ PDM_INTERNAL_PORT: 'nope', PDM_BACKUP_COUNT: '0' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PDM_INTERNAL_PORT');
      expect(message).toContain('PDM_BACKUP_COUNT');
    }
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig(envOf({ PDM_INTERNAL_PORT: '70000' }))).toThrow(ConfigError);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig(envOf({ NODE_ENV: 'staging' }))).toThrow(ConfigError);
  });
});

describe('DEP-05: configuration is frozen once read', () => {
  it('cannot be mutated after boot', () => {
    const config = loadConfig(envOf());
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('test hygiene', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('mkdtemp is available for the db tests that need a real file', () => {
    roots.push(mkdtempSync(join(tmpdir(), 'pdm-config-')));
    expect(roots[0]).toContain('pdm-config-');
  });
});
