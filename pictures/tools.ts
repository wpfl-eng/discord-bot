/**
 * The `chart` and `table` tools (design §11): one read-only SQL statement in,
 * a token out, and the rows alongside it so the prose is written from the
 * rows that were drawn.
 *
 * Built per run over that run's collector. The SQL goes through the same
 * engine and the same guards as `sql`, and a refused statement throws the
 * way `sql` throws. Everything the builders refuse comes back as a tool
 * error carrying the reason and the fallback, so the ticker shows the cross
 * and the audit records it, and the model recovers in one turn.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TopLevelSpec } from 'vega-lite';
import { ASK } from '../ask/askConfig.js';
import { wpflMembers, type WpflMember } from '../constants/wpflMembers.js';
import { errorMessage } from '../errors/errorHandler.js';
import { runSql, type SqlResult } from '../wpfl/sqlTool.js';
import { textResult, type AnyTool } from '../wpfl/toolResult.js';
import { buildChart, CHART_KINDS } from './chartSpec.js';
import { buildTable } from './tableSvg.js';
import { renderSvg, rasterise, picturesAvailable } from './render.js';
import { FALLBACK, UNAVAILABLE, type Built } from './shared.js';
import { tokenFor, type PictureCollector, type PictureKind } from './collector.js';

const P = ASK.PICTURES;

/** Injected so the tools are tested without DuckDB, Vega or sharp. */
export interface PictureDeps {
  readonly runSql: (sql: string) => Promise<SqlResult>;
  readonly renderSvg: (spec: TopLevelSpec) => Promise<string>;
  readonly rasterise: (svg: string) => Promise<Buffer | null>;
  /** Every canonical owner name, for the table's highlight. */
  readonly owners: readonly string[];
  /** The switch in config. */
  readonly enabled: boolean;
  /** Whether the host has been able to draw so far; false refuses before any SQL runs. */
  readonly available: () => boolean;
}

const DEFAULT_DEPS: PictureDeps = {
  runSql,
  renderSvg,
  rasterise,
  owners: wpflMembers.map((member: WpflMember): string => member.owner),
  enabled: P.ENABLED,
  available: picturesAvailable,
};

const CHART_DESCRIPTION: string = [
  'Draw a chart from one read-only SQL statement and get a token to place in the answer. Every',
  'value in the picture is a row the query returned, drawn exactly as returned, so run the query',
  'that ends in a picture through this tool rather than `sql`; the result carries the rows too,',
  'so write the prose from them. kind: bar (x is the category column, y the measure; horizontal',
  `bars in row order, so ORDER BY the measure for a ranking; at most ${P.ROWS_MAX} bars, and`,
  `${P.ROWS_INLINE} read without a tap), line (x is a season or week number with one row per x per`,
  'series, so aggregate first: two meetings in one season are one point or two series; y the measure),',
  'scatter (x and y are measures; label names a column drawn beside each point, up to',
  `${P.LABELLED_POINTS_MAX} points; a regression line appears only at ${P.REGRESSION_MIN_POINTS}`,
  'points or more). series names a column that colours the marks and groups the bars, at most',
  `${P.SERIES_MAX} values. At most ${P.PER_ANSWER} pictures an answer, aliases of`,
  `${P.ALIAS_MAX_CHARS} characters, titles of ${P.TITLE_MAX_CHARS}. Never a pie chart: it cannot`,
  'show a ranking. A refusal says why and what to do instead.',
].join(' ');

const TABLE_DESCRIPTION: string = [
  'Draw a table from one read-only SQL statement and get a token to place in the answer. Columns',
  'in query order with the aliases as headers, numbers right-aligned exactly as returned, the',
  `asker's row highlighted. At most ${P.ROWS_MAX} rows (${P.ROWS_INLINE} read without a tap) and`,
  `${P.COLUMNS_MAX} columns; aliases of ${P.ALIAS_MAX_CHARS} characters. Use it for a comparison`,
  `across ${P.TABLE_MIN_COLUMNS} or more columns or a ranking longer than ${ASK.RANKING_MAX_LINES}`,
  `lines; a ranking of ${ASK.RANKING_MAX_LINES} or fewer with one measure is a numbered list in`,
  'the text. The result carries the rows too, so write the prose from them.',
].join(' ');

