import { describe, test, expect, jest } from '@jest/globals';

// sharp loads but every rasterise fails: a host whose sharp lacks SVG support,
// or whose fontconfig is broken. The load succeeded, so sharpAvailable() stays
// true; only the warm-up can tell.
jest.unstable_mockModule('../../helpers/svg.js', () => ({
  sharpAvailable: (): boolean => true,
  svgToPng: jest.fn(async (): Promise<Buffer | null> => null),
  escapeXml: (value: string): string => value,
}));

const { warmPictures, picturesAvailable } = await import('../../pictures/render.js');

describe('the warm-up', () => {
  test('a host that fails to rasterise at boot is remembered, so the tools refuse before any SQL', async () => {
    expect(picturesAvailable()).toBe(true);

    await expect(warmPictures()).resolves.toBe(false);

    expect(picturesAvailable()).toBe(false);
  });
});
