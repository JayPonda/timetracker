import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ERROR_CODES, UI_V1, isUiPath, type ErrorCode, type ErrorEnvelope } from '@pdm/shared';
import { AppError, validationDetails, validationMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { requestIdOf } from './request-id.js';

/**
 * The one error envelope (AGENTS.md Part 6, criterion 9).
 *
 * Every failure leaves the API in the same shape, so a client never parses a
 * message to find out what happened, and the stack trace never crosses the
 * boundary.
 */

interface ResolvedError {
  readonly code: ErrorCode;
  readonly status: number;
  readonly message: string;
  readonly details: unknown;
}

/**
 * Classify an error into a code, a status and a message safe to send.
 *
 * Order matters. `AppError` is checked first because a service that refused a
 * request has already decided what the failure is, and letting the generic
 * `statusCode` branch below second-guess it would undo the one place the decision
 * was made deliberately (criterion 9: the field name has to survive).
 */
function resolveError(error: unknown): ResolvedError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
    };
  }

  // A schema that was never `.parse()`d, because a handler passed the body
  // straight to a service. Turned into a named field rather than a 500, since a
  // malformed body is the client's mistake and saying so is the useful answer.
  if (error instanceof ZodError) {
    const details = validationDetails(error);
    return {
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
      message: validationMessage(details),
      details,
    };
  }

  const candidate = error as { statusCode?: unknown; message?: unknown; code?: unknown };
  const status =
    typeof candidate.statusCode === 'number' && candidate.statusCode >= 400
      ? candidate.statusCode
      : 500;

  // Fastify's own schema validation, which happens before a handler runs.
  if (status === 400) {
    return {
      code: ERROR_CODES.VALIDATION_FAILED,
      status: 422,
      message: typeof candidate.message === 'string' ? candidate.message : 'Validation failed',
      details: undefined,
    };
  }

  if (status === 404) {
    return {
      code: ERROR_CODES.NOT_FOUND,
      status: 404,
      message: typeof candidate.message === 'string' ? candidate.message : 'Not found',
      details: undefined,
    };
  }

  // 5xx and anything unrecognised. The message is replaced rather than passed
  // through, because a SQLite message can name a file path and a constraint name.
  return {
    code: ERROR_CODES.INTERNAL,
    status: 500,
    message: 'Internal server error',
    details: undefined,
  };
}

export function registerErrorEnvelope(app: FastifyInstance, webDir: string | undefined): void {
  const indexPath =
    webDir && existsSync(join(webDir, 'index.html'))
      ? join(resolve(webDir), 'index.html')
      : undefined;

  /**
   * One not-found handler, deciding three cases (0.1.0 design notes, ADR 0013).
   *
   * A client-side route like `/ui/tasks/42` has no file behind it, so it is
   * answered with `index.html` and the router resolves it. **Asset paths are
   * excluded**: answering a missing script with HTML produces a MIME-type error
   * in the browser that says nothing about the real cause, so those get a
   * normal 404 envelope instead.
   */
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const looksLikeAsset = /\.[a-z0-9]+$/i.test(path);

    // **Only the UI namespace reaches the SPA.** This is the boundary that keeps
    // `/api/v1` answering JSON and a mistyped `/tasks` answering a 404 envelope
    // rather than a page. An earlier version excluded `/api` specifically, which
    // meant every *other* unprefixed path was answered with HTML — the exact
    // ambiguity ADR 0013 removed. The condition is now the positive form of the
    // scheme, so a path outside it cannot be shadowed by the frontend.
    const uiPath = isUiPath(path);

    // The fallback serves pages, and pages are fetched with GET. Answering a
    // DELETE with 200 and HTML — which is what happened in production, where a
    // web build exists and the tests' no-build setup never saw it — tells a
    // client its deletion succeeded while deleting nothing. Every other method
    // falls through to the 404 envelope below.
    if (indexPath && uiPath && (req.method === 'GET' || req.method === 'HEAD')) {
      // A real asset is served as itself; anything else is a client-side route,
      // which the frontend router resolves.
      if (looksLikeAsset) {
        // Relative to the static root, which is what sendFile expects; an
        // absolute path is resolved against the root and misses. The UI prefix
        // is stripped because the plugin is mounted there (ADR 0013).
        const relative = path.slice(UI_V1.length);
        const assetPath = join(resolve(webDir!), relative);
        if (assetPath.startsWith(resolve(webDir!)) && existsSync(assetPath)) {
          return reply.sendFile(relative);
        }
      } else {
        return reply.sendFile('index.html');
      }
    }

    const body: ErrorEnvelope = {
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: `No route for ${req.method} ${req.url}`,
        status: 404,
        request_id: requestIdOf(req),
      },
    };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((error: unknown, req, reply) => {
    const resolved = resolveError(error);

    if (resolved.status >= 500) {
      // The full error goes to the log, the message does not go to the client.
      logger.error('middleware/error.ts', 'errorHandler', 'request failed', {
        err: error,
        url: req.url,
        method: req.method,
        request_id: requestIdOf(req),
      });
    } else {
      // A 4xx is a real event too: it is how a refused request is noticed at all,
      // and logging only 5xx would make a route that 403s everything look healthy.
      logger.info('middleware/error.ts', 'errorHandler', 'request refused', {
        code: resolved.code,
        status: resolved.status,
        url: req.url,
        method: req.method,
        request_id: requestIdOf(req),
      });
    }

    const body: ErrorEnvelope = {
      error: {
        code: resolved.code,
        message: resolved.message,
        status: resolved.status,
        request_id: requestIdOf(req),
        ...(resolved.details === undefined ? {} : { details: resolved.details }),
      },
    };
    void reply.status(resolved.status).send(body);
  });
}

/** Exported for the route table's tests, which assert the shape directly. */
export function envelopeFor(error: unknown, requestId: string): ErrorEnvelope {
  const resolved = resolveError(error);
  return {
    error: {
      code: resolved.code,
      message: resolved.message,
      status: resolved.status,
      request_id: requestId,
      ...(resolved.details === undefined ? {} : { details: resolved.details }),
    },
  };
}

export type { FastifyRequest };
