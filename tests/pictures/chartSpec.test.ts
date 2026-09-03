import { describe, test, expect } from '@jest/globals';
import { buildChart, type ChartInput, type ChartRequest } from '../../pictures/chartSpec.js';
import { FALLBACK } from '../../pictures/shared.js';
import { ASK } from '../../ask/askConfig.js';
import { OWNERS, refusalOf, valueOf } from './fixtures.js';

/** One row per owner, values descending, integers as strings the way DuckDB returns them. */
function ranking(count: number = 14): Record<string, unknown>[] {
  return OWNERS.slice(0, count).map(
    (owner: string, i: number): Record<string, unknown> => ({
      owner,
      points: String(1800 - i * 40),
    })
  );
}

function input(over: Partial<ChartInput> = {}, request: Partial<ChartRequest> = {}): ChartInput {
  return {
    request: { kind: 'bar', title: 'Points for, 2025', x: 'owner', y: 'points', ...request },
    sql: 'SELECT owner, points FROM t ORDER BY points DESC',
    rows: ranking(),
    ...over,
  };
}

/** The data Vega will draw, out of the built spec. */
function values(spec: unknown): Record<string, unknown>[] {
  return (spec as { data: { values: Record<string, unknown>[] } }).data.values;
}

function layers(spec: unknown): { mark: unknown; encoding?: Record<string, unknown> }[] {
  return (spec as { layer: { mark: unknown; encoding?: Record<string, unknown> }[] }).layer;
}

