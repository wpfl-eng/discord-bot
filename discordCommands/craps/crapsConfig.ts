// Craps Configuration
//
// Bet types, payouts, timing, and helpers for the craps game.
//
// The table carries every bet a real craps layout offers except come and don't come.
// Those two are excluded deliberately: each player can hold up to six live come points,
// every one separately backable with its own odds, which is a per-player sub-state
// machine rather than another entry in this table. Everything here resolves purely from
// the roll total and the dice pair.

import { CONFIG } from '../../economy/economyConfig.js';
import { emoji } from '../../emoji/emojiRegistry.js';

// ============ TYPE DEFINITIONS ============

/** Phases when bets can be placed */
export type BetPhase = 'comeout' | 'point' | 'any';

/** Bet resolution behavior */
export type BetBehavior = 'one-roll' | 'multi-roll';

/** Possible outcomes when resolving a bet */
export type BetOutcome = 'win' | 'lose' | 'push' | 'win_and_stay' | 'pending';

/**
 * Every bet the table offers.
 *
 * Keys stay at or under 16 characters because `craps_bets.bet_type` is VARCHAR(16).
 * The longest is `dont_pass_odds` at 14.
 */
export type BetType =
  | 'pass_line'
  | 'dont_pass'
  | 'field'
  | 'pass_odds'
  | 'dont_pass_odds'
  | 'place_4'
  | 'place_5'
  | 'place_6'
  | 'place_8'
  | 'place_9'
  | 'place_10'
  | 'hard_4'
  | 'hard_6'
  | 'hard_8'
  | 'hard_10'
  | 'any_seven'
  | 'any_craps'
  | 'yo'
  | 'snake_eyes'
  | 'boxcars';

/** Groups bets for board layout and stats rollup. */
export type BetFamily = 'line' | 'odds' | 'field' | 'place' | 'hardway' | 'prop';

/** Table status states */
export type TableStatus = 'idle' | 'betting' | 'rolling' | 'resolved';

/**
 * What a roll did to the line bets.
 *
 * Distinct from whether the SHOOTER's session ended - see `endsSession`. A natural or a
 * craps on the come-out decides the line and hands the same shooter the dice again.
 */
export type SessionOutcome = 'natural' | 'craps' | 'point_hit' | 'seven_out';

/** Dice roll result */
export interface Roll {
  readonly die1: number;
  readonly die2: number;
  readonly total: number;
  readonly timestamp: Date;
}

/** Bet type configuration */
export interface BetTypeConfig {
  readonly id: BetType;
  readonly name: string;
  readonly description: string;
  /**
   * Fixed payout as [win, wager]; 7:6 is [7, 6].
   *
   * Odds bets pay by the point rather than by bet type, so theirs is null and
   * `oddsPayout()` is consulted instead.
   */
  readonly payout: readonly [number, number] | null;
  readonly houseEdge: number;
  readonly phase: BetPhase;
  readonly behavior: BetBehavior;
  readonly family: BetFamily;
  /** Short board label, e.g. 'P6' for Place 6 */
  readonly short: string;
}

/** Payout result from bet resolution */
export interface PayoutResult {
  readonly outcome: BetOutcome;
  readonly payout: number;
  readonly description?: string;
}

// ============ BET TYPE DEFINITIONS ============

