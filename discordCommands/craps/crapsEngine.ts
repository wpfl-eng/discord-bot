// Craps Game Engine
//
// Bet resolution, outcome determination and payout processing. Pure functions
// throughout - nothing here reads table state, talks to Discord or touches the
// database, so every payout is directly testable.
//
// PAYOUT CONVENTION
//
//   win / push      `payout` is the TOTAL RETURN: stake + winnings.
//   win_and_stay    `payout` is WINNINGS ONLY - the stake remains on the number.
//   lose / pending  `payout` is 0.
//
// SESSION VS DECISION
//
// A roll produces a *decision* about the line bets. Only one decision - a seven-out -
// also ends the shooter's *session* and passes the dice. This distinction did not exist
// before, which is why the shooter changed on every come-out 7 or 11.

import {
  type Roll,
  type BetType,
  type BetOutcome,
  type SessionOutcome,
  type PayoutResult,
  BET_TYPES,
  HARDWAY_TARGET,
  PLACE_TARGET,
  PROP_WINNERS,
  isNatural,
  isCraps,
  isPointNumber,
  isFieldWinner,
  isHardWay,
  endsSession,
  calculateFieldPayout,
  calculatePlacePayout,
  maxOdds,
  oddsPayout,
  oddsParentType,
  NATURAL_NUMBERS,
  CRAPS_NUMBERS,
} from './crapsConfig.js';

// ============ TYPE DEFINITIONS ============

/**
 * Individual bet placed by a player.
 *
 * Odds bets are the only ones that are not self-contained: they sit behind a line bet
 * and pay by the point that was on when they were placed, so both are recorded here.
 */
export interface CrapsBet {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly betType: BetType;
  amount: number; // Mutable for place bet aggregation
  readonly placedAt: Date;
  status: 'active' | 'won' | 'lost' | 'push';
  payout?: number;
  /** Odds bets only: the id of the line bet being backed */
  readonly parentBetId?: string;
  /**
   * Odds bets only: the point they were placed behind.
   *
   * Payouts vary by point, and a bet must settle against the point it was made on even
   * if the table has since moved on.
   */
  readonly oddsPoint?: number;
  /**
   * Escrow rows holding this stake, so it can be settled or voided exactly.
   *
   * A list rather than one id because place, hardway and odds stakes aggregate: adding
   * to a number you are already riding keeps one row on the board but opens a second
   * escrow row, and both have to resolve together. Keeping only the first meant a
   * losing bet was half refunded when the table closed, a winning one was paid AND
   * given its second stake back, and a take-down returned less than it announced.
   */
  escrowIds: number[];
}

export interface BetResolutionResult {
  readonly bet: CrapsBet;
  readonly outcome: BetOutcome;
  readonly payout: number;
  readonly description: string;
}

export interface UserSessionResult {
  readonly userId: string;
  readonly username: string;
  readonly netResult: number;
  readonly breakdown: {
    readonly betType: BetType;
    readonly amount: number;
    readonly outcome: 'won' | 'lost' | 'push';
    readonly payout: number;
  }[];
}

export interface RollResolutionResult {
  /** True only when the dice pass to a new shooter */
  readonly sessionEnded: boolean;
  /** What this roll decided about the line, whether or not the session ended */
  readonly sessionOutcome: SessionOutcome | null;
  readonly pointEstablished: number | null;
  readonly betResults: BetResolutionResult[];
  readonly totalPaid: number;
}

// ============ BET RESOLUTION ============

function resolvePassLine(bet: CrapsBet, roll: Roll, point: number | null): PayoutResult {
  const { total } = roll;

  if (point === null) {
    if (NATURAL_NUMBERS.includes(total)) {
      return { outcome: 'win', payout: bet.amount * 2, description: 'Natural!' };
    }
    if (CRAPS_NUMBERS.includes(total)) {
      return { outcome: 'lose', payout: 0, description: 'Craps!' };
    }
    return { outcome: 'pending', payout: 0 };
  }

  if (total === point) {
    return { outcome: 'win', payout: bet.amount * 2, description: 'Point hit!' };
  }
  if (total === 7) {
    return { outcome: 'lose', payout: 0, description: 'Seven out!' };
  }
  return { outcome: 'pending', payout: 0 };
}

