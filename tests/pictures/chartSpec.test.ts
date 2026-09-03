import { describe, test, expect } from '@jest/globals';
import { buildChart, type ChartInput, type ChartRequest } from '../../pictures/chartSpec.js';
import { FALLBACK } from '../../pictures/shared.js';
import { ASK } from '../../ask/askConfig.js';

const OWNERS: readonly string[] = [
  'Nixon Ball',
  'Forrest Britton',
  'AJ Boorde',
  'Jimmy Simpson',
  'David Evans',
  'Ryan Salchert',
  'Mike Simpson',
  'Todd Ellis',
  'David Adler',
  'Neill Bullock',
  'Doug Black',
  'Rick Kocher',
  'Jonathan Mims',
  'Michael Hoyle',
];

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
    truncated: false,
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
      const built = buildChart(input());
      if (!built.ok) throw new Error(built.refusal);

      const data = values(built.value);
      expect(data).toHaveLength(14);
      expect(data[0]).toEqual({ k0: 'Nixon Ball', k1: 1800 });
      expect(data[13]).toEqual({ k0: 'Michael Hoyle', k1: 1280 });
      expect(built.n).toBe(14);
    });

    test('coerces the numeric strings DuckDB returns, and keeps decimals exact', () => {
      const built = buildChart(
        input({ rows: [{ owner: 'AJ Boorde', points: '10.67' }], sql: 'SELECT 1 ORDER BY 1' })
      );
      if (!built.ok) throw new Error(built.refusal);
      expect(values(built.value)[0].k1).toBe(10.67);
    });

    test('a dotted alias is not read as a nested path', () => {
      const rows = [{ 'pts.avg': '10', owner: 'AJ Boorde' }];
      const built = buildChart(
        input({ rows, sql: 'SELECT 1 ORDER BY 1' }, { x: 'owner', y: 'pts.avg' })
      );
      if (!built.ok) throw new Error(built.refusal);

      expect(values(built.value)[0]).toEqual({ k0: 'AJ Boorde', k1: 10 });
      // The alias survives only as an axis title.
      expect(JSON.stringify(built.value)).toContain('"title":"pts.avg"');
      expect(JSON.stringify(built.value)).not.toContain('"field":"pts.avg"');
    });

    test('keeps the query order for bars rather than sorting them itself', () => {
      const rows = ranking().reverse();
      const built = buildChart(input({ rows }));
      if (!built.ok) throw new Error(built.refusal);

      expect(values(built.value)[0].k0).toBe('Michael Hoyle');
      const y = layers(built.value)[0].encoding?.y as { sort: unknown };
      expect(y.sort).toBeNull();
    });
  });

  describe('sizing', () => {
    test('fixes the size and padding so Vega never autosizes from a text estimate', () => {
      const built = buildChart(input());
      if (!built.ok) throw new Error(built.refusal);

      const spec = built.value as { width: number; autosize: unknown; padding: unknown };
      expect(spec.width).toBe(ASK.PICTURES.WIDTH);
      expect(spec.autosize).toEqual({ type: 'none', contains: 'padding' });
      expect(spec.padding).toBeDefined();
    });

    test('a bar chart grows by one row pitch per category', () => {
      const ten = buildChart(input({ rows: ranking(10) }));
      const fourteen = buildChart(input({ rows: ranking(14) }));
      if (!ten.ok || !fourteen.ok) throw new Error('refused');

      const height = (spec: unknown): number => (spec as { height: number }).height;
      expect(height(fourteen.value) - height(ten.value)).toBe(4 * ASK.PICTURES.ROW_PITCH);
    });

    test('a bar chart starts its value axis at zero', () => {
      const built = buildChart(input());
      if (!built.ok) throw new Error(built.refusal);
      const x = layers(built.value)[0].encoding?.x as { scale?: { zero?: boolean } };
      expect(x.scale?.zero ?? true).toBe(true);
    });
  });

  describe('kinds', () => {
    const seasons: Record<string, unknown>[] = Array.from({ length: 10 }, (_, i) => ({
      season: String(2016 + i),
      spend: String(10 + i),
    }));

    test('a line needs a numeric x and does not force zero on y', () => {
      const built = buildChart(
        input({ rows: seasons, sql: 'SELECT 1' }, { kind: 'line', x: 'season', y: 'spend' })
      );
      if (!built.ok) throw new Error(built.refusal);

      const encoding = layers(built.value)[0].encoding as {
        x: { type: string };
        y: { scale?: { zero?: boolean } };
      };
      expect(encoding.x.type).toBe('quantitative');
      expect(encoding.y.scale?.zero).toBe(false);
      expect(values(built.value)[0]).toEqual({ k0: 2016, k1: 10 });
    });

    test('a line refuses a text x', () => {
      const built = buildChart(
        input({ rows: ranking(), sql: 'SELECT 1' }, { kind: 'line', x: 'owner', y: 'points' })
      );
      expect(built.ok).toBe(false);
      if (!built.ok) expect(built.refusal).toMatch(/season or a week/);
    });

    test('a series column becomes colour, and a bar chart groups by it', () => {
      const rows = OWNERS.slice(0, 3).flatMap((owner: string) => [
        { owner, kind: 'expected', wins: '8.5' },
        { owner, kind: 'actual', wins: '9' },
      ]);
      const built = buildChart(
        input({ rows, sql: 'SELECT 1 ORDER BY 1' }, { series: 'kind', y: 'wins' })
      );
      if (!built.ok) throw new Error(built.refusal);

      const encoding = layers(built.value)[0].encoding as {
        color: { field: string };
        yOffset: { field: string };
      };
      expect(encoding.color.field).toBe('k2');
      expect(encoding.yOffset.field).toBe('k2');
      expect(values(built.value)[1]).toEqual({ k0: 'Nixon Ball', k1: 9, k2: 'actual' });
    });

    const points = (n: number): Record<string, unknown>[] =>
      Array.from({ length: n }, (_, i) => ({
        spend: String(i),
        finish: String((i % 14) + 1),
        owner: OWNERS[i % 14],
      }));

    test('a scatter labels its points only up to the labelled-points ceiling', () => {
      const few = buildChart(
        input(
          { rows: points(ASK.PICTURES.LABELLED_POINTS_MAX), sql: 'SELECT 1' },
          { kind: 'scatter', x: 'spend', y: 'finish', label: 'owner' }
        )
      );
      const many = buildChart(
        input(
          { rows: points(ASK.PICTURES.LABELLED_POINTS_MAX + 1), sql: 'SELECT 1' },
          { kind: 'scatter', x: 'spend', y: 'finish', label: 'owner' }
        )
      );
      if (!few.ok || !many.ok) throw new Error('refused');

      const marks = (spec: unknown): string[] =>
        layers(spec).map((l) =>
          typeof l.mark === 'string' ? l.mark : (l.mark as { type: string }).type
        );
      expect(marks(few.value)).toContain('text');
      expect(marks(many.value)).not.toContain('text');
    });

    test('a scatter draws a regression line only from the minimum sample', () => {
      const below = buildChart(
        input(
          { rows: points(ASK.PICTURES.REGRESSION_MIN_POINTS - 1), sql: 'SELECT 1' },
          { kind: 'scatter', x: 'spend', y: 'finish' }
        )
      );
      const at = buildChart(
        input(
          { rows: points(ASK.PICTURES.REGRESSION_MIN_POINTS), sql: 'SELECT 1' },
          { kind: 'scatter', x: 'spend', y: 'finish' }
        )
      );
      if (!below.ok || !at.ok) throw new Error('refused');

      expect(JSON.stringify(below.value)).not.toContain('regression');
      expect(JSON.stringify(at.value)).toContain('"regression":"k1"');
    });
  });

  describe('refusals, each naming the fallback', () => {
    const refusal = (built: ReturnType<typeof buildChart>): string => {
      expect(built.ok).toBe(false);
      return built.ok ? '' : built.refusal;
    };

    test('a truncated result is never drawn', () => {
      const text = refusal(buildChart(input({ truncated: true })));
      expect(text).toMatch(new RegExp(`${ASK.SQL_ROW_LIMIT}`));
      expect(text).toContain(FALLBACK);
    });

    test('no rows', () => {
      expect(refusal(buildChart(input({ rows: [] })))).toMatch(/no rows/i);
    });

    test('a column the result does not have, naming the ones it does', () => {
      const text = refusal(buildChart(input({}, { y: 'pts' })));
      expect(text).toContain('`pts`');
      expect(text).toContain('owner, points');
    });

    test('a value column that is not numeric', () => {
      const text = refusal(buildChart(input({}, { y: 'owner', x: 'points' })));
      expect(text).toMatch(/not numeric/);
    });

    test('bars need an ORDER BY', () => {
      const text = refusal(buildChart(input({ sql: 'SELECT owner, points FROM t' })));
      expect(text).toMatch(/ORDER BY/);
    });

    test('a category that appears twice, so a forgotten GROUP BY cannot stack silently', () => {
      const rows = [...ranking(3), { owner: 'AJ Boorde', points: '1' }];
      const text = refusal(buildChart(input({ rows })));
      expect(text).toContain('AJ Boorde');
      expect(text).toMatch(/aggregate/i);
    });

    test('more rows than the ceiling', () => {
      const rows = Array.from({ length: ASK.PICTURES.ROWS_MAX + 1 }, (_, i) => ({
        owner: `Owner ${i}`,
        points: String(i),
      }));
      const text = refusal(buildChart(input({ rows })));
      expect(text).toContain(String(ASK.PICTURES.ROWS_MAX));
    });

    test('more series than the ceiling', () => {
      const rows = Array.from({ length: ASK.PICTURES.SERIES_MAX + 1 }, (_, i) => ({
        owner: 'AJ Boorde',
        kind: `s${i}`,
        points: String(i),
      }));
      const text = refusal(buildChart(input({ rows }, { series: 'kind' })));
      expect(text).toContain(String(ASK.PICTURES.SERIES_MAX));
    });

    test('a long alias, a long label and a long title', () => {
      const alias = 'a'.repeat(ASK.PICTURES.ALIAS_MAX_CHARS + 1);
      expect(
        refusal(buildChart(input({ rows: [{ owner: 'AJ Boorde', [alias]: '1' }] }, { y: alias })))
      ).toMatch(/alias/i);

      const label = 'b'.repeat(ASK.PICTURES.LABEL_MAX_CHARS + 1);
      expect(refusal(buildChart(input({ rows: [{ owner: label, points: '1' }] })))).toMatch(
        /label/i
      );

      const title = 'c'.repeat(ASK.PICTURES.TITLE_MAX_CHARS + 1);
      expect(refusal(buildChart(input({}, { title })))).toMatch(/title/i);
    });
  });
});
