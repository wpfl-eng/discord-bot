/**
 * What the chart and table builders share: the result type every builder
 * returns, the refusals both apply, and how a column's values are read
 * (design §11).
 *
 * A builder never throws over its input. It returns a refusal written for
 * the model, ending in the one fallback sentence, so the model learns a
 * single recovery: answer in text, or narrow the query.
 */

import { ASK } from '../ask/askConfig.js';

const P = ASK.PICTURES;

/** Every refusal ends in this, so the model learns one recovery. */
export const FALLBACK: string = `Answer in text instead: a numbered list of at most ${ASK.RANKING_MAX_LINES} lines, or narrow the query.`;

export type Row = Record<string, unknown>;

export type Built<T> =
  | { readonly ok: true; readonly value: T; readonly n: number }
  | { readonly ok: false; readonly refusal: string };

export function ok<T>(value: T, n: number): Built<T> {
  return { ok: true, value, n };
}

export function refuse<T>(reason: string): Built<T> {
  return { ok: false, refusal: `${reason} ${FALLBACK}` };
}

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

export function hasOrderBy(sql: string): boolean {
  return /\border\s+by\b/i.test(sql);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The refusals every picture applies before its own: the switch, a truncated
 * result, an empty one, and the title and alias ceilings.
 *
 * @returns the reason, or null when the picture may go on.
 */
export function checkCommon(
  rows: readonly Row[],
  truncated: boolean,
  title: string
): string | null {
  if (!P.ENABLED) return 'Pictures are switched off.';
  if (truncated) {
    return `The query hit the ${ASK.SQL_ROW_LIMIT}-row cap, and a picture of a truncated result would omit rows. Narrow the query or aggregate.`;
  }
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