function resolveDontPass(bet: CrapsBet, roll: Roll, point: number | null): PayoutResult {
  const { total } = roll;

  if (point === null) {
    if (total === 2 || total === 3) {
      return {
        outcome: 'win',
        payout: bet.amount * 2,
        description: total === 2 ? 'Snake Eyes!' : 'Ace-Deuce!',
      };
    }
    // Bar the 12. This single rule is the entire house edge on the don't side.
    if (total === 12) {
      return { outcome: 'push', payout: bet.amount, description: 'Push on 12!' };
    }
    if (total === 7 || total === 11) {
      return {
        outcome: 'lose',
        payout: 0,
        description: total === 7 ? 'Seven!' : 'Yo-Leven!',
      };
    }
    return { outcome: 'pending', payout: 0 };
  }

  if (total === 7) {
    return { outcome: 'win', payout: bet.amount * 2, description: 'Seven out!' };
  }
  if (total === point) {
    return { outcome: 'lose', payout: 0, description: 'Point hit!' };
  }
  return { outcome: 'pending', payout: 0 };
}

/**
 * Free odds. Pays true odds by the point the bet was placed behind, which is why it
 * carries its own `oddsPoint` rather than reading the table's current point.
 */
function resolveOdds(bet: CrapsBet, roll: Roll): PayoutResult {
  const point: number | undefined = bet.oddsPoint;
  if (point === undefined) {
    // An odds bet with no point recorded cannot be settled fairly; hand the stake back.
    return { outcome: 'push', payout: bet.amount, description: 'Odds bet had no point' };
  }

  const ratio = oddsPayout(bet.betType, point);
  if (!ratio) {
    return { outcome: 'push', payout: bet.amount, description: 'No odds for that point' };
  }

  const { total } = roll;
  const winsOnPoint: boolean = bet.betType === 'pass_odds';
  const hitPoint: boolean = total === point;
  const sevenedOut: boolean = total === 7;

  if (!hitPoint && !sevenedOut) return { outcome: 'pending', payout: 0 };

  const won: boolean = winsOnPoint ? hitPoint : sevenedOut;
  if (!won) return { outcome: 'lose', payout: 0, description: 'Odds lost' };

  const [win, wager] = ratio;
  return {
    outcome: 'win',
    payout: bet.amount + Math.floor((bet.amount * win) / wager),
    description: `Odds paid ${win}:${wager}`,
  };
}

/**
 * Place bets ride the number until it hits or a seven comes.
 *
 * They are OFF during a come-out roll, which is the casino default and the reason a
 * point hit neither pays nor returns them - they simply sit out the next come-out and
 * come back to life when a new point is established.
 */
function resolvePlace(bet: CrapsBet, roll: Roll, point: number | null): PayoutResult {
  if (point === null) return { outcome: 'pending', payout: 0 };

  const target: number | undefined = PLACE_TARGET[bet.betType];
  if (target === undefined) return { outcome: 'pending', payout: 0 };

  const { total } = roll;

  if (total === target) {
    return {
      outcome: 'win_and_stay',
      payout: calculatePlacePayout(bet.amount, bet.betType),
      description: `Place ${target} pays!`,
    };
  }
  if (total === 7) {
    return { outcome: 'lose', payout: 0, description: 'Seven out!' };
  }
  return { outcome: 'pending', payout: 0 };
}

/**
 * Hardways. The number must come as a pair, before either the same number the easy way
 * or any seven. Off during the come-out, like place bets.
 */
