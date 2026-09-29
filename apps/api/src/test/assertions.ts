import { ERROR_CODES } from '@pdm/shared';

/**
 * The error codes, re-exported for a test that asserts this codebase does not
 * invent its own.
 *
 * The failure this guards against is a service throwing `new Error('not
 * allowed')` with a status hidden in the message. The client then cannot branch
 * on the failure, which is the thing `FR-GATE-08` and criterion 9 are written
 * against.
 */
export const APP_ERROR_CODES: readonly string[] = Object.values(ERROR_CODES);
