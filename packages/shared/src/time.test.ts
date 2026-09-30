import { describe, expect, it } from 'vitest';
import {
  dateKeyRange,
  endOfLocalDay,
  localDateKey,
  startOfLocalDay,
  zonedParts,
  zoneOffsetMs,
} from './time.js';

/** Epoch ms for a UTC wall-clock time, so the fixtures read as dates. */
function utc(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return Date.UTC(y, m - 1, d, h, min, s);
}

describe('NFR-TIME-01: an instant reads as the right local date', () => {
  it('uses the configured zone, not UTC', () => {
    // 2026-03-10T22:00Z is 2026-03-11 03:30 in Kolkata (UTC+5:30).
    expect(localDateKey(utc(2026, 3, 10, 22, 0), 'Asia/Kolkata')).toBe('2026-03-11');
  });

  it('agrees with UTC when the zone is UTC', () => {
    expect(localDateKey(utc(2026, 3, 10, 22, 0), 'UTC')).toBe('2026-03-10');
  });

  it('reports midnight as hour zero, never 24', () => {
    // Some ICU versions render midnight as 24 under hour12: false. A caller must
    // never have to know that.
    const parts = zonedParts(utc(2026, 3, 10), 'UTC');
    expect(parts.hour).toBe(0);
  });
});

describe('NFR-TIME-01: a day starts at local midnight', () => {
  it('returns the epoch ms of local midnight', () => {
    const start = startOfLocalDay(utc(2026, 3, 10, 15, 30), 'Asia/Kolkata');
    expect(start).toBe(utc(2026, 3, 9, 18, 30));
  });

  it('is idempotent for an instant already at midnight', () => {
    const midnight = startOfLocalDay(utc(2026, 3, 10, 15, 30), 'Asia/Kolkata');
    expect(startOfLocalDay(midnight, 'Asia/Kolkata')).toBe(midnight);
  });
});

describe('NFR-TIME-01: a day is not always 24 hours', () => {
  it('is 24 hours on an ordinary day', () => {
    const start = startOfLocalDay(utc(2026, 6, 15, 12), 'UTC');
    expect(endOfLocalDay(utc(2026, 6, 15, 12), 'UTC') - start).toBe(24 * 60 * 60 * 1000);
  });

  it('is 23 hours on the spring-forward day', () => {
    // US DST 2026 starts 2026-03-08. 02:00 local never happens, so the day is
    // an hour short. A day total computed as 24*3600*1000 drifts here.
    const tz = 'America/New_York';
    const start = startOfLocalDay(utc(2026, 3, 8, 16), tz);
    const end = endOfLocalDay(utc(2026, 3, 8, 16), tz);

    expect(end - start).toBe(23 * 60 * 60 * 1000);
  });

  it('is 25 hours on the fall-back day', () => {
    // 2026-11-01: 01:00 local happens twice, so the day is an hour long.
    const tz = 'America/New_York';
    const start = startOfLocalDay(utc(2026, 11, 1, 16), tz);
    const end = endOfLocalDay(utc(2026, 11, 1, 16), tz);

    expect(end - start).toBe(25 * 60 * 60 * 1000);
  });

  it('places local midnight correctly on the spring-forward day', () => {
    // New York is UTC-5 before the transition and UTC-4 after it.
    const start = startOfLocalDay(utc(2026, 3, 8, 16), 'America/New_York');
    expect(localDateKey(start, 'America/New_York')).toBe('2026-03-08');
  });
});

describe('NFR-TIME-01: the zone offset is correct across a transition', () => {
  it('is -5 hours before the US spring-forward', () => {
    expect(zoneOffsetMs(utc(2026, 3, 7, 12), 'America/New_York')).toBe(-5 * 60 * 60 * 1000);
  });

  it('is -4 hours after it', () => {
    expect(zoneOffsetMs(utc(2026, 3, 9, 12), 'America/New_York')).toBe(-4 * 60 * 60 * 1000);
  });

  it('is +5:30 for Asia/Kolkata, which has no DST', () => {
    expect(zoneOffsetMs(utc(2026, 3, 8, 12), 'Asia/Kolkata')).toBe(5.5 * 60 * 60 * 1000);
  });
});

