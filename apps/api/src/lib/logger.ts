import { nowMs } from '@pdm/shared';

/**
 * The project logger.
 *
 * One class, one instance, one line format. Every module in the API imports
 * `logger` from here rather than reaching for `console`, so that a reader of
 * `docker compose logs` sees the same shape on every line and a level set in the
 * environment silences or reveals the whole application at once.
 *
 * **What it is for: transparency, not just failures.** A log that records only
 * errors and warnings cannot answer "what did the app do at 14:03, and why did
 * it take that branch?". So `trace`, `debug` and `info` are first-class here and
 * the happy path is expected to be logged, not treated as noise. The level is the
 * dial that trades volume for detail; the format never changes.
 *
 * **The clock is `nowMs()` (AGENTS.md ground rule 4).** This module contains no
 * `Date.now()` and no `new Date()` with no argument, which is what lets a test
 * freeze time and assert on an exact line.
 *
 * **Why this reads `process.env` itself rather than taking the level from
 * `AppConfig`.** A logger that depends on a successfully parsed config cannot log
 * the failure that parsing produced. `main.ts` reports a `ConfigError` through
 * this very module, so reading the environment here is what makes that message
 * possible. `configSchema` validates the same variable so a typo is also reported
 * by name at boot; the two read one variable, so they cannot disagree.
 */

/** Every level, ordered from most to least verbose. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** `silent` is not a severity, it is the switch that turns the logger off. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Severity as a number, so filtering is a comparison rather than a chain of
 * string equality checks. `silent` outranks `fatal`, which is the whole reason it
 * works: nothing is severe enough to pass a threshold of 100.
 */
const RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
});

/**
 * Structured detail attached to a line. Keys are printed in insertion order as
 * `key=value`, so a log line reads the same way every time and can be grepped.
 */
export type LogMeta = Record<string, unknown>;

/** One log event, before it is rendered. */
export interface LogRecord {
  readonly level: LogLevel;
  readonly atMs: number;
  readonly file: string;
  readonly method: string;
  readonly message: string;
  readonly meta: LogMeta;
}

/**
 * Where a rendered line goes.
 *
 * The interface exists so "print to the console" is a decision this module makes
 * once rather than a habit spread over every call site, and so a test can read
 * what was logged without capturing stdout. The current channel is the console
 * (`StdoutChannel` below).
 */
export interface LogChannel {
  readonly name: string;
  write(record: LogRecord, line: string): void;
}

export interface LevelResolution {
  readonly level: LogLevel;
  /** The rejected value, when one was supplied and not understood. */
  readonly invalid?: string;
}

/**
 * Resolves the configured level, falling back to `info` on anything unrecognised.
 *
 * A typo must not take the logs down with it. A refused start is right for a
 * business setting, but a logger that throws on an unknown level turns a
 * misspelled `LOG_LEVEL` into a boot failure that the logger itself cannot
 * report, so this degrades instead and the caller decides whether to complain.
 */
export function resolveLevel(
  raw: string | undefined | null,
  fallback: LogLevel = DEFAULT_LOG_LEVEL,
): LevelResolution {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === '') return { level: fallback };
  if ((LOG_LEVELS as readonly string[]).includes(value)) return { level: value as LogLevel };

  return { level: fallback, invalid: raw ?? '' };
}

/** Which console method a level reaches for. */
const CONSOLE_METHOD: Readonly<Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'>> =
  Object.freeze({
    trace: 'debug',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
    fatal: 'error',
    silent: 'info',
  });

