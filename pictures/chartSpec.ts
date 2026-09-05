/**
 * A chart request plus the rows it is drawn from, to a Vega-Lite spec
 * (design §11). Pure: no engine is loaded here, so the whole vocabulary is
 * tested without Vega.
 *
 * The rows are handed to Vega under generated keys, `k0` for x, `k1` for y,
 * `k2` for the series and `k3` for the point label. Vega reads a field name
 * as an accessor path -- `pts.avg` is a nested lookup, `a[0]` an index -- and
 * a column alias from the model's SQL can carry either. The alias survives
 * only as an axis title.
 *
 * Every size is fixed. Vega renders here without node-canvas and estimates
 * text widths, and its default autosize grows the canvas from that estimate;
 * measured on the pi, a title anchored that way was clipped.
 */

import type { TopLevelSpec } from 'vega-lite';
import { ASK } from '../ask/askConfig.js';
import { THEME } from './theme.js';
import {
  type Built,
  type Row,
  ok,
  refuse,
  checkCommon,
  columnsOf,
  columnKind,
  toNumber,
  d3Format,
  hasOrderBy,
  glyphWidth,
  tooManyRows,
  MARGIN,
  TITLE_BAND,
} from './shared.js';

const P = ASK.PICTURES;

export const CHART_KINDS = ['bar', 'line', 'scatter'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartRequest {
  readonly kind: ChartKind;
  readonly title: string;
  /** The category for a bar, the season or week for a line, a measure for a scatter. */
  readonly x: string;
  /** Always a measure. */
  readonly y: string;
  /** One colour per distinct value; a bar chart groups by it. */
  readonly series?: string;
  /** Scatter only: the text beside each point, drawn up to the labelled-points ceiling. */
  readonly label?: string;
}

export interface ChartInput {
  readonly request: ChartRequest;
  /** The statement the rows came from; bars require an ORDER BY in it. */
  readonly sql: string;
  readonly rows: readonly Row[];
}

/** A row under the generated keys. */
interface Datum {
  readonly k0: string | number;
  readonly k1: number;
  readonly k2?: string;
  readonly k3?: string;
}

/** A piece of a spec: an encoding, a layer, a mark. */
type Fragment = Record<string, unknown>;

/**
 * The specs are built as plain records and typed at the end: Vega-Lite's
 * spec types are a deep generic union that a record literal cannot be
 * narrowed to, and the compile step in the kinds test is what validates a
 * spec, with warnings held to none.
 */
function toSpec(record: Fragment): TopLevelSpec {
  return record as unknown as TopLevelSpec;
}

export function buildChart(input: ChartInput): Built<TopLevelSpec> {
  const { request, rows } = input;
  const common: string | null = checkCommon(rows, request.title);
  if (common !== null) return refuse(common);

  const columns: string[] = columnsOf(rows);
  for (const name of [request.x, request.y, request.series, request.label]) {
    if (name === undefined) continue;
    if (!columns.includes(name)) {
      return refuse(`Column \`${name}\` is not in the result. Columns: ${columns.join(', ')}.`);
    }
    // Vega drops a row whose value is missing, and the rows handed back with
    // the token would still count it. Never a picture that quietly omits a row.
    const empty: number = rows.filter((row: Row): boolean => row[name] == null).length;
    if (empty > 0) {
      return refuse(
        `Column \`${name}\` is empty in ${empty} ${empty === 1 ? 'row' : 'rows'}, and a chart would drop them. COALESCE or filter in SQL.`
      );
    }
  }
  if (columnKind(rows, request.y) !== 'number') {
    return refuse(`Column \`${request.y}\` is not numeric, and y must be a measure.`);
  }
  const xNumeric: boolean = columnKind(rows, request.x) === 'number';
  if (request.kind === 'line' && !xNumeric) {
    return refuse(
      `Column \`${request.x}\` is not numeric. For a line, x is a season or a week number.`
    );
  }
  if (request.kind === 'scatter' && !xNumeric) {
    return refuse(`Column \`${request.x}\` is not numeric, and a scatter needs two measures.`);
  }

  const seriesNames: string[] = distinct(rows, request.series);
  if (seriesNames.length > P.SERIES_MAX) {
    return refuse(
      `${seriesNames.length} series is more than the ${P.SERIES_MAX} a chart can show. Narrow to ${P.SERIES_MAX} or fewer.`
    );
  }

  const data: Datum[] = rows.map(
    (row: Row): Datum => ({
      k0: xNumeric && request.kind !== 'bar' ? toNumber(row[request.x]) : String(row[request.x]),
      k1: toNumber(row[request.y]),
      ...(request.series === undefined ? {} : { k2: String(row[request.series]) }),
      ...(request.label === undefined ? {} : { k3: String(row[request.label]) }),
    })
  );
  const format: string = d3Format(data.map((d: Datum): number => d.k1));

  switch (request.kind) {
    case 'bar':
      return bar(input, data, seriesNames, format);
    case 'line':
      return line(input, data, seriesNames, format);
    case 'scatter':
      return scatter(input, data, seriesNames, format);
  }
}

function distinct(rows: readonly Row[], column: string | undefined): string[] {
  if (column === undefined) return [];
  return [...new Set(rows.map((row: Row): string => String(row[column])))];
}

/** The first datum whose x already appeared in its series, or null when every (x, series) is one row. */
function repeatedX(data: readonly Datum[]): Datum | null {
  const seen = new Set<string>();
  for (const d of data) {
    const key: string = JSON.stringify([d.k0, d.k2 ?? '']);
    if (seen.has(key)) return d;
    seen.add(key);
  }
  return null;
}

// ---- bar ----

function bar(
  input: ChartInput,
  data: Datum[],
  seriesNames: string[],
  format: string
): Built<TopLevelSpec> {
  const { request } = input;
  if (!hasOrderBy(input.sql)) {
    return refuse(
      'Bars are drawn in row order, and this query has no ORDER BY. Add one so the ranking is deliberate.'
    );
  }

  const categories: string[] = [...new Set(data.map((d: Datum): string => String(d.k0)))];
  if (categories.length > P.ROWS_MAX) return refuse(tooManyRows(categories.length, 'bars'));
  const long: string | undefined = categories.find(
    (category: string): boolean => category.length > P.LABEL_MAX_CHARS
  );
  if (long !== undefined) {
    return refuse(
      `Label \`${long}\` is longer than ${P.LABEL_MAX_CHARS} characters. Shorten it in SQL.`
    );
  }
  const twice: Datum | null = repeatedX(data);
  if (twice !== null) {
    return refuse(
      `\`${twice.k0}\` appears more than once. Aggregate in SQL so each bar is one row.`
    );
  }

  const grouped: boolean = request.series !== undefined;
  const longest: number = Math.max(...categories.map((c: string): number => c.length));
  const left: number = Math.min(200, MARGIN + glyphWidth(longest, P.LABEL_FONT));
  const top: number = TITLE_BAND + (grouped ? 30 : 0);
  const bottom = 46;
  const pitch: number = grouped ? seriesNames.length * 14 + 12 : P.ROW_PITCH;
  const height: number = top + bottom + categories.length * pitch;

  const y: Fragment = {
    field: 'k0',
    type: 'nominal',
    sort: null,
    axis: { title: null, labelLimit: 0 },
  };
  const negatives: boolean = data.some((d: Datum): boolean => d.k1 < 0);
  const x: Fragment = {
    field: 'k1',
    type: 'quantitative',
    axis: { title: request.y, format, tickCount: 5 },
    // A bar's length is its value. Never a bar chart that starts elsewhere.
    // With negatives, air on both sides so a value label drawn left of a bar
    // never lands in the name gutter (measured: "-4" over "Todd Ellis").
    scale: { zero: true, ...(negatives ? { padding: 44 } : {}) },
  };
  const offset: Fragment = grouped ? { yOffset: { field: 'k2', type: 'nominal' } } : {};
  // The value reads just past its bar's end: right of a positive, left of a negative.
  const valueText: Fragment = {
    mark: {
      type: 'text',
      baseline: 'middle',
      fontSize: P.LABEL_FONT - 3,
      color: THEME.ink,
      align: { expr: "datum.k1 < 0 ? 'right' : 'left'" },
      dx: { expr: 'datum.k1 < 0 ? -6 : 6' },
    },
    encoding: { y, x, ...offset, text: { field: 'k1', type: 'quantitative', format } },
  };

  return ok(
    toSpec({
      ...frame(request.title, height, { left, right: 72, top, bottom }),
      data: { values: data },
      layer: [
        {
          mark: { type: 'bar', cornerRadiusEnd: 3 },
          encoding: { y, x, ...offset, ...colour(seriesNames) },
        },
        valueText,
      ],
    })
  );
}

// ---- line ----

function line(
  input: ChartInput,
  data: Datum[],
  seriesNames: string[],
  format: string
): Built<TopLevelSpec> {
  const { request } = input;
  if (data.length < 2) return refuse('A line needs at least 2 points.');
  // Vega joins the points of one series in x order; two rows at one x draw a
  // vertical step that reads as a swing. Unaggregated rows are not a series.
  const twice: Datum | null = repeatedX(data);
  if (twice !== null) {
    return refuse(
      `\`${twice.k0}\` appears more than once. Aggregate in SQL so each point is one row, or name the column that tells the rows apart as series.`
    );
  }

  return ok(
    toSpec({
      ...frame(request.title, P.HEIGHT, plotPadding(seriesNames, 28)),
      data: { values: data },
      layer: [
        {
          mark: { type: 'line', point: { size: 60, filled: true }, strokeWidth: 2.5 },
          encoding: {
            x: {
              field: 'k0',
              type: 'quantitative',
              axis: { title: request.x, format: 'd', tickMinStep: 1 },
              scale: { zero: false, nice: false, padding: 14 },
            },
            y: {
              field: 'k1',
              type: 'quantitative',
              axis: { title: request.y, format, tickCount: 5 },
              scale: { zero: false },
            },
            ...colour(seriesNames),
          },
        },
      ],
    })
  );
}

// ---- scatter ----

function scatter(
  input: ChartInput,
  data: Datum[],
  seriesNames: string[],
  format: string
): Built<TopLevelSpec> {
  const { request } = input;
  const x: Fragment = {
    field: 'k0',
    type: 'quantitative',
    axis: { title: request.x, format: d3Format(data.map((d: Datum): number => Number(d.k0))) },
    scale: { zero: false, padding: 14 },
  };
  const y: Fragment = {
    field: 'k1',
    type: 'quantitative',
    axis: { title: request.y, format, tickCount: 5 },
    scale: { zero: false, padding: 14 },
  };
  const labelled: boolean = request.label !== undefined && data.length <= P.LABELLED_POINTS_MAX;

  const layers: Fragment[] = [];
  // The regression is Vega's arithmetic over the rows, never the model's, and
  // only from the sample the analysis rules allow a trend to be read from.
  if (data.length >= P.REGRESSION_MIN_POINTS) {
    layers.push({
      transform: [{ regression: 'k1', on: 'k0' }],
      mark: { type: 'line', color: THEME.muted, strokeDash: [6, 4], strokeWidth: 2 },
      encoding: {
        x: { field: 'k0', type: 'quantitative' },
        y: { field: 'k1', type: 'quantitative' },
      },
    });
  }
  layers.push({
    mark: { type: 'point', filled: true, size: 90, opacity: 0.92 },
    encoding: { x, y, ...colour(seriesNames) },
  });
  if (labelled) {
    layers.push({
      mark: {
        type: 'text',
        align: 'left',
        baseline: 'middle',
        dx: 8,
        fontSize: P.LABEL_FONT - 4,
        color: THEME.ink,
      },
      encoding: { x, y, text: { field: 'k3', type: 'nominal' } },
    });
  }

  return ok(
    toSpec({
      // Room on the right for the label beside the last point.
      ...frame(request.title, P.HEIGHT, plotPadding(seriesNames, labelled ? 90 : 28)),
      data: { values: data },
      layer: layers,
    })
  );
}

// ---- shared pieces ----

/** Colour by series when there is one, else the first palette colour. */
function colour(seriesNames: string[]): Fragment {
  if (seriesNames.length === 0) return { color: { value: THEME.series[0] } };
  return {
    color: {
      field: 'k2',
      type: 'nominal',
      legend: { orient: 'top', title: null, direction: 'horizontal' },
      scale: { range: [...THEME.series] },
    },
  };
}

interface Padding {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The padding of a plot with two numeric axes; a legend takes a band above it. */
function plotPadding(seriesNames: string[], right: number): Padding {
  return { left: 76, right, top: TITLE_BAND + (seriesNames.length === 0 ? 0 : 30), bottom: 48 };
}

/** The fixed frame every chart shares: size, padding, title and theme. */
function frame(title: string, height: number, padding: Padding): Fragment {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: P.WIDTH,
    height,
    autosize: { type: 'none', contains: 'padding' },
    padding,
    background: THEME.background,
    title: {
      text: title,
      anchor: 'start',
      // Anchored to the plot group, whose left edge is our own padding, and
      // shifted back to the picture's margin from there. Anchoring to the
      // bounds instead would place it from Vega's text estimate, which is
      // what clipped the title on the pi.
      frame: 'group',
      dx: -(padding.left - MARGIN),
      fontSize: P.TITLE_FONT,
      fontWeight: 600,
      color: THEME.ink,
      offset: 14,
    },
    config: {
      font: THEME.font,
      axis: {
        labelColor: THEME.ink,
        titleColor: THEME.muted,
        gridColor: THEME.grid,
        domainColor: THEME.grid,
        tickColor: THEME.grid,
        labelFontSize: P.LABEL_FONT,
        titleFontSize: P.LABEL_FONT - 2,
      },
      legend: {
        labelColor: THEME.ink,
        labelFontSize: P.LABEL_FONT - 2,
        symbolType: 'square',
      },
      view: { stroke: null },
    },
  };
}
