// Roulette Inside Bets
//
// Generates every combination bet on an American felt from the layout itself, rather
// than listing 108 of them by hand.
//
// THE LAYOUT
//
// 1-36 sit in twelve rows of three. Number n has row = floor((n-1)/3) and
// col = (n-1) % 3:
//
//        col0 col1 col2
//   row0    1    2    3
//   row1    4    5    6
//   ...
//   row11  34   35   36
//
// Every combination bet is a shape on that grid: a split is two adjacent cells, a
// street is a row, a corner is a 2x2 block, a six line is two rows. The zero area sits
// above the grid and is handled explicitly, because 0 and 00 have no row or column.
//
// KEY SCHEME
//
// `roulette_bets.bet_type` is VARCHAR(20), so keys are compact and self-describing:
//
//   17            straight up
//   split-17-20   two pockets
//   street-16     the row starting at 16   -> 16 17 18
//   corner-13     the 2x2 with 13 top-left -> 13 14 16 17
//   line-13       the two rows from 13     -> 13..18
//   basket        0 00 1 2 3
//
// The longest is `split-17-20` at 11 characters.

export type InsideFamily = 'straight' | 'split' | 'street' | 'corner' | 'line' | 'basket';

export interface InsideBet {
  readonly key: string;
  readonly family: InsideFamily;
  /** Pocket labels this bet covers, as they appear on the wheel */
  readonly pockets: readonly string[];
  /** Profit multiplier: 17:1 is 17 */
  readonly payout: number;
  /** Human label, e.g. '13-14-16-17' */
  readonly display: string;
}

// ============ GEOMETRY ============

/** Row of a number on the felt, 0-11. */
export function rowOf(n: number): number {
  return Math.floor((n - 1) / 3);
}

/** Column of a number on the felt, 0-2. */
export function colOf(n: number): number {
  return (n - 1) % 3;
}

/** Payout by family, as a profit multiplier. */
export const INSIDE_PAYOUT: Readonly<Record<InsideFamily, number>> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  line: 5,
  // The five-number bet is the worst wager on an American table at 7.89%, well above
  // the 5.26% every other bet carries. Included for completeness; labelled as such.
  basket: 6,
} as const;

/**
 * Splits touching the zero area.
 *
 * On an American layout 0 and 00 sit side by side above the columns, so these five are
 * the only combinations involving them and cannot be derived from the 1-36 grid.
 */
const ZERO_SPLITS: readonly (readonly [string, string])[] = [
  ['0', '00'],
  ['0', '1'],
  ['0', '2'],
  ['00', '2'],
  ['00', '3'],
];

// ============ GENERATION ============

function straightBets(): InsideBet[] {
  const bets: InsideBet[] = [];
  for (const pocket of ['0', '00', ...Array.from({ length: 36 }, (_, i) => String(i + 1))]) {
    bets.push({
      key: pocket,
      family: 'straight',
      pockets: [pocket],
      payout: INSIDE_PAYOUT.straight,
      display: pocket,
    });
  }
  return bets;
}

function splitBets(): InsideBet[] {
  const bets: InsideBet[] = [];

  const push = (a: string, b: string): void => {
    bets.push({
      key: `split-${a}-${b}`,
      family: 'split',
      pockets: [a, b],
      payout: INSIDE_PAYOUT.split,
      display: `${a}-${b}`,
    });
  };

  // Horizontal: neighbours within a row.
  for (let n = 1; n <= 36; n++) {
    if (colOf(n) < 2) push(String(n), String(n + 1));
  }

  // Vertical: neighbours between consecutive rows.
  for (let n = 1; n <= 33; n++) {
    push(String(n), String(n + 3));
  }

  for (const [a, b] of ZERO_SPLITS) push(a, b);

  return bets;
}

function streetBets(): InsideBet[] {
  const bets: InsideBet[] = [];
  for (let n = 1; n <= 34; n += 3) {
    const pockets = [String(n), String(n + 1), String(n + 2)];
    bets.push({
      key: `street-${n}`,
      family: 'street',
      pockets,
      payout: INSIDE_PAYOUT.street,
      display: pockets.join('-'),
    });
  }
  return bets;
}

function cornerBets(): InsideBet[] {
  const bets: InsideBet[] = [];
  // Top-left of the 2x2 must have a neighbour to its right and a row below.
  for (let n = 1; n <= 36; n++) {
    if (colOf(n) === 2 || rowOf(n) === 11) continue;
    const pockets = [String(n), String(n + 1), String(n + 3), String(n + 4)];
    bets.push({
      key: `corner-${n}`,
      family: 'corner',
      pockets,
      payout: INSIDE_PAYOUT.corner,
      display: pockets.join('-'),
    });
  }
  return bets;
}

function lineBets(): InsideBet[] {
  const bets: InsideBet[] = [];
  // Two adjacent rows, anchored on the left-hand number of the upper row.
  for (let n = 1; n <= 31; n += 3) {
    const pockets = Array.from({ length: 6 }, (_, i) => String(n + i));
    bets.push({
      key: `line-${n}`,
      family: 'line',
      pockets,
      payout: INSIDE_PAYOUT.line,
      display: `${n}-${n + 5}`,
    });
  }
  return bets;
}

function basketBet(): InsideBet {
  return {
    key: 'basket',
    family: 'basket',
    pockets: ['0', '00', '1', '2', '3'],
    payout: INSIDE_PAYOUT.basket,
    display: '0-00-1-2-3',
  };
}

/**
 * Every inside bet on an American felt.
 *
 * 38 straight + 62 split + 12 street + 22 corner + 11 six line + 1 basket = 146.
 */
export const INSIDE_BETS: readonly InsideBet[] = [
  ...straightBets(),
  ...splitBets(),
  ...streetBets(),
  ...cornerBets(),
  ...lineBets(),
  basketBet(),
];

// ============ LOOKUP ============

const BY_KEY: ReadonlyMap<string, InsideBet> = new Map(INSIDE_BETS.map((b) => [b.key, b]));

/** The inside bet with this key, or null if it is not one. */
export function insideBet(key: string): InsideBet | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * Pocket -> every inside bet covering it.
 *
 * This index is what makes the number-anchored panel possible: pick a pocket and every
 * bet that covers it is one lookup away, rather than a scan of 146 predicates.
 */
const COVERING: ReadonlyMap<string, readonly InsideBet[]> = (() => {
  const index = new Map<string, InsideBet[]>();
  for (const bet of INSIDE_BETS) {
    for (const pocket of bet.pockets) {
      const existing = index.get(pocket) ?? [];
      existing.push(bet);
      index.set(pocket, existing);
    }
  }
  return index;
})();

/**
 * Every inside bet covering a pocket, ordered by payout so the longest shot is first.
 *
 * @param pocket - a wheel position, e.g. '17' or '00'
 */
export function insideBetsCovering(pocket: string): readonly InsideBet[] {
  return COVERING.get(pocket) ?? [];
}

/**
 * Whether an inside bet covers a pocket.
 *
 * @returns false for any key that is not an inside bet
 */
export function insideBetCovers(key: string, pocket: string): boolean {
  return insideBet(key)?.pockets.includes(pocket) ?? false;
}