const TITLE_ARG = z
  .string()
  .describe(`At most ${P.TITLE_MAX_CHARS} characters; drawn on the picture.`);

function refusal(reason: string): CallToolResult {
  return { ...textResult(reason), isError: true };
}

export function createPictureTools(
  collector: PictureCollector,
  deps: PictureDeps = DEFAULT_DEPS
): AnyTool[] {
  /**
   * The one flow both tools share. The gates about the run come first, before
   * any SQL; then `build` turns the rows into a Vega-Lite spec or, for the
   * table, straight into SVG.
   */
  async function draw(
    kind: PictureKind,
    title: string,
    sql: string,
    build: (rows: SqlResult['rows']) => Built<TopLevelSpec | string>
  ): Promise<CallToolResult> {
    const atCeiling = (): CallToolResult =>
      refusal(
        `This answer already has ${P.PER_ANSWER} pictures, the most it can carry. ${FALLBACK}`
      );
    if (!deps.enabled) return refusal(`Pictures are switched off. ${FALLBACK}`);
    if (!deps.available()) return refusal(`${UNAVAILABLE} ${FALLBACK}`);
    if (collector.full) return atCeiling();

    const started: number = Date.now();
    // Throws on a refused statement, exactly as `sql` does.
    const result: SqlResult = await deps.runSql(sql);
    if (result.truncated) {
      return refusal(
        `The query hit the ${ASK.SQL_ROW_LIMIT}-row cap, and a picture of a truncated result would omit rows. Narrow the query or aggregate. ${FALLBACK}`
      );
    }
    const built: Built<TopLevelSpec | string> = build(result.rows);
    if (!built.ok) return refusal(built.refusal);

    let svg: string;
    try {
      svg = typeof built.value === 'string' ? built.value : await deps.renderSvg(built.value);
    } catch (error: unknown) {
      return refusal(`${errorMessage(error)} ${FALLBACK}`);
    }
    const png: Buffer | null = await deps.rasterise(svg);
    if (png === null) return refusal(`${UNAVAILABLE} ${FALLBACK}`);

    // Two calls in flight can both pass the gate above; the ceiling holds here.
    if (collector.full) return atCeiling();
    const n: number = result.rows.length;
    const picture = collector.add({ kind, title, alt: `${title}: ${kind} of ${n} rows`, png });
    // The only record of a render outside the transcript, beside the
    // answer-length line: one line per picture in the pm2 log.
    console.log(`[ASK] picture ${kind} ${n} rows ${png.length} bytes ${Date.now() - started} ms`);
    return textResult(
      `Picture ready: ${tokenFor(picture.id)}. Put that token on its own line at the end of the body, before the footer, in the order the pictures should appear. It does not count toward the length limit.\n\nRows drawn: ${JSON.stringify({ n, rows: result.rows })}`
    );
  }

  const chart = tool(
    'chart',
    CHART_DESCRIPTION,
    {
      sql: z
        .string()
        .describe('A single read-only statement; for a bar chart it must carry an ORDER BY.'),
      kind: z.enum(CHART_KINDS),
      title: TITLE_ARG,
      x: z.string().describe('The column alias for x.'),
      y: z.string().describe('The column alias for y, always a measure.'),
      series: z.string().optional().describe('A column alias to colour by, and to group bars by.'),
      label: z
        .string()
        .optional()
        .describe('Scatter only: the column alias drawn beside each point.'),
    },
    async (args): Promise<CallToolResult> =>
      draw(args.kind, args.title, args.sql, (rows: SqlResult['rows']) =>
        buildChart({
          request: {
            kind: args.kind,
            title: args.title,
            x: args.x,
            y: args.y,
            series: args.series,
            label: args.label,
          },
          sql: args.sql,
          rows,
        })
      )
  );

  const table = tool(
    'table',
    TABLE_DESCRIPTION,
    {
      sql: z
        .string()
        .describe('A single read-only statement; its columns and aliases are the table.'),
      title: TITLE_ARG,
    },
    async (args): Promise<CallToolResult> =>
      draw('table', args.title, args.sql, (rows: SqlResult['rows']) =>
        buildTable({
          title: args.title,
          rows,
          highlight: collector.owner,
          owners: deps.owners,
        })
      )
  );

  return [chart, table];
}
