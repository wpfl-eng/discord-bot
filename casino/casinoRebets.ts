// Rebet Slips
//
// Roulette and craps both offer a Rebet button: repeat what you had on the felt last
// round. Both build the same thing to back it - the previous round's bets, grouped by
// player - and both must rebuild it from the table each round rather than appending to
// a running total. Craps once did the latter, and one Rebet click replayed every bet
// since process start.

/** One line on a Rebet slip: what was bet and for how much. */
export interface RebetLine<T extends string> {
  betType: T;
  amount: number;
}

/**
 * Group a round's bets by the player who placed them.
 *
 * Build this from the bets actually on the table at the end of a round, so the slip is
 * replaced rather than added to.
 */
export function groupRebets<T extends string>(
  bets: readonly { readonly userId: string; readonly betType: T; readonly amount: number }[]
): Map<string, RebetLine<T>[]> {
  const byUser = new Map<string, RebetLine<T>[]>();

  for (const bet of bets) {
    const existing: RebetLine<T>[] = byUser.get(bet.userId) ?? [];
    existing.push({ betType: bet.betType, amount: bet.amount });
    byUser.set(bet.userId, existing);
  }

  return byUser;
}
