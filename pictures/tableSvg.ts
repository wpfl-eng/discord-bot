/**
 * A result set as a picture of a table (design §11): a plain SVG grid on the
 * same sharp path the charts take. Vega adds nothing to a grid, and its text
 * estimate would be deciding the column widths.
 *
 * Numbers are right-aligned and never truncated. A text cell longer than the
 * label ceiling is cut with an ellipsis. The asker's row is highlighted only
 * when exactly one column holds canonical owner names and exactly one row is
 * theirs: decoration, never data, and never on a table where the owner
 * column means the opponent.
 */

import { ASK } from '../ask/askConfig.js';
import { escapeXml } from '../helpers/svg.js';
import { truncate } from '../helpers/utils.js';
import { THEME } from './theme.js';
import {
  type Built,
  type ColumnKind,
  type Row,
  ok,
  refuse,
  checkCommon,
  columnsOf,
  columnKind,
  toNumber,
  formatFigure,
  glyphWidth,
  tooManyRows,
  MARGIN,
  TITLE_BAND,
} from './shared.js';

const P = ASK.PICTURES;

export interface TableInput {
  readonly title: string;
  readonly rows: readonly Row[];
  /** The asker's canonical owner name. */
  readonly highlight: string;
  /** Every canonical owner name, for finding the owner column. */
  readonly owners: readonly string[];
}

const CELL_PAD = 10;
const HEADER_HEIGHT = 30;
const BOTTOM = 12;

interface Column {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly cells: readonly string[];
  width: number;
}

export function buildTable(input: TableInput): Built<string> {
  const { rows } = input;
  const common: string | null = checkCommon(rows, input.title);
  if (common !== null) return refuse(common);
  if (rows.length > P.ROWS_MAX) return refuse(tooManyRows(rows.length, 'rows'));
  const names: string[] = columnsOf(rows);
  if (names.length > P.COLUMNS_MAX) {
    return refuse(
      `${names.length} columns is more than the ${P.COLUMNS_MAX} a table can hold. Drop a column.`
    );
  }

  const columns: Column[] = names.map((name: string): Column => {
    const kind: ColumnKind = columnKind(rows, name);
    const cells: string[] = rows.map((row: Row): string => cell(row[name], kind));
    const longest: number = Math.max(name.length, ...cells.map((c: string): number => c.length));
    return { name, kind, cells, width: glyphWidth(longest, P.LABEL_FONT) + 2 * CELL_PAD };
  });

  const needed: number =
    2 * MARGIN + columns.reduce((sum: number, column: Column): number => sum + column.width, 0);
  if (needed > P.TABLE_MAX_WIDTH) {
    return refuse('This table is too wide to read. Shorten the aliases or drop a column.');
  }
  const width: number = Math.max(P.WIDTH, needed);
  // Spare width goes to the first column, so numbers stay packed to the right.
  columns[0].width += width - needed;
  const height: number = TITLE_BAND + HEADER_HEIGHT + rows.length * P.ROW_PITCH + BOTTOM;

  const highlighted: number = highlightRow(rows, columns, input);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${THEME.font}">`,
    `<rect width="${width}" height="${height}" fill="${THEME.background}"/>`,
    `<text x="${MARGIN}" y="${14 + P.TITLE_FONT}" font-size="${P.TITLE_FONT}" font-weight="600" fill="${THEME.ink}">${escapeXml(input.title)}</text>`,
  ];

  // Header.
  let x: number = MARGIN;
  const headerY: number = TITLE_BAND + HEADER_HEIGHT / 2;
  for (const column of columns) {
    parts.push(
      textAt(
        x,
        column.width,
        headerY,
        column.kind,
        column.name,
        P.LABEL_FONT - 2,
        THEME.muted,
        true
      )
    );
    x += column.width;
  }
  parts.push(
    `<line x1="${MARGIN}" y1="${TITLE_BAND + HEADER_HEIGHT}" x2="${width - MARGIN}" y2="${TITLE_BAND + HEADER_HEIGHT}" stroke="${THEME.grid}" stroke-width="1"/>`
  );

  // Rows.
  rows.forEach((_row: Row, index: number): void => {
    const top: number = TITLE_BAND + HEADER_HEIGHT + index * P.ROW_PITCH;
    const isHighlight: boolean = index === highlighted;
    if (isHighlight) {
      parts.push(
        `<rect class="highlight" x="${MARGIN}" y="${top}" width="${width - 2 * MARGIN}" height="${P.ROW_PITCH}" fill="${THEME.accent}" fill-opacity="0.16"/>`,
        `<rect x="${MARGIN}" y="${top}" width="4" height="${P.ROW_PITCH}" fill="${THEME.accent}"/>`
      );
    } else if (index % 2 === 1) {
      parts.push(
        `<rect x="${MARGIN}" y="${top}" width="${width - 2 * MARGIN}" height="${P.ROW_PITCH}" fill="${THEME.stripe}"/>`
      );
    }
    let cx: number = MARGIN;
    for (const column of columns) {
      parts.push(
        textAt(
          cx,
          column.width,
          top + P.ROW_PITCH / 2,
          column.kind,
          column.cells[index],
          P.LABEL_FONT,
          THEME.ink,
          isHighlight
        )
      );
      cx += column.width;
    }
  });

  parts.push('</svg>');
  return ok(parts.join('\n'));
}

/** A cell's text: a formatted figure, or text cut at the label ceiling. */
function cell(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return '';
  if (kind === 'number') return formatFigure(toNumber(value));
  return truncate(String(value), P.LABEL_MAX_CHARS);
}

function textAt(
  x: number,
  width: number,
  y: number,
  kind: ColumnKind,
  text: string,
  size: number,
  fill: string,
  bold: boolean
): string {
  const anchor: string = kind === 'number' ? 'end' : 'start';
  const tx: number = kind === 'number' ? x + width - CELL_PAD : x + CELL_PAD;
  const weight: string = bold ? ' font-weight="700"' : '';
  return `<text x="${tx}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central"${weight}>${escapeXml(text)}</text>`;
}

/**
 * The index of the asker's row, or -1. Exactly one column of canonical owner
 * names, and exactly one row in it that is theirs.
 */
function highlightRow(rows: readonly Row[], columns: readonly Column[], input: TableInput): number {
  const ownerColumns: Column[] = columns.filter((column: Column): boolean => {
    if (column.kind !== 'text') return false;
    let seen = false;
    for (const row of rows) {
      const value: unknown = row[column.name];
      if (value === null || value === undefined) continue;
      if (!input.owners.includes(String(value))) return false;
      seen = true;
    }
    return seen;
  });
  if (ownerColumns.length !== 1) return -1;

  const matches: number[] = [];
  rows.forEach((row: Row, index: number): void => {
    if (String(row[ownerColumns[0].name]) === input.highlight) matches.push(index);
  });
  return matches.length === 1 ? matches[0] : -1;
}
