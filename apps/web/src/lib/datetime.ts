/**
 * Time formatting for the configured zone (acceptance criterion 11, NFR-TIME-01).
 *
 * Two rules live here.
 *
 * **The browser never reads the clock.** Every function takes an epoch
 * millisecond value as an argument, and `Intl.DateTimeFormat#format` is given
 * that number directly, so this module contains no `Date.now()` and no
 * `new Date()`. The value comes from the server (`/health`'s `now_ms`), which
 * keeps `nowMs()` the single clock in the codebase (AGENTS.md, rule 4).
 *
 * **The zone is the configured one, not the browser's.** Passing an explicit
 * `timeZone` means a laptop whose OS is set to a different zone still shows
 * `PDM_TZ`, which is the whole point of configuring it. Omitting the option
 * would silently fall back to the browser's zone and quietly break the
 * requirement.
 */

/**
 * `HH:MM:SS` in `timeZone`, 24-hour.
 *
 * `hour12: false` is explicit because some locales render midnight as `24` in
 * 12-hour mode, which would make the displayed time disagree with the stored
 * timestamp.
 */
export function formatClock(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(epochMs);
}

/**
 * A full date and time in `timeZone`, for anywhere a date must be readable.
 */
export function formatDateTime(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(epochMs);
}

/**
 * Whether a zone name is one `Intl` can actually use.
 *
 * `/health` echoes whatever `PDM_TZ` was set to, and the value is only
 * config-validated, not checked against the IANA database. A bad zone throws a
 * `RangeError` from `Intl`, which would otherwise surface as the error
 * boundary. The shell shows the raw value and falls back to the server's
 * numeric time instead.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}
