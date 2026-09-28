import { z } from 'zod';

/**
 * Every runtime value comes from here, validated once at boot (DEP-05, ADR 0001).
 *
 * Two properties matter more than the list itself:
 *
 * 1. **Every field has a working default**, so the app runs with no `.env` at
 *    all. The owner should not need a second command to get a first run.
 * 2. **An invalid value fails the boot with a message naming the variable**,
 *    rather than starting in a state where one feature is quietly broken. A
 *    misconfigured `PDM_BACKUP_COUNT` discovered three weeks later is much more
 *    expensive than a refused start.
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),

  /**
   * Bound inside the container on purpose. Docker's published port is the
   * network boundary, and it is bound to 127.0.0.1 on the host (ADR 0001).
   * "Fixing" this to 127.0.0.1 breaks the future MCP container's access path,
   * so the constant carries that warning at the server bootstrap too.
   */
  PDM_BIND_HOST: z.string().default('0.0.0.0'),
  PDM_INTERNAL_PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  PDM_DATA_DIR: z.string().default('/data'),
  PDM_BACKUP_DIR: z.string().default('/backups'),
  PDM_BACKUP_COUNT: z.coerce.number().int().min(1).max(1000).default(14),

  /** The zone day boundaries and every displayed time are computed in (NFR-TIME-01). */
  TZ: z.string().default('UTC'),

  /** Directory of built frontend assets. Empty means "no frontend served". */
  PDM_WEB_DIR: z.string().default('/app/web'),
});

export type AppConfig = Readonly<z.infer<typeof configSchema>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Parses the environment into a frozen config.
 *
 * @throws {ConfigError} naming every offending variable, not just the first, so
 * a misconfigured `.env` is fixed in one pass rather than one restart per line.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);

  if (result.success) {
    return Object.freeze(result.data);
  }

  const details = result.error.issues
    .map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `  ${name}: ${issue.message}`;
    })
    .join('\n');

  throw new ConfigError(
    `Invalid configuration. Fix these environment variables and restart:\n${details}\n\n` +
      `See .env.example for the full list and each variable's meaning.`,
  );
}
