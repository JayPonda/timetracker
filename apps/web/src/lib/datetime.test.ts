import { describe, expect, it } from 'vitest';
import { formatClock, formatDateTime, isValidTimeZone } from './datetime';

/**
 * 2026-09-28T14:05:09Z.
 *
 * Chosen because it is a single instant that reads differently in every zone
 * these tests compare, so a formatter that ignored `timeZone` would fail
 * rather than accidentally pass.
 */
const INSTANT = 1_790_604_309_000;

describe('NFR-TIME-01: times are rendered in the configured zone, not the browser zone', () => {
  it('renders the same instant differently in two zones', () => {
    expect(formatClock(INSTANT, 'Asia/Kolkata')).not.toBe(formatClock(INSTANT, 'Europe/London'));
  });

  it('adds five and a half hours for Asia/Kolkata', () => {
    // 14:05:09Z is 19:35:09 in Kolkata (UTC+05:30).
    expect(formatClock(INSTANT, 'Asia/Kolkata')).toBe('19:35:09');
  });

  it('renders UTC in Europe/London during British Summer Time', () => {
    // September is BST, so London is UTC+01:00 and reads 15:05:09.
    expect(formatClock(INSTANT, 'Europe/London')).toBe('15:05:09');
  });

  it('renders a date as well as a time', () => {
    expect(formatDateTime(INSTANT, 'UTC')).toContain('2026');
  });

  it('rejects a zone name Intl cannot use instead of throwing at render', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('accepts the zone the server reports', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
  });
});
