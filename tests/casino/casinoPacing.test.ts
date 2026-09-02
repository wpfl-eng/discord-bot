import { describe, test, expect } from '@jest/globals';
import { PACING_THRESHOLDS, pacingDurationMs, pacingFor } from '../../casino/casinoPacing.js';

describe('pacingFor', () => {
  // The point of adaptive pacing: a routine spin must not cost the same wall clock as a
  // big one, or a grinding session feels slow and the big moment feels cheap.
  test('a small pot resolves almost immediately', () => {
    const pacing = pacingFor(100);
    expect(pacing.frames).toBe(1);
    expect(pacing.hero).toBe(false);
  });

  test('a medium pot gets a real build-up', () => {
    const pacing = pacingFor(PACING_THRESHOLDS.MEDIUM);
    expect(pacing.frames).toBe(3);
    expect(pacing.hero).toBe(false);
  });

  test('a big pot gets the full build-up and a rendered result', () => {
    const pacing = pacingFor(PACING_THRESHOLDS.BIG);
    expect(pacing.frames).toBe(5);
    expect(pacing.hero).toBe(true);
  });

  test('build-up never shrinks as the money grows', () => {
    const amounts = [0, 100, 4_999, 5_000, 24_999, 25_000, 1_000_000];
    let previous = 0;
    for (const amount of amounts) {
      const frames = pacingFor(amount).frames;
      expect(frames).toBeGreaterThanOrEqual(previous);
      previous = frames;
    }
  });

  test('only the top tier earns a hero image', () => {
    expect(pacingFor(PACING_THRESHOLDS.BIG - 1).hero).toBe(false);
    expect(pacingFor(PACING_THRESHOLDS.BIG).hero).toBe(true);
  });

  test('zero and negative amounts are handled as the quick tier', () => {
    expect(pacingFor(0).frames).toBe(1);
    expect(pacingFor(-100).frames).toBe(1);
  });
});

describe('pacingDurationMs', () => {
  test('accounts for every frame plus the hold', () => {
    const pacing = pacingFor(100);
    expect(pacingDurationMs(pacing)).toBe(pacing.frames * pacing.frameMs + pacing.holdMs);
  });

  // Even the longest build-up has to stay well inside a betting window, or the table
  // spends more time animating than playing.
  test('the longest resolution is still under ten seconds', () => {
    expect(pacingDurationMs(pacingFor(1_000_000))).toBeLessThan(10_000);
  });
});