export const BET_TYPES: Record<BetType, BetTypeConfig> = {
  pass_line: {
    id: 'pass_line',
    name: 'Pass Line',
    description: 'Win on 7/11 come-out, or point before 7',
    payout: [1, 1],
    houseEdge: 1.41,
    phase: 'comeout',
    behavior: 'multi-roll',
    family: 'line',
    short: 'Pass',
  },
  dont_pass: {
    id: 'dont_pass',
    name: "Don't Pass",
    description: 'Win on 2/3 come-out (12 push), or 7 before point',
    payout: [1, 1],
    houseEdge: 1.36,
    phase: 'comeout',
    behavior: 'multi-roll',
    family: 'line',
    short: "Don't",
  },
  field: {
    id: 'field',
    name: 'Field',
    description: 'Win on 2,3,4,9,10,11,12 (2x on 2, 3x on 12)',
    payout: [1, 1],
    houseEdge: 5.56,
    phase: 'any',
    behavior: 'one-roll',
    family: 'field',
    short: 'Field',
  },

  // ---- Free odds. The only bets in the building with no house edge. ----
  pass_odds: {
    id: 'pass_odds',
    name: 'Pass Odds',
    description: 'Back your pass line at true odds — the house has no edge on it',
    payout: null,
    houseEdge: 0,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'odds',
    short: 'Odds',
  },
  dont_pass_odds: {
    id: 'dont_pass_odds',
    name: "Don't Pass Odds",
    description: "Lay true odds behind your don't pass — no house edge",
    payout: null,
    houseEdge: 0,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'odds',
    short: 'Lay',
  },

  // ---- Place bets ----
  place_4: {
    id: 'place_4',
    name: 'Place 4',
    description: 'Win when 4 is rolled, lose on 7',
    payout: [9, 5],
    houseEdge: 6.67,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'place',
    short: 'P4',
  },
  place_5: {
    id: 'place_5',
    name: 'Place 5',
    description: 'Win when 5 is rolled, lose on 7',
    payout: [7, 5],
    houseEdge: 4.0,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'place',
    short: 'P5',
  },
  place_6: {
    id: 'place_6',
    name: 'Place 6',
    description: 'Win when 6 is rolled, lose on 7',
    payout: [7, 6],
    houseEdge: 1.52,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'place',
    short: 'P6',
  },
  place_8: {
    id: 'place_8',
    name: 'Place 8',
    description: 'Win when 8 is rolled, lose on 7',
    payout: [7, 6],
    houseEdge: 1.52,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'place',
    short: 'P8',
  },
  place_9: {
    id: 'place_9',
    name: 'Place 9',
    description: 'Win when 9 is rolled, lose on 7',
    payout: [7, 5],
    houseEdge: 4.0,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'place',
    short: 'P9',
  },
  place_10: {
    id: 'place_10',
    name: 'Place 10',
    description: 'Win when 10 is rolled, lose on 7',
    payout: [9, 5],
    houseEdge: 6.67,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'place',
    short: 'P10',
  },

  // ---- Hardways. Must come as a pair; the easy way and any 7 both kill it. ----
  hard_4: {
    id: 'hard_4',
    name: 'Hard 4',
    description: 'Win on 2+2 before any 4 the easy way or a 7',
    payout: [7, 1],
    houseEdge: 11.11,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'hardway',
    short: 'H4',
  },
  hard_6: {
    id: 'hard_6',
    name: 'Hard 6',
    description: 'Win on 3+3 before any 6 the easy way or a 7',
    payout: [9, 1],
    houseEdge: 9.09,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'hardway',
    short: 'H6',
  },
  hard_8: {
    id: 'hard_8',
    name: 'Hard 8',
    description: 'Win on 4+4 before any 8 the easy way or a 7',
    payout: [9, 1],
    houseEdge: 9.09,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'hardway',
    short: 'H8',
  },
  hard_10: {
    id: 'hard_10',
    name: 'Hard 10',
    description: 'Win on 5+5 before any 10 the easy way or a 7',
    payout: [7, 1],
    houseEdge: 11.11,
    phase: 'point',
    behavior: 'multi-roll',
    family: 'hardway',
    short: 'H10',
  },

  // ---- One-roll props. Terrible odds, great theatre. ----
  any_seven: {
    id: 'any_seven',
    name: 'Any Seven',
    description: 'Next roll is a 7',
    payout: [4, 1],
    houseEdge: 16.67,
    phase: 'any',
    behavior: 'one-roll',
    family: 'prop',
    short: 'Any 7',
  },
  any_craps: {
    id: 'any_craps',
    name: 'Any Craps',
    description: 'Next roll is 2, 3 or 12',
    payout: [7, 1],
    houseEdge: 11.11,
    phase: 'any',
    behavior: 'one-roll',
    family: 'prop',
    short: 'Craps',
  },
  yo: {
    id: 'yo',
    name: 'Yo (11)',
    description: 'Next roll is 11',
    payout: [15, 1],
    houseEdge: 11.11,
    phase: 'any',
    behavior: 'one-roll',
    family: 'prop',
    short: 'Yo',
  },
  snake_eyes: {
    id: 'snake_eyes',
    name: 'Snake Eyes (2)',
    description: 'Next roll is 2',
    payout: [30, 1],
    houseEdge: 13.89,
    phase: 'any',
    behavior: 'one-roll',
    family: 'prop',
    short: '2',
  },
  boxcars: {
    id: 'boxcars',
    name: 'Boxcars (12)',
    description: 'Next roll is 12',
    payout: [30, 1],
    houseEdge: 13.89,
    phase: 'any',
    behavior: 'one-roll',
    family: 'prop',
    short: '12',
  },
} as const;

