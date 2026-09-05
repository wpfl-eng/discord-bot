/**
 * What the chart and table builders share: the result type every builder
 * returns, the refusals both apply, the layout both measure by, and how a
 * column's values are read (design §11).
 *
 * A builder never throws over its input. It returns a refusal written for
 * the model, ending in the one fallback sentence, so the model learns a
 * single recovery: answer in text, or narrow the query. The gates that are
 * about the run rather than the drawing -- the switch, the host, the
 * per-answer ceiling, a truncated result -- are the tools', before any SQL.
 */

import { ASK } from '../ask/askConfig.js';
import { stripLiteralsAndComments } from '../wpfl/sqlText.js';
import { THEME } from './theme.js';

const P = ASK.PICTURES;

/** Every refusal ends in this, so the model learns one recovery. */
export const FALLBACK: string = `Answer in text instead: a numbered list of at most ${ASK.RANKING_MAX_LINES} lines, or narrow the query.`;

/** What a host that cannot draw says, wherever it says it. */
export const UNAVAILABLE = 'Pictures are unavailable on this host.';

export type Row = Record<string, unknown>;

export type Built<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: string };

export function ok<T>(value: T): Built<T> {
  return { ok: true, value };
}

export function refuse<T>(reason: string): Built<T> {
  return { ok: false, refusal: `${reason} ${FALLBACK}` };
}

// ---- layout ----

/** The picture's own margin, where the title starts. */
export const MARGIN = 16;

/** The title and the air under it; the plot or the header starts here. */
export const TITLE_BAND: number = P.TITLE_FONT + 30;

/** The width of `chars` characters at `fontSize`, by the font's average glyph advance. */
export function glyphWidth(chars: number, fontSize: number): number {
  return Math.ceil(chars * fontSize * THEME.glyph);
}

// ---- columns ----

export type ColumnKind = 'number' | 'text';

/** DuckDB returns integers as strings to keep their precision; those are numbers here. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && NUMERIC.test(value.trim());
}

export function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(String(value).trim());
}

/** The columns of a result, in the order the query returned them. */
export function columnsOf(rows: readonly Row[]): string[] {
  return rows.length === 0 ? [] : Object.keys(rows[0]);
}

/**
 * A column is a number when every value it has is one. Nulls are ignored; a
 * column of nothing but nulls is text, so it is never drawn as zeroes.
 */
export function columnKind(rows: readonly Row[], column: string): ColumnKind {
  let seen = false;
  for (const row of rows) {
    const value: unknown = row[column];
    if (value === null || value === undefined) continue;
    if (!isNumeric(value)) return 'text';
    seen = true;
  }
  return seen ? 'number' : 'text';
}

/** A figure as the prose would print it: grouped, and at most two decimals. */
const FIGURE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatFigure(value: number): string {
  return FIGURE.format(value);
}

/** The d3 format Vega applies to the same rule as `formatFigure`. */
export function d3Format(values: readonly number[]): string {
  return values.every((value: number): boolean => Number.isInteger(value)) ? ',d' : ',.2~f';
}

/** Whether the statement itself orders its rows; a comment or a string that says so does not. */
export function hasOrderBy(sql: string): boolean {
  return /\border\s+by\b/i.test(stripLiteralsAndComments(sql));
}

// ---- refusals ----

/** Past the row ceiling, counted in `bars` or `rows`. */
export function tooManyRows(count: number, noun: string): string {
  return `${count} ${noun} is more than the ${P.ROWS_MAX} a picture can hold, and ${P.ROWS_INLINE} is what reads without a tap. Narrow the query.`;
}

/**
 * The refusals every picture applies before its own: an empty result, and
 * the title and alias ceilings.
 *
 * @returns the reason, or null when the picture may go on.
 */
export function checkCommon(rows: readonly Row[], title: string): string | null {
  if (rows.length === 0) return 'No rows to draw.';
  if (title.trim() === '' || title.length > P.TITLE_MAX_CHARS) {
    return `Give the picture a title of 1 to ${P.TITLE_MAX_CHARS} characters.`;
  }
  for (const alias of columnsOf(rows)) {
    if (alias.length > P.ALIAS_MAX_CHARS) {
      return `Shorten the alias \`${alias}\` to at most ${P.ALIAS_MAX_CHARS} characters; it is the axis or column title.`;
    }
  }
  return null;
}