describe('NFR-TIME-01: consecutive days tile the timeline without gaps', () => {
  it('the end of one day is the start of the next', () => {
    const tz = 'America/New_York';
    const day1 = startOfLocalDay(utc(2026, 3, 8, 16), tz);
    const day2 = startOfLocalDay(utc(2026, 3, 9, 16), tz);

    expect(endOfLocalDay(day1, tz)).toBe(day2);
  });
});

describe('NFR-TIME-01: a date range covers every day in it', () => {
  it('is a single day when both ends are the same day', () => {
    const tz = 'Europe/Berlin';
    const from = utc(2026, 5, 4, 9);
    expect(dateKeyRange(from, from + 60_000, tz)).toEqual(['2026-05-04']);
  });

  it('is inclusive of the last day', () => {
    // An exclusive end would silently drop a day of work from a report, which is
    // the kind of error that is only noticed a month later.
    const tz = 'Europe/Berlin';
    expect(dateKeyRange(utc(2026, 5, 4, 9), utc(2026, 5, 6, 17), tz)).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
    ]);
  });

  it('spans a DST transition without repeating or skipping a date', () => {
    // Berlin springs forward on 2026-03-29. The day is 23 hours long, and a range
    // computed by adding 24 hours per day would drift and mislabel everything
    // after it.
    const tz = 'Europe/Berlin';
    expect(dateKeyRange(utc(2026, 3, 28, 12), utc(2026, 3, 30, 12), tz)).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
  });

  it('crosses a year boundary', () => {
    const tz = 'UTC';
    expect(dateKeyRange(utc(2025, 12, 31, 23), utc(2026, 1, 1, 1), tz)).toEqual([
      '2025-12-31',
      '2026-01-01',
    ]);
  });

  it('is empty for a reversed range, since it contains no days', () => {
    // A picker can hand over its bounds in either order. A reversed range
    // genuinely covers no days, so the empty list is the truthful answer; the
    // alternative, silently swapping the ends, would report days the caller
    // never asked about.
    const tz = 'UTC';
    expect(dateKeyRange(utc(2026, 5, 6, 12), utc(2026, 5, 4, 12), tz)).toEqual([]);
  });

  it('stops rather than spinning when the range is absurdly long', () => {
    // Four thousand days is about eleven years, far past any report anyone will
    // ask for, and the bound is what makes an over-wide range a bounded answer
    // instead of a hang.
    const tz = 'UTC';
    expect(dateKeyRange(0, utc(9999, 12, 31), tz)).toHaveLength(4000);
  });
});

describe('NFR-TIME-01: a broken Intl implementation is reported, not silently zeroed', () => {
  it('throws when Intl omits a part, rather than reading it as zero', async () => {
    // The guard exists because the alternative is silent corruption. If
    // `formatToParts` ever stops returning `month` — a stripped-down runtime, a
    // polyfill, a future ICU change — then `Number(undefined)` is `NaN` and
    // `Number(null)` is `0`, so a missing part would quietly become midnight on
    // the first of the month. A date key drives which day totals are computed
    // for, so a wrong one is a wrong timesheet with nothing to indicate it.
    //
    // The condition is provoked by replacing `formatToParts` rather than by
    // stubbing the module, so the test still exercises the real lookup.
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = function stub(): Intl.DateTimeFormatPart[] {
      return [{ type: 'year', value: '2026' }] as Intl.DateTimeFormatPart[];
    };

    try {
      expect(() => zonedParts(utc(2026, 3, 10), 'UTC')).toThrow(/Intl did not return/);
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = original;
    }
  });

  it('names the zone in the message, so the bad configuration is obvious', async () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = function stub(): Intl.DateTimeFormatPart[] {
      return [] as Intl.DateTimeFormatPart[];
    };

    try {
      expect(() => zonedParts(utc(2026, 3, 10), 'Asia/Kolkata')).toThrow(/Asia\/Kolkata/);
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = original;
    }
  });

  it('still returns real parts once Intl behaves, so the stub proved nothing false', () => {
    // Without this, a test that stubs Intl and asserts a throw would also pass
    // if `zonedParts` threw unconditionally. The positive case is what shows the
    // throw is caused by the missing part and not by the test.
    const parts = zonedParts(utc(2026, 3, 10), 'UTC');

    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(3);
  });
});