/** All bet type IDs for iteration */
export const ALL_BET_TYPES: readonly BetType[] = Object.keys(BET_TYPES) as BetType[];

/** Bet types available during come-out phase */
export const COMEOUT_BET_TYPES: readonly BetType[] = [
  'pass_line',
  'dont_pass',
  'field',
  'any_seven',
  'any_craps',
  'yo',
  'snake_eyes',
  'boxcars',
];

/** Bet types available once a point is on */
export const POINT_BET_TYPES: readonly BetType[] = [
  'pass_odds',
  'dont_pass_odds',
  'field',
  'place_4',
  'place_5',
  'place_6',
  'place_8',
  'place_9',
  'place_10',
  'hard_4',
  'hard_6',
  'hard_8',
  'hard_10',
  'any_seven',
  'any_craps',
  'yo',
  'snake_eyes',
  'boxcars',
];

/** Bets in a family, in board order. */
export function betsInFamily(family: BetFamily): readonly BetType[] {
  return ALL_BET_TYPES.filter((t) => BET_TYPES[t].family === family);
}

// ============ BET TARGETS ============

/** The number a place bet is riding on. */
export const PLACE_TARGET: Readonly<Partial<Record<BetType, number>>> = {
  place_4: 4,
  place_5: 5,
  place_6: 6,
  place_8: 8,
  place_9: 9,
  place_10: 10,
} as const;

/** The number a hardway is riding on. Only even totals can be made "hard". */
export const HARDWAY_TARGET: Readonly<Partial<Record<BetType, number>>> = {
  hard_4: 4,
  hard_6: 6,
  hard_8: 8,
  hard_10: 10,
} as const;

/** Totals that win each one-roll prop. */
export const PROP_WINNERS: Readonly<Partial<Record<BetType, readonly number[]>>> = {
  any_seven: [7],
  any_craps: [2, 3, 12],
  yo: [11],
  snake_eyes: [2],
  boxcars: [12],
} as const;

/** Place bet for a given number, so the board can build its select. */
export function placeBetFor(target: number): BetType | null {
  const found = (Object.keys(PLACE_TARGET) as BetType[]).find((t) => PLACE_TARGET[t] === target);
  return found ?? null;
}

// ============ ODDS ============

/**
 * Conventional 3-4-5x odds caps: a player may back the line by at most this multiple of
 * their line bet, chosen so the maximum win is always 6x the line bet whatever the point.
 */
export const ODDS_MAX_MULTIPLE: Readonly<Record<number, number>> = {
  4: 3,
  10: 3,
  5: 4,
  9: 4,
  6: 5,
  8: 5,
} as const;

/** True odds on a pass line odds bet, by point. Exactly fair - no house edge. */
export const PASS_ODDS_PAYOUT: Readonly<Record<number, readonly [number, number]>> = {
  4: [2, 1],
  10: [2, 1],
  5: [3, 2],
  9: [3, 2],
  6: [6, 5],
  8: [6, 5],
} as const;

/**
 * True odds laying against the point. The inverse of the pass side: a don't bettor is
 * now the favourite, so they must risk more to win less.
 */
export const DONT_ODDS_PAYOUT: Readonly<Record<number, readonly [number, number]>> = {
  4: [1, 2],
  10: [1, 2],
  5: [2, 3],
  9: [2, 3],
  6: [5, 6],
  8: [5, 6],
} as const;

/**
 * Payout ratio for an odds bet.
 *
 * @param betType - `pass_odds` or `dont_pass_odds`
 * @param point - the point the odds were placed behind
 * @returns [win, wager], or null if the bet type is not an odds bet or the point is invalid
 */
export function oddsPayout(
  betType: BetType,
  point: number
): readonly [number, number] | null {
  if (betType === 'pass_odds') return PASS_ODDS_PAYOUT[point] ?? null;
  if (betType === 'dont_pass_odds') return DONT_ODDS_PAYOUT[point] ?? null;
  return null;
}

/** The line bet that a given odds bet must sit behind. */
export function oddsParentType(betType: BetType): BetType | null {
  if (betType === 'pass_odds') return 'pass_line';
  if (betType === 'dont_pass_odds') return 'dont_pass';
  return null;
}

