import { afterEach, describe, expect, it } from 'vitest';
import { nowMs, setNowMsForTesting } from './clock.js';

afterEach(() => {
  // Passing no argument restores the real clock, so a fake cannot leak into the
  // next test file.
  setNowMsForTesting();
});

describe('ground rule 4: nowMs() is the only clock', () => {
  it('returns a real epoch-millisecond integer by default', () => {
    const value = nowMs();
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThan(1_600_000_000_000);
  });

  it('a test can freeze it', () => {
    setNowMsForTesting(() => 1_700_000_000_000);
    expect(nowMs()).toBe(1_700_000_000_000);
  });

  it('a frozen clock does not advance on its own', () => {
    // The timer and reminder tests depend on this: a clock that ticks is a
    // timing-dependent test, which is the same as a flaky test.
    setNowMsForTesting(() => 1_700_000_000_000);
    expect(nowMs()).toBe(nowMs());
  });

  it('the real clock can be restored', () => {
    setNowMsForTesting(() => 0);
    expect(nowMs()).toBe(0);

    setNowMsForTesting();
    expect(nowMs()).toBeGreaterThan(1_600_000_000_000);
  });
});
