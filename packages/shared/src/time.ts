/**
 * Day boundaries in the configured time zone (NFR-TIME-01, ADR 0004).
 *
 * A day runs from local midnight to the next local midnight, not from 24 hours
 * after the previous midnight. On a day with a DST transition those are not the
 * same number of milliseconds, and a day total computed as `24 * 3600 * 1000`
 * drifts twice a year. `Intl.DateTimeFormat` is the one place that knows where
 * the zone moved, so every boundary goes through it.
 *
 * No SQLite `date()`, `datetime()` or `strftime()` may appear in the storage or
 * filter path (DATA-07, NFR-TIME-01).
 */

/** Milliseconds in a day. Only valid where the zone has no DST; see above. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock fields of `epochMs` as seen in `timeZone`. */
export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return a "${type}" part for zone ${timeZone}`);
    return Number(found.value);
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // `hour12: false` can yield 24 for midnight in some ICU versions; normalise
    // so a caller never has to know that.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** `YYYY-MM-DD` for an instant, in the given zone. */
export function localDateKey(epochMs: number, timeZone: string): string {
  const { year, month, day } = zonedParts(epochMs, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The offset of `timeZone` from UTC at `epochMs`, in milliseconds.
 *
 * Positive east of Greenwich. Derived by formatting the instant in the zone and
 * in UTC and comparing, which is why it is correct on a DST transition day.
 */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const z = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  // Drop sub-second precision: Intl does not report milliseconds.
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Epoch milliseconds of local midnight starting the civil date y-m-d in `timeZone`.
 *
 * Two passes settle the offset even where midnight itself does not exist
 * (spring forward) or happens twice (fall back): the first guess uses the
 * offset at midday, which is never ambiguous.
 */
function epochFromLocalMidnight(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(firstPass, timeZone);
}

/** Epoch milliseconds of local midnight starting the day that contains `epochMs`. */
export function startOfLocalDay(epochMs: number, timeZone: string): number {
  const { year, month, day } = zonedParts(epochMs, timeZone);
  return epochFromLocalMidnight(year, month, day, timeZone);
}

/**
 * Epoch milliseconds of the next local midnight, i.e. the exclusive end of the
 * day containing `epochMs`.
 *
 * Computed by advancing the **civil date** and converting again, never by adding
 * 24 hours. On a DST transition day those differ by an hour, and the difference
 * is exactly what a day total would be wrong by.
 */
export function endOfLocalDay(epochMs: number, timeZone: string): number {
  const { year, month, day } = zonedParts(epochMs, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return epochFromLocalMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
}

/** The `dateKey` values covering every day from `from` to `to`, inclusive. */
export function dateKeyRange(from: number, to: number, timeZone: string): string[] {
  const keys: string[] = [];
  let cursor = startOfLocalDay(from, timeZone);
  const limit = startOfLocalDay(to, timeZone);
  // Bound the loop so a reversed range cannot spin forever.
  let guard = 0;
  while (cursor <= limit && guard < 4000) {
    keys.push(localDateKey(cursor, timeZone));
    cursor = endOfLocalDay(cursor, timeZone);
    guard += 1;
  }
  return keys;
}
