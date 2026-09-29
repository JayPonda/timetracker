import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from '@pdm/shared';

/**
 * The one error type a service throws, and the one code-to-status mapping.
 *
 * It lives in `lib/` rather than in `middleware/` on purpose: a **service** must be
 * able to refuse an invalid request, and a service importing from `middleware/`
 * would point the layer arrows the wrong way. So services and middleware both
 * depend on `lib/errors.ts`, and neither depends on the other (AGENTS.md
 * ground rule 1).
 *
 * The alternative — letting a service `throw new Error(...)` and letting the HTTP
 * handler guess a status from the text — is what `FR-GATE-08` and criterion 9 are
 * written against. A refusal with no type is a refusal the interface cannot render
 * a field name for, so the owner sees "Something went wrong" and loses what they
 * typed.
 */

/**
 * The canonical HTTP status for each code, in one map.
 *
 * Before this, the status was derived from whatever Fastify happened to attach,
 * and the code was derived from the status (`4xx` became `validation_failed`,
 * `5xx` became `internal`). That mapping was lossy in both directions: a 403
 * capability denial and a 422 validation failure are different failures for the
 * client, and both arrived as `validation_failed`. A code now **names** the
 * failure and the status follows, so the two cannot drift.
 */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CAPABILITY_DENIED]: 403,
  [ERROR_CODES.VALIDATION_FAILED]: 422,
  [ERROR_CODES.DATABASE_UNAVAILABLE]: 503,
  [ERROR_CODES.INTERNAL]: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** One rejected field, as the interface receives it (criterion 9, `UI-08`). */
export interface ValidationIssue {
  /**
   * The dotted path to the field, e.g. `name` or `links.0.url`.
   *
   * Dotted rather than a bare array because the owner reads this to find the
   * field, and `"links.0.url"` is something they can match against the form in
   * front of them. An array of `[0]`-indexed strings is not.
   */
  readonly path: string;
  readonly message: string;
  /** The Zod issue code, e.g. `too_small`, so a client can branch without parsing text. */
  readonly code: string;
}

/** The `details` payload carried by a validation failure. */
export interface ValidationDetails {
  readonly issues: readonly ValidationIssue[];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/** 422. The request was well-formed HTTP but the content is not acceptable. */
export function validationFailed(message: string, details?: unknown): AppError {
  return new AppError(ERROR_CODES.VALIDATION_FAILED, message, details);
}

/** 404. The entity does not exist, or exists and is archived and was not asked for. */
export function notFound(what: string): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, `${what} not found`);
}

/** 403. The principal is known but is not allowed to do this. */
export function capabilityDenied(message: string): AppError {
  return new AppError(ERROR_CODES.CAPABILITY_DENIED, message);
}

function fieldPath(path: ReadonlyArray<string | number>): string {
  return path.length === 0 ? '(root)' : path.join('.');
}

/**
 * Turn a Zod failure into `details` the interface can act on.
 *
 * Only `path`, `message` and `code` cross the boundary. The value the client sent
 * is **not** echoed back: criterion 9 also requires that the typed value is
 * preserved, and the way to satisfy that is for the browser to leave the field
 * alone rather than to have the server re-state it. Echoing arbitrary input into
 * a response is also how a password ends up in a log line.
 */
export function validationDetails(error: z.ZodError): ValidationDetails {
  return {
    issues: error.issues.map((issue) => ({
      path: fieldPath(issue.path),
      message: issue.message,
      code: issue.code,
    })),
  };
}

/** The message to show when a payload fails its schema, naming the first bad field. */
export function validationMessage(details: ValidationDetails): string {
  const first = details.issues[0];
  if (!first) return 'Validation failed';
  return details.issues.length === 1
    ? `${first.path}: ${first.message}`
    : `${first.path}: ${first.message} (and ${details.issues.length - 1} more)`;
}