/** Largest odds bet allowed behind a line bet of `lineAmount` on this point. */
export function maxOdds(lineAmount: number, point: number): number {
  const multiple: number = ODDS_MAX_MULTIPLE[point] ?? 0;
  return lineAmount * multiple;
}

// ============ TIMING CONFIGURATION ============

export const TIMING = {
  /** Initial come-out betting window in seconds */
  COMEOUT_BETTING_SECONDS: 45,

  /** Betting window between point phase rolls in seconds */
  POINT_BETTING_SECONDS: 15,

  /** Time added when a new bet is placed in seconds */
  BET_EXTENDS_TIMER_BY: 5,

  /** Maximum betting window in seconds */
  MAX_BETTING_SECONDS: 60,

  /** Dice rolling animation duration in ms */
  ROLL_ANIMATION_MS: 2500,

  /** Result display duration before next phase in ms */
  RESULT_DISPLAY_MS: 3000,

  /** Grace period before table goes cold in seconds */
  GRACE_PERIOD_SECONDS: 15,

  /**
   * How long the shooter gets to throw before the table rolls for them.
   *
   * The dice genuinely belong to one player, but an absent shooter must never freeze
   * the game for everyone else.
   */
  SHOOTER_GRACE_SECONDS: 15,
} as const;

// ============ LIMITS ============

export const LIMITS = {
  /** Minimum bet amount */
  MIN_BET: CONFIG.CRAPS_MIN,

  /** Maximum bet amount */
  MAX_BET: CONFIG.CRAPS_MAX,

  /** Maximum total exposure per user per session */
  MAX_EXPOSURE: CONFIG.CRAPS_MAX_EXPOSURE,
} as const;

/** Chip denominations offered on the board, mirroring roulette's. */
export const CHIPS: readonly number[] = [100, 1_000, 10_000, 50_000];

/** Stake a player starts on before touching a chip button */
export const DEFAULT_CHIP = 1_000;

// ============ DICE DISPLAY ============

/** Unicode dice faces, used when the application emoji have not been uploaded. */
export const DICE_FALLBACK: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
} as const;

/** Emoji name for a die face, e.g. 4 -> 'd4' */
export function dieEmojiName(value: number): string {
  return `d${value}`;
}

/**
 * A single die.
 *
 * Custom art when it has been uploaded, Unicode otherwise - the table stays fully
 * playable either way.
 */
export function getDieEmoji(value: number): string {
  return emoji(dieEmojiName(value), DICE_FALLBACK[value] ?? '?');
}

/**
 * Format a dice roll as emoji display
 * @example formatDiceRoll(4, 5) → "⚃ ⚄"
 */
export function formatDiceRoll(die1: number, die2: number): string {
  return `${getDieEmoji(die1)} ${getDieEmoji(die2)}`;
}

/** Emoji names for the point puck, on and off. */
export const PUCK_ON_NAME = 'puckOn';
export const PUCK_OFF_NAME = 'puckOff';

/** The point marker. */
export function puckDisplay(point: number | null): string {
  return point === null
    ? `${emoji(PUCK_OFF_NAME, '⚪')} OFF`
    : `${emoji(PUCK_ON_NAME, '🔴')} ON ${point}`;
}

/** Roll two dice and return the result */
export function rollDice(): Roll {
  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  return {
    die1,
    die2,
    total: die1 + die2,
    timestamp: new Date(),
  };
}

/** Whether a roll was made "the hard way" - both dice showing the same face. */
export function isHardWay(roll: Roll): boolean {
  return roll.die1 === roll.die2;
}

// ============ ROLL CLASSIFICATION ============

/** Numbers that establish a point */
export const POINT_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];

/** Natural win on come-out */
export const NATURAL_NUMBERS: readonly number[] = [7, 11];

/** Craps loss on come-out */
export const CRAPS_NUMBERS: readonly number[] = [2, 3, 12];

/** Field winning numbers */
export const FIELD_WINNERS: readonly number[] = [2, 3, 4, 9, 10, 11, 12];

/** Field losing numbers */
export const FIELD_LOSERS: readonly number[] = [5, 6, 7, 8];

export function isNatural(total: number): boolean {
  return NATURAL_NUMBERS.includes(total);
}

export function isCraps(total: number): boolean {
  return CRAPS_NUMBERS.includes(total);
}

export function isPointNumber(total: number): boolean {
  return POINT_NUMBERS.includes(total);
}

export function isFieldWinner(total: number): boolean {
  return FIELD_WINNERS.includes(total);
}

