import { afterEach, describe, expect, it } from 'vitest';
import { setNowMsForTesting } from '@pdm/shared';
import {
  createConsoleChannel,
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
 * than on stdout. Nothing here is mocked away: the real level filter, the real
 * clock and the real formatter all run.
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

const ORIGINAL_LOG_LEVEL = process.env['LOG_LEVEL'];

afterEach(() => {
  setNowMsForTesting();
  resetLoggerForTesting();
  if (ORIGINAL_LOG_LEVEL === undefined) delete process.env['LOG_LEVEL'];
  else process.env['LOG_LEVEL'] = ORIGINAL_LOG_LEVEL;
});

describe('the line format', () => {
  it('prints datetime, level, call site and message in that order', () => {
    setNowMsForTesting(() => Date.UTC(2026, 8, 29, 9, 41, 12, 4));

    const line = formatRecord({
      level: 'info',
      atMs: Date.UTC(2026, 8, 29, 9, 41, 12, 4),
      file: 'boot.ts',
      method: 'main',
      message: 'listening',
      meta: {},
    });

    expect(line).toBe('[2026-09-29T09:41:12.004Z] [INFO] (boot.ts) (main) listening');
  });

  it('appends meta as key=value pairs', () => {
    const line = formatRecord({
      level: 'info',
      atMs: 0,
      file: 'timer.service.ts',
      method: 'start',
      message: 'timer started',
      meta: { task_id: 42, todo_id: 7, tag: 'focus' },
    });

    expect(line).toContain(
      '(timer.service.ts) (start) timer started task_id=42 todo_id=7 tag=focus',
    );
  });

  it('joins several keys with a single space', () => {
    const line = formatRecord({
      level: 'debug',
      atMs: 0,
      file: 'a.ts',
      method: 'm',
      message: 'msg',
      meta: { a: 1, b: 2 },
    });

    expect(line).toMatch(/msg a=1 b=2$/);
  });

  it('prints the level in upper case', () => {
    const line = formatRecord({
      level: 'warn',
      atMs: 0,
      file: 'a.ts',
      method: 'm',
      message: 'x',
      meta: {},
    });

    expect(line).toContain('[WARN]');
  });
});

describe('meta rendering', () => {
  const render = (meta: Record<string, unknown>): string =>
    formatRecord({ level: 'info', atMs: 0, file: 'a.ts', method: 'm', message: 'msg', meta });

  it('renders null as the word null', () => {
    expect(render({ project_id: null })).toContain('project_id=null');
  });

  it('keeps a key whose value is undefined', () => {
    // Dropping it would make "unset" and "not passed" indistinguishable.
    expect(render({ project_id: undefined })).toContain('project_id=undefined');
  });

  it('renders a boolean', () => {
    expect(render({ archived: false })).toContain('archived=false');
  });

  it('renders a nested object as JSON', () => {
    expect(render({ criteria: { met: 2, total: 3 } })).toContain('criteria={"met":2,"total":3}');
  });

  it('renders an array as JSON', () => {
    expect(render({ tags: ['a', 'b'] })).toContain('tags=["a","b"]');
  });

  it('quotes a value containing a space so the line stays parseable', () => {
    expect(render({ name: 'two words' })).toContain('name="two words"');
  });

  it('quotes a value containing a quote', () => {
    expect(render({ name: 'say "hi"' })).toContain(String.raw`name="say \"hi\""`);
  });

  it('leaves a single bare word unquoted', () => {
    expect(render({ name: 'todo' })).toContain('name=todo');
  });

  it('renders an Error as name and message', () => {
    expect(render({ err: new TypeError('bad input') })).toContain('err="TypeError: bad input"');
  });

  it('renders a Date in ISO form', () => {
    expect(render({ at: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) })).toContain(
      'at=2026-01-02T03:04:05.000Z',
    );
  });

  it('renders a self-referencing object instead of throwing', () => {
    // A logger that throws while rendering takes the request down with it.
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;

    expect(render({ loop })).toContain('"self":"[Circular]"');
  });

  it('renders an object that cannot be serialised instead of throwing', () => {
    const hostile = {
      get boom(): never {
        throw new Error('getter');
      },
    };

    expect(render({ hostile })).toContain('hostile=[Unserializable]');
  });

  it('renders no trailing space when meta is empty', () => {
    expect(render({})).not.toMatch(/\s$/);
  });
});

describe('the stack of a logged error', () => {
  const withStack = (level: 'error' | 'fatal' | 'warn'): string => {
    const { channel, lines } = makeChannel();
    const log = new Logger({ level: 'trace', channel });
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at somewhere';

    log[level]('a.ts', 'm', 'failed', { err });

    return lines[0] ?? '';
  };

  it('is included at error', () => {
    expect(withStack('error')).toContain(String.raw`stack="Error: boom\n    at somewhere"`);
  });

  it('is included at fatal', () => {
    expect(withStack('fatal')).toContain('stack=');
  });

  it('is left out at warn, where the caller is narrating', () => {
    expect(withStack('warn')).not.toContain('stack=');
  });
});

