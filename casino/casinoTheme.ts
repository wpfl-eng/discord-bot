// Casino Theme
//
// One palette for every table game. Before this module, roulette, craps and blackjack
// each declared their own colour constants and had drifted: "push" was purple at the
// craps table and blue at the blackjack table, and three files independently spelled
// out the same green for a win.
//
// The palette is named by colour rather than by meaning, and each game maps its own
// phases onto it. That is deliberate - a shared *semantic* map would have forced the
// games to agree on what "push" looks like, which is a design change, not a refactor.

/** Named colours. Every accent used anywhere in the casino comes from this list. */
export const CASINO_COLORS = {
  /** Betting is open, the table is live and waiting */
  blue: 0x3498db,
  /** Something is resolving - the wheel, the dice, the dealer */
  gold: 0xf1c40f,
  /** The player came out ahead */
  green: 0x2ecc71,
  /** The house took it */
  red: 0xe74c3c,
  /** Nobody moved - a push, or a prompt awaiting an answer */
  purple: 0x9b59b6,
  /** A craps point is on */
  orange: 0xe67e22,
  /** A table on a run */
  coral: 0xff6b6b,
  /** Idle, cold, nobody playing */
  grey: 0x95a5a6,
  /** Shut */
  slate: 0x5d6874,
} as const;

export type CasinoColor = (typeof CASINO_COLORS)[keyof typeof CASINO_COLORS];

/**
 * Accent for a settled result, shared by all three games because they genuinely agree:
 * green up, red down, purple flat.
 *
 * @param net - the player's or table's net for the round
 */
export function resultAccent(net: number): number {
  if (net > 0) return CASINO_COLORS.green;
  if (net < 0) return CASINO_COLORS.red;
  return CASINO_COLORS.purple;
}

// ============ SHARED GLYPHS ============

/**
 * Progress bar used for the blackjack shoe and anywhere else a fraction needs to read
 * at a glance.
 *
 * @param fraction - 0..1; values outside the range are clamped
 * @param width - number of cells
 */
export function bar(fraction: number, width: number = 10): string {
  const clamped: number = Math.min(1, Math.max(0, fraction));
  const filled: number = Math.round(clamped * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
