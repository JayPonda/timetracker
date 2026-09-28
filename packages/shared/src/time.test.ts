import { describe, expect, it } from 'vitest';
import { endOfLocalDay, localDateKey, startOfLocalDay, zonedParts, zoneOffsetMs } from './time.js';

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
