import { describe, test, expect } from '@jest/globals';
import { renderSvg, rasterise, picturesAvailable, warmPictures } from '../../pictures/render.js';
import type { TopLevelSpec } from 'vega-lite';

/** The smallest bar chart Vega-Lite accepts, with the league's longest name in it. */
const SPEC: TopLevelSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  width: 300,
  height: 120,
  // Fixed size, as every real spec is: Vega would otherwise grow the canvas
  // from its estimate of the label widths.
  autosize: { type: 'none', contains: 'padding' },
  padding: { left: 130, right: 20, top: 10, bottom: 30 },
  data: {
    values: [
      { k0: 'Forrest Britton', k1: 3 },
      { k0: 'AJ Boorde', k1: 2 },
      { k0: 'Todd Ellis', k1: 1 },
    ],
  },
  mark: 'bar',
  encoding: {
    y: { field: 'k0', type: 'nominal', sort: null },
    x: { field: 'k1', type: 'quantitative' },
  },
};

describe('render', () => {
  // The spike: Vega depends on ESM-only d3 packages, and this suite runs in
  // Jest's ESM mode where the SDK suites already need `npm test`. If Vega
  // cannot load here, nothing else in the module is worth writing.
  test('Vega compiles and renders a bar spec to SVG in this test runner', async () => {
    const svg: string = await renderSvg(SPEC);

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Forrest Britton');
    // Three bars: Vega labels every bar path for accessibility.
    expect((svg.match(/aria-roledescription="bar"/g) ?? []).length).toBe(3);
  });

  test('two renders of one spec draw the same marks', async () => {
    const [first, second] = await Promise.all([renderSvg(SPEC), renderSvg(SPEC)]);
    // Vega numbers its clip-path ids per render; the drawing is what must match.
    const marks = (svg: string): string[] => svg.match(/<path[^>]*d="[^"]*"/g) ?? [];
    expect(marks(first)).toEqual(marks(second));
  });

  test('rasterises an SVG to a PNG at the configured density, or degrades to null', async () => {
    const svg: string = await renderSvg(SPEC);
    const png: Buffer | null = await rasterise(svg);

    // sharp ships native binaries and may not load everywhere; the contract
    // is null and a text-only answer, never a throw (casinoHero does the same).
    if (png === null) {
      expect(picturesAvailable()).toBe(false);
      return;
    }
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    // Width is in the IHDR chunk at bytes 16-19: 300 design pixels at 2x.
    expect(png.readUInt32BE(16)).toBe(600);
  });

  test('malformed SVG degrades to null rather than throwing', async () => {
    await expect(rasterise('not an svg at all')).resolves.toBeNull();
  });

  test('the warm-up reports whether the host can draw and never throws', async () => {
    const ok: boolean = await warmPictures();
    expect(ok).toBe(picturesAvailable());
  });
});
