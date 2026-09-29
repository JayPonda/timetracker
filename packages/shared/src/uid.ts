import { nowMs } from './clock.js';

/**
 * The `uid` every user-data row carries (ground rule 8, `DATA-13`, ADR 0007).
 *
 * **UUIDv7, not v4**, for three reasons that all come from the same property —
 * the identifier sorts by creation time:
 *
 * 1. **Merge-only import.** `DATA-13` requires an import to match rows by `uid`
 *    and never to overwrite. A time-ordered id makes a diff of two databases
 *    readable, because "which rows are new" is a question about position.
 * 2. **Pagination without a separate key.** A cursor over `uid` is stable even
 *    while rows are being inserted, because a new row always sorts after the
 *    cursor rather than in the middle of the result set.
 * 3. **A primary key that does not fragment.** `id INTEGER PRIMARY KEY` is
 *    sequential and is the real key; `uid` is never indexed for lookup, so its
 *    randomness is free.
 *
 * The clock comes from `nowMs()` like everything else (ground rule 4), so a test
 * can freeze time and assert on the embedded timestamp. Nothing here calls
 * `Date.now()`.
 *
 * **Same-millisecond uids are not ordered among themselves.** This generates the
 * random bits fresh each call, so two rows created in the same millisecond have
 * an arbitrary relative order. That is allowed by RFC 9562 and is fine here
 * because nothing currently sorts by `uid`; a release that needs strict
 * monotonicity has to add a counter, and should say so when it does.
 */

const VERSION_7 = 0x70;
const VARIANT_RFC_4122 = 0x80;

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  // Web Crypto, which is a global in Node 19+ and in every browser this project
  // targets. `Math.random()` is explicitly not acceptable for an identifier: a
  // duplicate `uid` breaks a merge, and a guessable one lets a caller guess
  // another row's identity.
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** A new UUIDv7, as the canonical hyphenated string. */
export function newUid(): string {
  const ms = nowMs();
  const bytes = randomBytes();

  // 48 bits of `unix_ts_ms`, big-endian, overwriting the random bytes in [0, 6).
  // `>>> 0` and the explicit masking keep this correct above 2^31, which is 2038
  // and therefore not hypothetical for a database meant to last past 1.0.0.
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  // Version nibble in the high 4 bits of byte 6, variant bits in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | VERSION_7;
  bytes[8] = (bytes[8] & 0x3f) | VARIANT_RFC_4122;

  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** The creation time embedded in a UUIDv7, in epoch milliseconds. */
export function uidToMs(uid: string): number {
  const hex = uid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`Not a UUID: ${uid}`);
  return Number.parseInt(hex.slice(0, 12), 16);
}