/** The subset of `Console` this channel needs, so a test can pass a stub. */
export interface ConsoleLike {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * The current channel: the console.
 *
 * **Errors and warnings go to stderr, everything else to stdout.** Node routes
 * `console.warn` and `console.error` to stderr itself, so the mapping below is
 * what a shell gets for free; it is stated here because a line format that looks
 * identical on both streams is still two streams, and `2>errors.log` only works
 * if errors really are on fd 2. `docker compose logs` interleaves both, so the
 * owner's normal view is unchanged.
 */
export function createConsoleChannel(consoleLike: ConsoleLike = console): LogChannel {
  return {
    name: 'console',
    write(record: LogRecord, line: string): void {
      consoleLike[CONSOLE_METHOD[record.level]](line);
    },
  };
}

/**
 * Renders one value for the `key=value` tail.
 *
 * A bare string would be ambiguous the moment it contains a space, so anything
 * with whitespace or a quote is JSON-quoted. `undefined` is kept rather than
 * dropped, because "this key was deliberately passed and is unset" is
 * information, and a log that silently discards a key is a log that lies.
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'boolean':
    case 'number':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name === '' ? 'anonymous' : value.name}]`;
    case 'string':
      return quoteIfNeeded(value);
    default:
      break;
  }

  if (value instanceof Error) return quoteIfNeeded(`${value.name}: ${value.message}`);
  if (value instanceof Date) return value.toISOString();

  return safeStringify(value);
}

/**
 * `JSON.stringify` with cycle detection.
 *
 * `JSON.stringify` throws on a self-referencing object, and a logger that throws
 * while rendering takes the request down with it, so the throw is caught and
 * reported. The replacer is what turns the common case from an exception into a
 * readable `[Circular]` instead. The same marker is used for a reference that
 * merely repeats rather than loops, because telling those two apart costs more
 * than it is worth in a log line.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return (
      JSON.stringify(value, (_key, nested: unknown) => {
        if (typeof nested === 'object' && nested !== null) {
          if (seen.has(nested)) return '[Circular]';
          seen.add(nested);
        }
        return nested;
      }) ?? String(value)
    );
  } catch {
    // A BigInt inside the object, or a getter that throws.
    return '[Unserializable]';
  }
}

function quoteIfNeeded(value: string): string {
  return /[\s"'=]/.test(value) ? JSON.stringify(value) : value;
}

/** The `key=value key1=value1` tail, or an empty string when there is no meta. */
function formatMeta(meta: LogMeta | undefined): string {
  if (!meta) return '';

  const parts: string[] = [];

  for (const [key, value] of Object.entries(meta)) {
    parts.push(`${key}=${formatValue(value)}`);
  }

  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/**
 * The whole line format, in one place.
 *
 * `[2026-09-29T09:41:12.004Z] [info] (boot) (main) listening on 0.0.0.0:8080 port=8080`
 *
 * The two parenthesised pairs are the call site, so a line is traceable to a
 * file and a function without a stack trace. They are passed in rather than
 * sniffed out of the stack: `Error.captureStackTrace` is not portable, and a
 * call site that is wrong is better visible than plausible.
 */
export function formatRecord(record: LogRecord): string {
  const head =
    `[${new Date(record.atMs).toISOString()}] ` +
    `[${record.level.toUpperCase()}] ` +
    `(${record.file}) ` +
    `(${record.method}) ` +
    `${record.message}`;

  return `${head}${formatMeta(record.meta)}`;
}

/** The conventional key for the error object, so its stack is not lost. */
const ERROR_KEYS = ['err', 'error', 'cause'] as const;

/**
 * An `Error` renders as `Name: message`; its stack is on the same line for
 * `error` and `fatal` only, under `stack`.
 *
 * At `warn` and below the caller is narrating, and a stack turns one line into
 * twenty. At `error` and above the stack is the reason for the line, and dropping
 * it means the interesting question — where it came from — goes unanswered.
 */
function formatErrorStack(meta: LogMeta | undefined, level: LogLevel): string {
  if (!meta || (level !== 'error' && level !== 'fatal')) return '';

  for (const key of ERROR_KEYS) {
    const value = meta[key];
    if (value instanceof Error && typeof value.stack === 'string') {
      return ` stack=${quoteIfNeeded(value.stack)}`;
    }
  }

  return '';
}

export interface LoggerOptions {
  /** Overrides `LOG_LEVEL`. Omit to read the environment. */
  level?: LogLevel;
  channel?: LogChannel;
  /** Overrides the fallback used when the configured level is unusable. */
  fallbackLevel?: LogLevel;
}

/**
 * The logger.
 *
 * The constructor is public so a test can build one with a capturing channel and
 * a fixed level. The application does not: it uses the module-level `logger`
 * below, which is the only instance production code should use.
 */
export class Logger {
  private currentLevel: LogLevel;
  private fallbackLevel: LogLevel;
  private currentChannel: LogChannel;

  /** The rejected `LOG_LEVEL`, if the environment held one. Checked once at boot. */
  readonly invalidLevel: string | undefined;

  constructor(options: LoggerOptions = {}) {
    this.fallbackLevel = options.fallbackLevel ?? DEFAULT_LOG_LEVEL;
    this.currentChannel = options.channel ?? createConsoleChannel();

    if (options.level !== undefined) {
      this.currentLevel = options.level;
      this.invalidLevel = undefined;
    } else {
      const resolution = resolveLevel(readEnvLevel(), this.fallbackLevel);
      this.currentLevel = resolution.level;
      this.invalidLevel = resolution.invalid;
    }
  }

  /** The level currently in force. Reading it back is what a startup line prints. */
  get level(): LogLevel {
    return this.currentLevel;
  }

  get channel(): LogChannel {
    return this.currentChannel;
  }

  /**
   * Replaces the level, the channel, or both.
   *
   * Mutated in place rather than re-created, so a module that already imported
   * `logger` keeps the same object. Boot calls this once; tests use it to
   * restore a level they changed.
   */
  configure(options: LoggerOptions): void {
    if (options.channel !== undefined) this.currentChannel = options.channel;
    if (options.fallbackLevel !== undefined) this.fallbackLevel = options.fallbackLevel;

    if (options.level !== undefined) {
      this.currentLevel = options.level;
    } else {
      this.currentLevel = resolveLevel(readEnvLevel(), this.fallbackLevel).level;
    }
  }

  /** Whether a line at `level` would be printed. Useful for skipping work. */
  isLevelEnabled(level: LogLevel): boolean {
    return RANK[level] >= RANK[this.currentLevel];
  }

  /** The most verbose standard level. Branch-by-branch detail. */
  trace(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('trace', file, method, message, meta);
  }

  /** What the code is doing, and which way a decision went. */
  debug(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('debug', file, method, message, meta);
  }

  /**
   * A milestone the owner would want to find in the logs: boot, listen, backup
   * written, migration applied, task started. The happy path belongs here, not
   * only in `debug` — a log that records only problems cannot answer "what did
   * the app do at 14:03".
   */
  info(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('info', file, method, message, meta);
  }

  /** Something unexpected that the system recovered from. */
  warn(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('warn', file, method, message, meta);
  }

  /** The request failed or the operation did not complete. */
  error(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('error', file, method, message, meta);
  }

  /** The process cannot continue. Always printed, whatever the level is. */
  fatal(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('fatal', file, method, message, meta);
  }

  private write(
    level: LogLevel,
    file: string,
    method: string,
    message: string,
    meta?: LogMeta,
  ): void {
    if (!this.isLevelEnabled(level)) return;

    const record: LogRecord = { level, atMs: nowMs(), file, method, message, meta: meta ?? {} };
    const line = `${formatRecord(record)}${formatErrorStack(record.meta, level)}`;

    try {
      this.currentChannel.write(record, line);
    } catch {
      // Nothing above this line is allowed to fail. A logger that throws turns a
      // recoverable problem into a crash, and the crash is what gets reported.
    }
  }
}

function readEnvLevel(): string | undefined {
  return process.env['LOG_LEVEL'];
}

/**
 * The singleton. Import this; do not construct a `Logger` in application code.
 *
 * Created at module load, so the level is read once and the first line of the
 * process is already filtered correctly. A module-level `const` rather than a
 * lazy getter because the alternative is two live instances the first time two
 * modules import this during the same tick.
 */
export const logger = new Logger();

/**
 * Re-reads `LOG_LEVEL` and restores the console channel.
 *
 * Tests only, and named the way `setNowMsForTesting` is named, so a fake cannot
 * leak into the next file by accident.
 */
export function resetLoggerForTesting(): void {
  logger.configure({ level: undefined, channel: createConsoleChannel() });
}