function resolveHardway(bet: CrapsBet, roll: Roll, point: number | null): PayoutResult {
  if (point === null) return { outcome: 'pending', payout: 0 };

  const target: number | undefined = HARDWAY_TARGET[bet.betType];
  if (target === undefined) return { outcome: 'pending', payout: 0 };

  const { total } = roll;
  const payout = BET_TYPES[bet.betType].payout;

  if (total === target) {
    if (isHardWay(roll) && payout) {
      const [win, wager] = payout;
      return {
        outcome: 'win',
        payout: bet.amount + Math.floor((bet.amount * win) / wager),
        description: `Hard ${target}!`,
      };
    }
    return { outcome: 'lose', payout: 0, description: `${target} the easy way` };
  }

  if (total === 7) {
    return { outcome: 'lose', payout: 0, description: 'Seven out!' };
  }
  return { outcome: 'pending', payout: 0 };
}

/** One-roll props. Live in every phase, decided immediately, never carried over. */
function resolveProp(bet: CrapsBet, roll: Roll): PayoutResult {
  const winners: readonly number[] | undefined = PROP_WINNERS[bet.betType];
  const payout = BET_TYPES[bet.betType].payout;

  if (!winners || !payout) return { outcome: 'lose', payout: 0, description: '' };

  if (winners.includes(roll.total)) {
    const [win, wager] = payout;
    return {
      outcome: 'win',
      payout: bet.amount + Math.floor((bet.amount * win) / wager),
      description: `${BET_TYPES[bet.betType].name} hits!`,
    };
  }

  return { outcome: 'lose', payout: 0, description: `${roll.total} - no good` };
}

function resolveField(bet: CrapsBet, roll: Roll): PayoutResult {
  const { total } = roll;

  if (isFieldWinner(total)) {
    let description = 'Field wins!';
    if (total === 2) description = 'Snake Eyes! Double pay!';
    else if (total === 12) description = 'Boxcars! Triple pay!';
    return { outcome: 'win', payout: calculateFieldPayout(bet.amount, total), description };
  }

  return { outcome: 'lose', payout: 0, description: `${total} - Field loses` };
}

/**
 * Resolve a single bet against a roll.
 *
 * @param bet - the wager, including its odds point where relevant
 * @param roll - the dice, as a pair; hardways depend on HOW the total was made
 * @param point - the table's current point, or null during a come-out
 */
export function resolveBet(bet: CrapsBet, roll: Roll, point: number | null): PayoutResult {
  const family = BET_TYPES[bet.betType]?.family;

  switch (family) {
    case 'line':
      return bet.betType === 'pass_line'
        ? resolvePassLine(bet, roll, point)
        : resolveDontPass(bet, roll, point);
    case 'odds':
      return resolveOdds(bet, roll);
    case 'field':
      return resolveField(bet, roll);
    case 'place':
      return resolvePlace(bet, roll, point);
    case 'hardway':
      return resolveHardway(bet, roll, point);
    case 'prop':
      return resolveProp(bet, roll);
    default:
      // Unknown bet type - hand the stake back rather than guess.
      return { outcome: 'push', payout: bet.amount, description: 'Unknown bet type' };
  }
}

// ============ SESSION OUTCOME ============

/**
 * What this roll decided about the line bets.
 *
 * Returning a value here does NOT mean the shooter is done - see `endsSession`.
 */
export function determineSessionOutcome(roll: Roll, point: number | null): SessionOutcome | null {
  const { total } = roll;

  if (point === null) {
    if (isNatural(total)) return 'natural';
    if (isCraps(total)) return 'craps';
    return null;
  }

  if (total === 7) return 'seven_out';
  if (total === point) return 'point_hit';
  return null;
}

/** Whether this roll establishes a point. */
export function shouldEstablishPoint(roll: Roll, point: number | null): number | null {
  if (point !== null) return null;
  return isPointNumber(roll.total) ? roll.total : null;
}

// ============ BATCH RESOLUTION ============

/**
 * Resolve every active bet against a roll.
 *
 * @returns the decision, whether the dice pass, and one result per bet
 */