describe('buildChart', () => {
  describe('the data it draws', () => {
    test('is the rows, in row order, under generated keys', () => {
      const data = values(valueOf(buildChart(input())));
      expect(data).toHaveLength(14);
      expect(data[0]).toEqual({ k0: 'Nixon Ball', k1: 1800 });
      expect(data[13]).toEqual({ k0: 'Michael Hoyle', k1: 1280 });
    });

    test('coerces the numeric strings DuckDB returns, and keeps decimals exact', () => {
      const spec = valueOf(
        buildChart(
          input({ rows: [{ owner: 'AJ Boorde', points: '10.67' }], sql: 'SELECT 1 ORDER BY 1' })
        )
      );
      expect(values(spec)[0].k1).toBe(10.67);
    });

    test('a dotted alias is not read as a nested path', () => {
      const rows = [{ 'pts.avg': '10', owner: 'AJ Boorde' }];
      const spec = valueOf(
        buildChart(input({ rows, sql: 'SELECT 1 ORDER BY 1' }, { x: 'owner', y: 'pts.avg' }))
      );

      expect(values(spec)[0]).toEqual({ k0: 'AJ Boorde', k1: 10 });
      // The alias survives only as an axis title.
      expect(JSON.stringify(spec)).toContain('"title":"pts.avg"');
      expect(JSON.stringify(spec)).not.toContain('"field":"pts.avg"');
    });

    test('keeps the query order for bars rather than sorting them itself', () => {
      const spec = valueOf(buildChart(input({ rows: ranking().reverse() })));

      expect(values(spec)[0].k0).toBe('Michael Hoyle');
      const y = layers(spec)[0].encoding?.y as { sort: unknown };
      expect(y.sort).toBeNull();
    });
  });

  describe('sizing', () => {
    test('fixes the size and padding so Vega never autosizes from a text estimate', () => {
      const spec = valueOf(buildChart(input())) as {
        width: number;
        autosize: unknown;
        padding: unknown;
      };
      expect(spec.width).toBe(ASK.PICTURES.WIDTH);
      expect(spec.autosize).toEqual({ type: 'none', contains: 'padding' });
      expect(spec.padding).toBeDefined();
    });

    test('a bar chart grows by one row pitch per category', () => {
      const height = (spec: unknown): number => (spec as { height: number }).height;
      const ten = valueOf(buildChart(input({ rows: ranking(10) })));
      const fourteen = valueOf(buildChart(input({ rows: ranking(14) })));
      expect(height(fourteen) - height(ten)).toBe(4 * ASK.PICTURES.ROW_PITCH);
    });

    test('a bar chart starts its value axis at zero', () => {
      const spec = valueOf(buildChart(input()));
      const x = layers(spec)[0].encoding?.x as { scale?: { zero?: boolean } };
      expect(x.scale?.zero ?? true).toBe(true);
    });
  });

  describe('kinds', () => {
    const seasons: Record<string, unknown>[] = Array.from({ length: 10 }, (_, i) => ({
      season: String(2016 + i),
      spend: String(10 + i),
    }));

    test('a line needs a numeric x and does not force zero on y', () => {
      const spec = valueOf(
        buildChart(
          input({ rows: seasons, sql: 'SELECT 1' }, { kind: 'line', x: 'season', y: 'spend' })
        )
      );

      const encoding = layers(spec)[0].encoding as {
        x: { type: string };
        y: { scale?: { zero?: boolean } };
      };
      expect(encoding.x.type).toBe('quantitative');
      expect(encoding.y.scale?.zero).toBe(false);
      expect(values(spec)[0]).toEqual({ k0: 2016, k1: 10 });
    });

    test('a line refuses a text x', () => {
      const built = buildChart(
        input({ rows: ranking(), sql: 'SELECT 1' }, { kind: 'line', x: 'owner', y: 'points' })
      );
      expect(refusalOf(built)).toMatch(/season or a week/);
    });

    test('a series column becomes colour, and a bar chart groups by it', () => {
      const rows = OWNERS.slice(0, 3).flatMap((owner: string) => [
        { owner, kind: 'expected', wins: '8.5' },
        { owner, kind: 'actual', wins: '9' },
      ]);
      const spec = valueOf(
        buildChart(input({ rows, sql: 'SELECT 1 ORDER BY 1' }, { series: 'kind', y: 'wins' }))
      );

      const encoding = layers(spec)[0].encoding as {
        color: { field: string };
        yOffset: { field: string };
      };
      expect(encoding.color.field).toBe('k2');
      expect(encoding.yOffset.field).toBe('k2');
      expect(values(spec)[1]).toEqual({ k0: 'Nixon Ball', k1: 9, k2: 'actual' });
    });

    const points = (n: number): Record<string, unknown>[] =>
      Array.from({ length: n }, (_, i) => ({
        spend: String(i),
        finish: String((i % 14) + 1),
        owner: OWNERS[i % 14],
      }));

    test('a scatter labels its points only up to the labelled-points ceiling', () => {
      const scatter = (n: number): unknown =>
        valueOf(
          buildChart(
            input(
              { rows: points(n), sql: 'SELECT 1' },
              { kind: 'scatter', x: 'spend', y: 'finish', label: 'owner' }
            )
          )
        );
      const marks = (spec: unknown): string[] =>
        layers(spec).map((l) =>
          typeof l.mark === 'string' ? l.mark : (l.mark as { type: string }).type
        );
      expect(marks(scatter(ASK.PICTURES.LABELLED_POINTS_MAX))).toContain('text');
      expect(marks(scatter(ASK.PICTURES.LABELLED_POINTS_MAX + 1))).not.toContain('text');
    });

    test('a scatter draws a regression line only from the minimum sample', () => {
      const scatter = (n: number): string =>
        JSON.stringify(
          valueOf(
            buildChart(
              input(
                { rows: points(n), sql: 'SELECT 1' },
                { kind: 'scatter', x: 'spend', y: 'finish' }
              )
            )
          )
        );
      expect(scatter(ASK.PICTURES.REGRESSION_MIN_POINTS - 1)).not.toContain('regression');
      expect(scatter(ASK.PICTURES.REGRESSION_MIN_POINTS)).toContain('"regression":"k1"');
    });
  });

  describe('refusals, each naming the fallback', () => {
    test('no rows', () => {
      const text = refusalOf(buildChart(input({ rows: [] })));
      expect(text).toMatch(/no rows/i);
      expect(text).toContain(FALLBACK);
    });

    test('a column the result does not have, naming the ones it does', () => {
      const text = refusalOf(buildChart(input({}, { y: 'pts' })));
      expect(text).toContain('`pts`');
      expect(text).toContain('owner, points');
    });

    test('a value column that is not numeric', () => {
      expect(refusalOf(buildChart(input({}, { y: 'owner', x: 'points' })))).toMatch(/not numeric/);
    });

    test('bars need an ORDER BY', () => {
      expect(refusalOf(buildChart(input({ sql: 'SELECT owner, points FROM t' })))).toMatch(
        /ORDER BY/
      );
    });

    test('an ORDER BY inside a comment or a string does not count', () => {
      expect(
        refusalOf(buildChart(input({ sql: 'SELECT owner, points FROM t -- order by points' })))
      ).toMatch(/ORDER BY/);
      expect(
        refusalOf(buildChart(input({ sql: "SELECT owner, 'order by' AS points FROM t" })))
      ).toMatch(/ORDER BY/);
    });

    test('a null in a drawn column, so a bar cannot vanish while the rows say it was drawn', () => {
      const text = refusalOf(
        buildChart(input({ rows: [...ranking(2), { owner: 'Todd Ellis', points: null }] }))
      );
      expect(text).toContain('`points`');
      expect(text).toMatch(/empty in 1 row/);
      expect(text).toContain(FALLBACK);

      const category = refusalOf(
        buildChart(input({ rows: [...ranking(1), { owner: null, points: '1' }] }))
      );
      expect(category).toContain('`owner`');
    });

    test('a category that appears twice, so a forgotten GROUP BY cannot stack silently', () => {
      const rows = [...ranking(3), { owner: 'AJ Boorde', points: '1' }];
      const text = refusalOf(buildChart(input({ rows })));
      expect(text).toContain('AJ Boorde');
      expect(text).toMatch(/aggregate/i);
    });

    test('more rows than the ceiling', () => {
      const rows = Array.from({ length: ASK.PICTURES.ROWS_MAX + 1 }, (_, i) => ({
        owner: `Owner ${i}`,
        points: String(i),
      }));
      expect(refusalOf(buildChart(input({ rows })))).toContain(String(ASK.PICTURES.ROWS_MAX));
    });

    test('more series than the ceiling', () => {
      const rows = Array.from({ length: ASK.PICTURES.SERIES_MAX + 1 }, (_, i) => ({
        owner: 'AJ Boorde',
        kind: `s${i}`,
        points: String(i),
      }));
      expect(refusalOf(buildChart(input({ rows }, { series: 'kind' })))).toContain(
        String(ASK.PICTURES.SERIES_MAX)
      );
    });

    test('a long alias, a long label and a long title', () => {
      const alias = 'a'.repeat(ASK.PICTURES.ALIAS_MAX_CHARS + 1);
      expect(
        refusalOf(buildChart(input({ rows: [{ owner: 'AJ Boorde', [alias]: '1' }] }, { y: alias })))
      ).toMatch(/alias/i);

      const label = 'b'.repeat(ASK.PICTURES.LABEL_MAX_CHARS + 1);
      expect(refusalOf(buildChart(input({ rows: [{ owner: label, points: '1' }] })))).toMatch(
        /label/i
      );

      const title = 'c'.repeat(ASK.PICTURES.TITLE_MAX_CHARS + 1);
      expect(refusalOf(buildChart(input({}, { title })))).toMatch(/title/i);
    });
  });
});