describe('level filtering', () => {
  const everyLevel = (): string[] => {
    const { channel, records } = makeChannel();
    const log = new Logger({ level: 'trace', channel });

    for (const name of LOG_LEVELS) {
      if (name === 'silent') continue;
      log[name]('a.ts', 'm', name);
    }

    return records.map((record) => record.level);
  };

  it('prints every level when set to trace', () => {
    expect(everyLevel()).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('drops everything below the configured level', () => {
    const { channel, lines } = makeChannel();
    const log = new Logger({ level: 'warn', channel });

    log.debug('a.ts', 'm', 'noisy');
    log.info('a.ts', 'm', 'noisy');
    log.warn('a.ts', 'm', 'kept');
    log.error('a.ts', 'm', 'kept');

    expect(lines).toHaveLength(2);
  });

  it('keeps the good path, not only the failures', () => {
    // The point of the class: a log that records only errors cannot answer
    // "what did the app do at 14:03".
    const { channel, lines } = makeChannel();
    const log = new Logger({ level: 'info', channel });

    log.info('task.service.ts', 'create', 'task created', { task_id: 42 });

    expect(lines[0]).toContain('[INFO]');
    expect(lines[0]).toContain('task created');
  });

  it('prints nothing at all when silent', () => {
    const { channel, lines } = makeChannel();
    const log = new Logger({ level: 'silent', channel });

    log.trace('a.ts', 'm', 'x');
    log.debug('a.ts', 'm', 'x');
    log.info('a.ts', 'm', 'x');
    log.warn('a.ts', 'm', 'x');
    log.error('a.ts', 'm', 'x');
    log.fatal('a.ts', 'm', 'x');

    expect(lines).toHaveLength(0);
  });

  it('reports whether a level would be printed', () => {
    const log = new Logger({ level: 'info' });

    expect(log.isLevelEnabled('debug')).toBe(false);
    expect(log.isLevelEnabled('info')).toBe(true);
    expect(log.isLevelEnabled('error')).toBe(true);
  });
});

describe('resolving the level from the environment', () => {
  it('accepts a known level', () => {
    expect(resolveLevel('debug').level).toBe('debug');
  });

  it('ignores case and surrounding space', () => {
    expect(resolveLevel('  WARN  ').level).toBe('warn');
  });

  it('falls back when the value is missing', () => {
    expect(resolveLevel(undefined).level).toBe('info');
  });

  it('falls back instead of throwing on a typo', () => {
    // A logger that throws on a bad level cannot report the boot failure that
    // the bad level caused.
    const result = resolveLevel('verbose');

    expect(result.level).toBe('info');
    expect(result.invalid).toBe('verbose');
  });

  it('records the rejected value so boot can name it', () => {
    process.env['LOG_LEVEL'] = 'loud';
    const log = new Logger({ fallbackLevel: 'warn' });

    expect(log.level).toBe('warn');
    expect(log.invalidLevel).toBe('loud');
  });
});

describe('the singleton', () => {
  it('is the same object every time it is imported', () => {
    expect(logger).toBe(logger);
  });

  it('keeps its identity when reconfigured', () => {
    // A module that already imported the logger must keep working after boot
    // changes the level.
    const before = logger;
    const { channel } = makeChannel();

    logger.configure({ level: 'error', channel });

    expect(logger).toBe(before);
    expect(logger.level).toBe('error');
  });

  it('reads LOG_LEVEL when no level is passed', () => {
    process.env['LOG_LEVEL'] = 'trace';
    const log = new Logger({ channel: makeChannel().channel });

    expect(log.level).toBe('trace');
  });

  it('prefers an explicit level over the environment', () => {
    process.env['LOG_LEVEL'] = 'trace';
    const log = new Logger({ level: 'error' });

    expect(log.level).toBe('error');
  });
});

describe('the console channel', () => {
  const sent = (level: 'trace' | 'info' | 'warn' | 'error'): string => {
    const calls: string[] = [];
    const stub = {
      debug: (): void => void calls.push('debug'),
      info: (): void => void calls.push('info'),
      warn: (): void => void calls.push('warn'),
      error: (): void => void calls.push('error'),
    };

    const record: LogRecord = { level, atMs: 0, file: 'a.ts', method: 'm', message: 'x', meta: {} };
    createConsoleChannel(stub).write(record, 'line');

    return calls[0] ?? '';
  };

  it('sends info to console.info', () => {
    expect(sent('info')).toBe('info');
  });

  it('sends warn to console.warn, which Node routes to stderr', () => {
    expect(sent('warn')).toBe('warn');
  });

  it('sends error to console.error, which Node routes to stderr', () => {
    expect(sent('error')).toBe('error');
  });

  it('sends trace to console.debug', () => {
    expect(sent('trace')).toBe('debug');
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

    expect(() => log.info('a.ts', 'm', 'x')).not.toThrow();
  });
});
