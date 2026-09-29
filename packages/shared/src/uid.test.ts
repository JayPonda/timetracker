import { describe, expect, it } from 'vitest';
import { newUid, setNowMsForTesting, uidToMs } from './index.js';

describe('DATA-13: uid is a UUIDv7 so rows sort by creation time', () => {
  it('is a canonical hyphenated UUID', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    expect(newUid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('carries version 7 in the version nibble', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    // RFC 9562: the high nibble of the third group is the version. A v4 here
    // would mean the import merge in DATA-13 is matching on random ids.
    expect(newUid()[14]).toBe('7');
  });

  it('carries the RFC 4122 variant bits', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    // The high nibble of the fourth group is 8, 9, a or b.
    expect('89ab').toContain(newUid()[19]);
  });

  it('embeds the creation time from nowMs, not the system clock', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    expect(uidToMs(newUid())).toBe(1_700_000_000_000);
  });

  it('reads time through the nowMs seam, so a frozen clock is honoured', () => {
    setNowMsForTesting(() => 1_000);
    expect(uidToMs(newUid())).toBe(1_000);
    setNowMsForTesting(() => 2_000);
    expect(uidToMs(newUid())).toBe(2_000);
  });

  it('handles a timestamp beyond 2^31, which is 2038', () => {
    // Bits [0,6) are 48 bits, so a real epoch millisecond value fits. This
    // asserts the shift maths is not accidentally 32-bit.
    setNowMsForTesting(() => 4_102_444_800_000);
    expect(uidToMs(newUid())).toBe(4_102_444_800_000);
  });

  it('produces unique values within one millisecond', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const uids = new Set(Array.from({ length: 2_000 }, () => newUid()));
    expect(uids.size).toBe(2_000);
  });

  it('sorts by creation time across milliseconds', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    const earlier = newUid();
    setNowMsForTesting(() => 1_700_000_000_001);
    const later = newUid();
    // The property DATA-13's merge relies on: ordering is time ordering.
    expect(earlier < later).toBe(true);
  });

  it('refuses to read a timestamp out of something that is not a UUID', () => {
    expect(() => uidToMs('not-a-uid')).toThrow(/Not a UUID/);
  });
});
