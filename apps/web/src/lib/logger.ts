/**
 * The browser logger.
 *
 * Deliberately a **separate implementation** from the API's, not a shared one.
 * The two run in different worlds: this one has no `process`, no stdout and no
 * environment to read at runtime, and its "channel" is the browser devtools
 * console rather than a container log. Sharing a class across that boundary
 * would mean the API's Node-only imports dragging into a bundle, or a
 * conditional level source that both runtimes pay for and only one uses.
 *
 * What is deliberately identical is the **line format** and the **level names**.
 * A log line from the frontend and one from the API have to be distinguishable
 * at a glance and grep-able the same way, and that consistency is worth the
 * duplication of a hundred lines.
 *
 * **`Date.now()` is allowed here and only here.** The API's ground rule 4 exists
 * so its tests are deterministic. This module has no timing behaviour to test
 * and no other module depends on its clock, so sealing it into `nowMs()` would
 * add an indirection with nothing behind it.
 */

/** Every level, ordered from most to least verbose. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

const RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
});

/** Structured detail attached to a line, printed as `key=value`. */
export type LogMeta = Record<string, unknown>;

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
 * In a browser the "channel" is the devtools console, and there is no stdout to
 * choose between: the browser decides which stream a given console method writes
 * to. The interface still exists, so the destination is a decision made once here
 * and so a test can read what was logged without a DOM.
 */
export interface LogChannel {
  readonly name: string;
  write(record: LogRecord, line: string): void;
}

/** The subset of `Console` this channel needs, so a test can pass a stub. */
export interface ConsoleLike {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

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

export function createConsoleChannel(consoleLike: ConsoleLike = console): LogChannel {
  return {
    name: 'console',
    write(record: LogRecord, line: string): void {
      consoleLike[CONSOLE_METHOD[record.level]](line);
    },
  };
}

export interface LevelResolution {
  readonly level: LogLevel;
  readonly invalid?: string;
}

/**
 * Resolves the configured level, falling back to `info` on anything unrecognised.
 *
 * A misspelled level must not silence the app, so this degrades instead of
 * throwing. `config.ts` validates the same variable and fails the build loudly,
 * which is where a typo should actually be caught.
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
 * while rendering takes the render down with it, so the throw is caught and
 * reported. The replacer turns the common case into a readable `[Circular]`
 * instead. The same marker is used for a reference that merely repeats rather
 * than loops, because telling those apart costs more than it is worth here.
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

function formatMeta(meta: LogMeta | undefined): string {
  if (!meta) return '';

  const parts: string[] = [];

  for (const [key, value] of Object.entries(meta)) {
    parts.push(`${key}=${formatValue(value)}`);
  }

  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/**
 * The line format, identical to the API's so a log read from the browser and one
 * read from the container are grep-able the same way.
 *
 * `[2026-09-29T09:41:12.004Z] [info] (timer) (start) timer started task_id=42`
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

const ERROR_KEYS = ['err', 'error', 'cause'] as const;

/** Stack lines are kept for `error` and `fatal` only; below that it is noise. */
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
  /** Overrides the environment. Omit to read `VITE_LOG_LEVEL`. */
  level?: LogLevel;
  channel?: LogChannel;
  fallbackLevel?: LogLevel;
}

export class Logger {
  private currentLevel: LogLevel;
  private fallbackLevel: LogLevel;
  private currentChannel: LogChannel;

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

  get level(): LogLevel {
    return this.currentLevel;
  }

  get channel(): LogChannel {
    return this.currentChannel;
  }

  /** Mutated in place, so an already-imported reference stays valid. */
  configure(options: LoggerOptions): void {
    if (options.channel !== undefined) this.currentChannel = options.channel;
    if (options.fallbackLevel !== undefined) this.fallbackLevel = options.fallbackLevel;

    if (options.level !== undefined) {
      this.currentLevel = options.level;
    } else {
      this.currentLevel = resolveLevel(readEnvLevel(), this.fallbackLevel).level;
    }
  }

  isLevelEnabled(level: LogLevel): boolean {
    return RANK[level] >= RANK[this.currentLevel];
  }

  /** Branch-by-branch detail. */
  trace(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('trace', file, method, message, meta);
  }

  /** What the code is doing, and which way a decision went. */
  debug(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('debug', file, method, message, meta);
  }

  /**
   * A milestone worth finding later. The happy path belongs here, not only in
   * `debug`, so the log can answer "what did the app do at 14:03".
   */
  info(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('info', file, method, message, meta);
  }

  /** Something unexpected that the app recovered from. */
  warn(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('warn', file, method, message, meta);
  }

  /** A request failed or an operation did not complete. */
  error(file: string, method: string, message: string, meta?: LogMeta): void {
    this.write('error', file, method, message, meta);
  }

  /** Cannot continue. */
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

    const record: LogRecord = { level, atMs: Date.now(), file, method, message, meta: meta ?? {} };
    const line = `${formatRecord(record)}${formatErrorStack(record.meta, level)}`;

    try {
      this.currentChannel.write(record, line);
    } catch {
      // A logger that throws turns a recoverable problem into a crash, and the
      // crash is what gets reported.
    }
  }
}

/**
 * The level comes from Vite, not from `process.env`.
 *
 * **Why the name differs from the API's `LOG_LEVEL`:** Vite only exposes
 * variables prefixed `VITE_` to the bundle, and it substitutes them at build
 * time. A bare `LOG_LEVEL` is `undefined` in the browser by construction, so
 * using the same name would look like it worked and silently log at the default.
 * The API runs in Node and keeps the unprefixed name.
 */
function readEnvLevel(): string | undefined {
  return import.meta.env['VITE_LOG_LEVEL'];
}

/** The singleton. Import this; do not construct a `Logger` in application code. */
export const logger = new Logger();

/** Tests only. Named so a fake cannot leak into the next file by accident. */
export function resetLoggerForTesting(): void {
  logger.configure({ level: undefined, channel: createConsoleChannel() });
}
