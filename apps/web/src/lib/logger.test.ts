import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatRecord,
  Logger,
  logger,
  LOG_LEVELS,
  resetLoggerForTesting,
  resolveLevel,
  type LogChannel,
  type LogRecord,
} from './logger.js';

/**
 * A channel that keeps what it was given, so a test asserts on the line rather
 * than on the devtools console.
 */
function makeChannel(): {
  records: LogRecord[];
  lines: string[];
  channel: LogChannel;
} {
  const records: LogRecord[] = [];
  const lines: string[] = [];

  const channel: LogChannel = {
    name: 'capture',
    write(record: LogRecord, line: string): void {
      records.push(record);
      lines.push(line);
    },
  };

  return { records, lines, channel };
}

afterEach(() => {
  resetLoggerForTesting();
  vi.unstubAllEnvs();
});

describe('the line format matches the API', () => {
  it('prints datetime, level, call site and message in that order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T09:41:12.004Z'));

    const line = formatRecord({
      level: 'info',
      atMs: Date.now(),
      file: 'Timer.tsx',
      method: 'handleStart',
      message: 'timer started',
      meta: {},
    });

    expect(line).toBe('[2026-09-29T09:41:12.004Z] [INFO] (Timer.tsx) (handleStart) timer started');
  });

  it('appends meta as key=value pairs', () => {
    const line = formatRecord({
      level: 'info',
      atMs: 0,
      file: 'Timer.tsx',
      method: 'handleStart',
      message: 'timer started',
      meta: { task_id: 42, todo_id: 7 },
    });

    expect(line).toContain('(Timer.tsx) (handleStart) timer started task_id=42 todo_id=7');
  });

  it('quotes a value containing a space so the line stays parseable', () => {
    const line = formatRecord({
      level: 'info',
      atMs: 0,
      file: 'a.tsx',
      method: 'm',
      message: 'x',
      meta: { name: 'two words' },
    });

    expect(line).toContain('name="two words"');
  });

  it('renders a self-referencing object instead of throwing', () => {
    // A logger that throws while rendering takes the render down with it.
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;

    const line = formatRecord({
      level: 'info',
      atMs: 0,
      file: 'a.tsx',
      method: 'm',
      message: 'x',
      meta: { loop },
    });

    expect(line).toContain('"self":"[Circular]"');
  });
});

describe('level filtering', () => {
  const everyLevel = (): string[] => {
    const { channel, records } = makeChannel();
    const log = new Logger({ level: 'trace', channel });

    for (const name of LOG_LEVELS) {
      if (name === 'silent') continue;
      log[name]('a.tsx', 'm', name);
    }

    return records.map((record) => record.level);
  };

  it('prints every level when set to trace', () => {
    expect(everyLevel()).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('prints nothing at all when silent', () => {
    const { channel, lines } = makeChannel();
    const log = new Logger({ level: 'silent', channel });

    for (const name of LOG_LEVELS) {
      if (name === 'silent') continue;
      log[name]('a.tsx', 'm', name);
    }

    expect(lines).toHaveLength(0);
  });

  it('keeps the good path, not only the failures', () => {
    const { channel, lines } = makeChannel();
    const log = new Logger({ level: 'info', channel });

    log.info('task.service.ts', 'create', 'task created', { task_id: 42 });

    expect(lines[0]).toContain('[INFO]');
  });
});

describe('the level source in a browser', () => {
  it('reads VITE_LOG_LEVEL, not LOG_LEVEL', () => {
    // Vite only exposes VITE_-prefixed variables, so a bare LOG_LEVEL is
    // undefined in a browser by construction.
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    vi.stubEnv('LOG_LEVEL', 'trace');

    expect(new Logger({ channel: makeChannel().channel }).level).toBe('debug');
  });

  it('falls back to info when the variable is absent', () => {
    expect(new Logger({ channel: makeChannel().channel }).level).toBe('info');
  });

  it('falls back instead of throwing on a typo', () => {
    const result = resolveLevel('chatty');

    expect(result.level).toBe('info');
    expect(result.invalid).toBe('chatty');
  });
});

describe('the singleton', () => {
  it('keeps its identity when reconfigured', () => {
    const before = logger;
    const { channel } = makeChannel();

    logger.configure({ level: 'error', channel });

    expect(logger).toBe(before);
    expect(logger.level).toBe('error');
  });

  it('prefers an explicit level over the environment', () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'trace');

    expect(new Logger({ level: 'warn' }).level).toBe('warn');
  });
});

describe('robustness', () => {
  it('does not throw when the channel itself throws', () => {
    // The one thing a logger must never do is take down the caller.
    const hostile = {
      name: 'hostile',
      write(): void {
        throw new Error('channel is down');
      },
    };

    const log = new Logger({ level: 'trace', channel: hostile as unknown as LogChannel });

    expect(() => log.info('a.tsx', 'm', 'x')).not.toThrow();
  });
});