export function resolveAllBets(
  bets: CrapsBet[],
  roll: Roll,
  point: number | null
): RollResolutionResult {
  const sessionOutcome = determineSessionOutcome(roll, point);
  const pointEstablished = shouldEstablishPoint(roll, point);

  const betResults: BetResolutionResult[] = [];
  let totalPaid = 0;

  for (const bet of bets) {
    if (bet.status !== 'active') continue;

    const result = resolveBet(bet, roll, point);

    switch (result.outcome) {
      case 'win':
        bet.status = 'won';
        bet.payout = result.payout;
        totalPaid += result.payout;
        break;
      case 'lose':
        bet.status = 'lost';
        bet.payout = 0;
        break;
      case 'push':
        bet.status = 'push';
        bet.payout = result.payout;
        totalPaid += result.payout;
        break;
      case 'win_and_stay':
        // The number paid but the stake rides on.
        bet.payout = (bet.payout ?? 0) + result.payout;
        totalPaid += result.payout;
        break;
      case 'pending':
        break;
    }

    betResults.push({
      bet,
      outcome: result.outcome,
      payout: result.payout,
      description: result.description ?? '',
    });
  }

  return {
    // Only a seven-out passes the dice. Every other decision leaves them in the same
    // hand for another come-out.
    sessionEnded: endsSession(sessionOutcome),
    sessionOutcome,
    pointEstablished,
    betResults,
    totalPaid,
  };
}

// ============ USER RESULTS AGGREGATION ============

interface UserResultBuilder {
  userId: string;
  username: string;
  netResult: number;
  breakdown: Array<{
    betType: BetType;
    amount: number;
    outcome: 'won' | 'lost' | 'push';
    payout: number;
  }>;
}

/** Aggregate bet results by user for a summary frame. */
export function aggregateUserResults(betResults: BetResolutionResult[]): UserSessionResult[] {
  const userMap = new Map<string, UserResultBuilder>();

  for (const result of betResults) {
    const { bet, outcome, payout } = result;
    if (outcome === 'pending') continue;

    let user = userMap.get(bet.userId);
    if (!user) {
      user = { userId: bet.userId, username: bet.username, netResult: 0, breakdown: [] };
      userMap.set(bet.userId, user);
    }

    let netForBet: number;
    let outcomeLabel: 'won' | 'lost' | 'push';

    switch (outcome) {
      case 'win':
        netForBet = payout - bet.amount;
        outcomeLabel = 'won';
        break;
      // A place bet that paid and stayed up is pure profit: the stake never left.
      case 'win_and_stay':
        netForBet = payout;
        outcomeLabel = 'won';
        break;
      case 'lose':
        netForBet = -bet.amount;
        outcomeLabel = 'lost';
        break;
      case 'push':
        netForBet = 0;
        outcomeLabel = 'push';
        break;
      default:
        continue;
    }

    user.netResult += netForBet;
    user.breakdown.push({
      betType: bet.betType,
      amount: bet.amount,
      outcome: outcomeLabel,
      payout,
    });
  }

  return Array.from(userMap.values()).map(
    (builder): UserSessionResult => ({
      userId: builder.userId,
      username: builder.username,
      netResult: builder.netResult,
      breakdown: builder.breakdown,
    })
  );
}

// ============ VALIDATION ============

/**
 * Whether the table's phase allows this bet right now.
 *
 * The board only ever shows legal bets (it swaps rows by phase), so this is the
 * backstop for the slash-command path and for a click that races a phase change.
 */
export function canPlaceBetType(
  betType: BetType,
  point: number | null
): { allowed: boolean; reason?: string } {
  const config = BET_TYPES[betType];
  if (!config) return { allowed: false, reason: 'Unknown bet type' };

  const isComeout: boolean = point === null;

  if (config.phase === 'any') return { allowed: true };

  if (config.phase === 'comeout' && !isComeout) {
    return { allowed: false, reason: `${config.name} can only be placed on a come-out roll` };
  }

  if (config.phase === 'point' && isComeout) {
    return { allowed: false, reason: `${config.name} needs a point to be established` };
  }

  return { allowed: true };
}