/**
 * Whether this outcome passes the dice to the next shooter.
 *
 * ONLY a seven-out does. A natural or a craps on the come-out decides the line bets and
 * the SAME shooter immediately throws another come-out; hitting the point likewise
 * leaves the dice where they are. Treating every decision as the end of a session - as
 * this game did before - is why the shooter never persisted.
 */
export function endsSession(outcome: SessionOutcome | null): boolean {
  return outcome === 'seven_out';
}

// ============ PAYOUT CALCULATION ============

/**
 * Calculate payout for a winning bet
 * @param amount - Original bet amount
 * @param payout - Payout ratio [win, wager]
 * @returns Total return (original bet + winnings)
 */
export function calculatePayout(amount: number, payout: readonly [number, number]): number {
  const [win, wager] = payout;
  const winnings = Math.floor((amount * win) / wager);
  return amount + winnings;
}

/**
 * Calculate field bet payout (special cases for 2 and 12)
 * @param amount - Original bet amount
 * @param total - Dice total
 * @returns Total return
 */
export function calculateFieldPayout(amount: number, total: number): number {
  if (total === 2) return amount + amount * 2;
  if (total === 12) return amount + amount * 3;
  return amount * 2;
}

/**
 * Winnings only for a place bet, which stays on the table after it pays.
 *
 * @param amount - the stake riding on the number
 * @param betType - which place bet, since 6/8 pay 7:6 but 4/10 pay 9:5
 */
export function calculatePlacePayout(amount: number, betType: BetType): number {
  const payout = BET_TYPES[betType]?.payout;
  if (!payout) return 0;
  const [win, wager] = payout;
  return Math.floor((amount * win) / wager);
}

// ============ DISPLAY HELPERS ============

/** Human-readable name for a roll total. */
export function getRollName(total: number, point: number | null): string {
  if (total === 7) {
    return point === null ? 'SEVEN! Natural!' : 'SEVEN OUT!';
  }
  if (total === 11) return 'YO-LEVEN!';
  if (total === 2) return 'SNAKE EYES!';
  if (total === 3) return 'ACE-DEUCE!';
  if (total === 12) return 'BOXCARS!';
  if (point !== null && total === point) return `${total}! POINT HIT!`;
  return `${total}!`;
}

/** Display name for a bet type */
export function getBetDisplay(betType: BetType): string {
  return BET_TYPES[betType]?.name ?? betType;
}

/** Short board label for a bet type */
export function getBetShort(betType: BetType): string {
  return BET_TYPES[betType]?.short ?? betType;
}

/**
 * Payout as a ratio string for board and select labels.
 *
 * Odds bets need the point to say anything useful, so without one they say so.
 */
export function payoutLabel(betType: BetType, point: number | null = null): string {
  const config = BET_TYPES[betType];
  if (!config) return '';

  if (config.payout === null) {
    if (point === null) return 'true odds';
    const odds = oddsPayout(betType, point);
    return odds ? `${odds[0]}:${odds[1]}` : 'true odds';
  }

  return `${config.payout[0]}:${config.payout[1]}`;
}

// Compact amounts live in casino/casinoFormat.ts, shared with roulette and blackjack.
// Re-exported here so every existing importer keeps its import path.
export { formatAmount } from '../../casino/casinoFormat.js';

// ============ CHANNEL CONFIGURATION ============

/** Get the craps channel ID from environment */
export function getCrapsChannelId(): string | undefined {
  return process.env.CRAPS_CHANNEL_ID;
}

// ============ HOT STREAK THRESHOLDS ============

export const HOT_STREAK_THRESHOLDS = {
  WARM: 5,
  HOT: 8,
  MONSTER: 12,
  LEGENDARY: 15,
} as const;

/** Get hot streak message based on roll count */
export function getHotStreakMessage(rollCount: number): string | null {
  if (rollCount >= HOT_STREAK_THRESHOLDS.LEGENDARY) return `LEGENDARY! ${rollCount} rolls!`;
  if (rollCount >= HOT_STREAK_THRESHOLDS.MONSTER) return `MONSTER ROLL! ${rollCount} rolls!`;
  if (rollCount >= HOT_STREAK_THRESHOLDS.HOT)
    return `HOT TABLE! ${rollCount} rolls and counting!`;
  if (rollCount >= HOT_STREAK_THRESHOLDS.WARM) return `Table is heating up! ${rollCount} rolls!`;
  return null;
}
