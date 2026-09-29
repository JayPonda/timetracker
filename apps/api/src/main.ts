import { boot } from './index.js';

/**
 * The process entry point.
 *
 * A failed boot exits non-zero with a message, rather than staying up and
 * serving broken responses. `docker compose` reads the exit code, so this is
 * what turns a bad migration or a bad `.env` into a visibly unhealthy container
 * instead of a quiet failure (DEP-09, DEP-05).
 */
boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pdm] boot failed: ${message}`);
  process.exitCode = 1;
});
