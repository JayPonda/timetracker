/**
 * The clock seam (AGENTS.md ground rule 4, ADR 0004).
 *
 * Exactly one function in this codebase reads the system clock. Tests inject a
 * fake through `setNowMsForTesting`, so the timer and reminder tests are
 * deterministic instead of timing-dependent.
 *
 * Timestamps are epoch-millisecond integers in UTC (DATA-07). No ISO strings
 * reach the storage path.
 */

let clock: () => number = () => Date.now();

/** The current time in epoch milliseconds. The only clock in the project. */
export function nowMs(): number {
  return clock();
}

/**
 * Replaces the clock. Tests only.
 *
 * Passing no argument restores the real clock, so a test that forgets to
 * restore cannot leak a fake into the next file.
 */
export function setNowMsForTesting(impl?: () => number): void {
  clock = impl ?? (() => Date.now());
}