export interface OddsValidation {
  readonly allowed: boolean;
  readonly reason?: string;
  /** The line bet the odds will sit behind */
  readonly parent?: CrapsBet;
}

/**
 * Odds carry rules no other bet does: they need a line bet to sit behind, and they are
 * capped at a multiple of that line bet which varies by point.
 *
 * @param existingBets - every bet currently on the table
 * @param userId - who is backing
 * @param betType - `pass_odds` or `dont_pass_odds`
 * @param point - the current point
 * @param amount - the odds stake being attempted
 */
export function canPlaceOdds(
  existingBets: readonly CrapsBet[],
  userId: string,
  betType: BetType,
  point: number | null,
  amount: number
): OddsValidation {
  const parentType: BetType | null = oddsParentType(betType);
  if (!parentType) return { allowed: false, reason: 'Not an odds bet' };

  if (point === null) {
    return { allowed: false, reason: 'Odds need a point to be established' };
  }

  const parent = existingBets.find(
    (b) => b.userId === userId && b.betType === parentType && b.status === 'active'
  );

  if (!parent) {
    return {
      allowed: false,
      reason: `You need a ${BET_TYPES[parentType].name} bet before you can back it with odds`,
    };
  }

  const alreadyBacked: number = existingBets
    .filter((b) => b.userId === userId && b.betType === betType && b.status === 'active')
    .reduce((sum, b) => sum + b.amount, 0);

  const ceiling: number = maxOdds(parent.amount, point);
  if (alreadyBacked + amount > ceiling) {
    const remaining: number = Math.max(0, ceiling - alreadyBacked);
    return {
      allowed: false,
      reason:
        remaining > 0
          ? `On a point of ${point} you can back ${parent.amount} with at most ${ceiling}. You have ${remaining} left.`
          : `You are already backed to the ${ceiling} maximum on a point of ${point}.`,
    };
  }

  return { allowed: true, parent };
}

/**
 * Whether a user may add this bet, and whether it merges into one they already hold.
 *
 * One line bet each; everything else either aggregates onto the existing stake or is
 * a fresh one-roll wager.
 */
export function checkDuplicateBet(
  existingBets: CrapsBet[],
  userId: string,
  betType: BetType
): { allowed: boolean; aggregate?: boolean; reason?: string } {
  const config = BET_TYPES[betType];
  if (!config) return { allowed: false, reason: 'Unknown bet type' };

  const userBets = existingBets.filter((b) => b.userId === userId && b.status === 'active');

  if (config.family === 'line') {
    if (userBets.some((b) => b.betType === betType)) {
      return { allowed: false, reason: `You already have a ${config.name} bet` };
    }
    return { allowed: true };
  }

  // Field and props are one-roll wagers; a player may stack as many as they like.
  if (config.behavior === 'one-roll') return { allowed: true };

  // Place, hardway and odds stakes merge onto the number already being ridden.
  if (userBets.some((b) => b.betType === betType)) {
    return { allowed: true, aggregate: true };
  }
  return { allowed: true };
}

/**
 * Whether a player may pull a bet back off the table.
 *
 * The pass line is a CONTRACT bet: once a point is established the player has taken the
 * good end of the come-out and cannot then withdraw. Everything else - including don't
 * pass, which is the reverse trade - comes down freely.
 *
 * @param betType - the bet being taken down
 * @param point - the table's current point, or null on a come-out
 */
export function canTakeDown(betType: BetType, point: number | null): boolean {
  if (betType === 'pass_line' && point !== null) return false;
  return true;
}

// ============ UTILITY ============

/** Generate a unique bet ID */
export function generateBetId(): string {
  return `bet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** Total exposure (sum of active bets) for a user */
export function getUserExposure(bets: CrapsBet[], userId: string): number {
  return bets
    .filter((b) => b.userId === userId && b.status === 'active')
    .reduce((sum, b) => sum + b.amount, 0);
}
