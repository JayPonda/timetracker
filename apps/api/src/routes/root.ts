import { UI_ENTRY_PATH } from '@pdm/shared';
import { logger } from '../lib/logger.js';
import type { RouteDeclaration } from './table.js';

/**
 * `GET /` — the bare root, and the only other unprefixed route (ADR 0013).
 *
 * **Why the root is not a 404.** Everything this app serves is prefixed now, so
 * the strictest reading of the scheme is that `/` does not exist. But the root
 * is the one address a human types, and the one a bookmark or a `docker compose
 * up` habit sends them to. Answering "page not found" there would be a correct
 * implementation of the rule and a poor experience: the owner's first click
 * after every upgrade would look like a broken app.
 *
 * **308, not 302.** The redirect is permanent and the method must be preserved.
 * A 302 would let a client cache a temporary answer, and a 301/302 on a later
 * `POST` invites a method rewrite. 308 says "this moved, stop asking", which is
 * true.
 *
 * It targets the first real screen rather than the UI index, so the address bar
 * shows where the owner actually is and a reload is not a redirect hop.
 */
export function rootRoute(): RouteDeclaration {
  return {
    method: 'GET',
    url: '/',
    public: true,
    capabilities: [],
    description: 'Send the bare root to the first real screen',
    handler: async (_req, reply) => {
      // `debug`, not `info`: this fires on every mistyped or stale address, so
      // at info level it would drown the lines an owner is looking for.
      logger.debug('routes/root.ts', 'root', 'redirecting the bare root to the UI', {
        to: UI_ENTRY_PATH,
      });
      return reply.redirect(UI_ENTRY_PATH, 308);
    },
  };
}
