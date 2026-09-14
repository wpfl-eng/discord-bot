/**
 * The best lineup a roster could have started, from the points as they stand.
 *
 * The prompt forbids the model working an optimal figure out by hand, and the
 * history API that publishes one lags the live season by days. So for the
 * week in progress the boxscore tool computes it here, in code, from ESPN's
 * own eligibility lists: a player eligible at several slots -- a tight end
 * ESPN also lists at WR/TE -- is placed wherever the total is highest, which
 * a greedy pick by bare position gets wrong. The search is exact: nine slots
 * over at most fifteen players is a few thousand paths.
 *
 * A player in the IR slot is left out: ESPN does not score one from there.
 * A slot nobody left can fill scores nothing, as it would have on the day.
 */

import { formatNumber } from '../helpers/utils.js';

/**
 * The league's starting slots, in ESPN's own slot spellings: one QB, two RB,
 * two WR, one TE, a flex, a kicker and a defense. The prompt's league facts
 * state the same lineup in prose, and a test holds the two to each other.
 * This is also what makes a lineup slot a starting one, for the boxscore tool.
 */
export const LINEUP_SLOTS: readonly string[] = [
  'QB',
  'RB',
  'RB',
  'WR',
  'WR',
  'TE',
  'RB/WR/TE',
  'K',
  'D/ST',
];

export interface SolveEntry {
  readonly points: number;
  /** ESPN's eligible slots for the player, e.g. `['RB', 'RB/WR/TE', 'Bench', 'IR']`. */
  readonly eligible: readonly string[];
  /** The slot the player sits in. `IR` is excluded from the solve. */
  readonly slot: string;
}

const IR_SLOT = 'IR';

export function optimalPoints(entries: readonly SolveEntry[]): number {
  const pool: readonly SolveEntry[] = entries.filter(
    (entry: SolveEntry): boolean => entry.slot !== IR_SLOT
  );
  const candidates: readonly (readonly number[])[] = LINEUP_SLOTS.map((slot: string): number[] =>
    pool
      .map((entry: SolveEntry, index: number): number =>
        entry.eligible.includes(slot) ? index : -1
      )
      .filter((index: number): boolean => index >= 0)
  );
  const used: boolean[] = new Array<boolean>(pool.length).fill(false);
  // Every path reaches the last slot, so this is always assigned; an empty
  // roster is one path totalling 0.
  let best: number = Number.NEGATIVE_INFINITY;

  const walk = (depth: number, total: number): void => {
    if (depth === LINEUP_SLOTS.length) {
      if (total > best) best = total;
      return;
    }
    const free: number[] = candidates[depth].filter((index: number): boolean => !used[index]);
    if (free.length === 0) {
      walk(depth + 1, total);
      return;
    }
    for (const index of free) {
      used[index] = true;
      walk(depth + 1, total + pool[index].points);
      used[index] = false;
    }
  };
  walk(0, 0);
  return formatNumber(best);
}
