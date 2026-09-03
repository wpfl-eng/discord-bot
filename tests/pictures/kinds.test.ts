import { describe, test, expect } from '@jest/globals';
import { buildChart, CHART_KINDS, type ChartKind } from '../../pictures/chartSpec.js';
import { renderSvg } from '../../pictures/render.js';

/**
 * Every kind through the real compiler, with Vega-Lite's warnings held to
 * none. A warning is a spec defect -- two layers sorting one axis differently
 * drew one in the probe -- and the spec builders are pure, so this is the
 * only place a spec meets Vega before a member does.
 */
describe('every chart kind compiles clean', () => {
  const rows = (kind: ChartKind): Record<string, unknown>[] =>
    Array.from({ length: kind === 'scatter' ? 31 : 8 }, (_, i) => ({
      x: kind === 'bar' ? `Owner ${i}` : String(2016 + i),
      y: String(i % 3 === 0 ? -i : i * 1.5),
      s: i % 2 === 0 ? 'a' : 'b',
      who: `Owner ${i}`,
    }));

  test.each(CHART_KINDS)('%s, with and without a series', async (kind: ChartKind) => {
    for (const series of [undefined, 's']) {
      const built = buildChart({
        request: { kind, title: `A ${kind}`, x: 'x', y: 'y', series, label: 'who' },
        sql: 'SELECT 1 ORDER BY 1',
        rows: rows(kind),
        truncated: false,
      });
      if (!built.ok) throw new Error(built.refusal);

      const warnings: string[] = [];
      const svg: string = await renderSvg(built.value, (m: string): void => {
        warnings.push(m);
      });
      expect(warnings).toEqual([]);
      expect(svg).toContain(`A ${kind}`);
      if (series !== undefined) expect(svg).toContain('role-legend');
    }
  });

  test('a bar chart draws one bar per row and the value beside each', async () => {
    const built = buildChart({
      request: { kind: 'bar', title: 'Bars', x: 'x', y: 'y' },
      sql: 'SELECT 1 ORDER BY 1',
      rows: [
        { x: 'Forrest Britton', y: '1806.16' },
        { x: 'AJ Boorde', y: '1351.9' },
      ],
      truncated: false,
    });
    if (!built.ok) throw new Error(built.refusal);
    const svg: string = await renderSvg(built.value);

    // Vega labels every bar path for accessibility; in a layered spec the
    // bars are scoped into groups of their own, so that label is the count.
    expect((svg.match(/aria-roledescription="bar"/g) ?? []).length).toBe(2);
    expect(svg).toContain('1,806.16');
    expect(svg).toContain('1,351.9');
  });
});
