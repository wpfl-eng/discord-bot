// Craps Game Engine
// Core game logic: bet resolution, outcome determination, payout processing

import {
  type Roll,
  type BetType,
  type BetOutcome,
  type SessionOutcome,
  type PayoutResult,
  isNatural,
  isCraps,
  isPointNumber,
  isFieldWinner,
  calculateFieldPayout,
  calculatePlacePayout,
  NATURAL_NUMBERS,
  CRAPS_NUMBERS,
} from './crapsConfig.js';

// ============ TYPE DEFINITIONS ============

/**
 * Individual bet placed by a player
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
}

/**
 * Result of resolving a single bet
 */
export interface BetResolutionResult {
  readonly bet: CrapsBet;
  readonly outcome: BetOutcome;
  readonly payout: number;
  readonly description: string;
}

/**
 * Aggregated session results per user
 */
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

/**
 * Complete outcome after resolving a roll
 */
export interface RollResolutionResult {
  readonly sessionEnded: boolean;
  readonly sessionOutcome: SessionOutcome | null;
  readonly pointEstablished: number | null;
  readonly betResults: BetResolutionResult[];
  readonly totalPaid: number;
}

// ============ BET RESOLUTION ============

/**
 * Resolve a Pass Line bet
 */
function resolvePassLine(
  bet: CrapsBet,
  roll: Roll,
  point: number | null
): PayoutResult {
  const { total } = roll;

  if (point === null) {
    // Come-out roll
    if (NATURAL_NUMBERS.includes(total)) {
      // 7 or 11 - wins
      return {
        outcome: 'win',
        payout: bet.amount * 2,
        description: 'Natural!',
      };
    }
    if (CRAPS_NUMBERS.includes(total)) {
      // 2, 3, or 12 - loses
      return {
        outcome: 'lose',
        payout: 0,
        description: 'Craps!',
      };
    }
    // Point established - bet stays
    return { outcome: 'pending', payout: 0 };
  } else {
    // Point phase
    if (total === point) {
      // Point hit - wins
      return {
        outcome: 'win',
        payout: bet.amount * 2,
        description: 'Point hit!',
      };
    }
    if (total === 7) {
      // Seven-out - loses
      return {
        outcome: 'lose',
        payout: 0,
        description: 'Seven out!',
      };
    }
    // Neither point nor 7 - stays
    return { outcome: 'pending', payout: 0 };
  }
}

/**
 * Resolve a Don't Pass bet
 */
function resolveDontPass(
  bet: CrapsBet,
  roll: Roll,
  point: number | null
): PayoutResult {
  const { total } = roll;

  if (point === null) {
    // Come-out roll
    if (total === 2 || total === 3) {
      // 2 or 3 - wins
      return {
        outcome: 'win',
        payout: bet.amount * 2,
        description: total === 2 ? 'Snake Eyes!' : 'Ace-Deuce!',
      };
    }
    if (total === 12) {
      // 12 - push (bar the 12)
      return {
        outcome: 'push',
        payout: bet.amount,
        description: 'Push on 12!',
      };
    }
    if (total === 7 || total === 11) {
      // 7 or 11 - loses
      return {
        outcome: 'lose',
        payout: 0,
        description: total === 7 ? 'Seven!' : 'Yo-Leven!',
      };
    }
    // Point established - bet stays
    return { outcome: 'pending', payout: 0 };
  } else {
    // Point phase
    if (total === 7) {
      // Seven-out - wins
      return {
        outcome: 'win',
        payout: bet.amount * 2,
        description: 'Seven out!',
      };
    }
    if (total === point) {
      // Point hit - loses
      return {
        outcome: 'lose',
        payout: 0,
        description: 'Point hit!',
      };
    }
    // Neither point nor 7 - stays
    return { outcome: 'pending', payout: 0 };
  }
}

/**
 * Resolve a Field bet (one-roll)
 */
function resolveField(bet: CrapsBet, roll: Roll): PayoutResult {
  const { total } = roll;

  if (isFieldWinner(total)) {
    const payout = calculateFieldPayout(bet.amount, total);
    let description = 'Field wins!';
    if (total === 2) {
      description = 'Snake Eyes! Double pay!';
    } else if (total === 12) {
      description = 'Boxcars! Triple pay!';
    }
    return { outcome: 'win', payout, description };
  }

  return {
    outcome: 'lose',
    payout: 0,
    description: `${total} - Field loses`,
  };
}

/**
 * Resolve a Place bet (6 or 8)
 */
function resolvePlace(
  bet: CrapsBet,
  roll: Roll,
  point: number | null
): PayoutResult {
  const { total } = roll;
  const target = bet.betType === 'place_6' ? 6 : 8;

  if (total === target) {
    // Hit the number - wins but stays active
    const winnings = calculatePlacePayout(bet.amount);
    return {
      outcome: 'win_and_stay',
      payout: winnings,
      description: `Place ${target} pays!`,
    };
  }

  if (total === 7) {
    // Seven-out - loses
    return {
      outcome: 'lose',
      payout: 0,
      description: 'Seven out!',
    };
  }

  // Check if point hit (not our number) - return bet
  if (point !== null && total === point && total !== target) {
    return {
      outcome: 'push',
      payout: bet.amount,
      description: 'Point hit - bet returned',
    };
  }

  // Still waiting
  return { outcome: 'pending', payout: 0 };
}

/**
 * Resolve a single bet based on roll and point
 */
export function resolveBet(
  bet: CrapsBet,
  roll: Roll,
  point: number | null
): PayoutResult {
  switch (bet.betType) {
    case 'pass_line':
      return resolvePassLine(bet, roll, point);
    case 'dont_pass':
      return resolveDontPass(bet, roll, point);
    case 'field':
      return resolveField(bet, roll);
    case 'place_6':
    case 'place_8':
      return resolvePlace(bet, roll, point);
    default:
      // Unknown bet type - treat as push for safety
      return {
        outcome: 'push',
        payout: bet.amount,
        description: 'Unknown bet type',
      };
  }
}

// ============ SESSION OUTCOME ============

/**
 * Determine if and how the session ends based on a roll
 * @param roll The dice roll result
 * @param point Current point (null = come-out phase)
 * @returns Session outcome or null if session continues
 */
export function determineSessionOutcome(
  roll: Roll,
  point: number | null
): SessionOutcome | null {
  const { total } = roll;

  if (point === null) {
    // Come-out phase
    if (isNatural(total)) {
      return 'natural';
    }
    if (isCraps(total)) {
      return 'craps';
    }
    // Point established - session continues (not ended)
    return null;
  } else {
    // Point phase
    if (total === 7) {
      return 'seven_out';
    }
    if (total === point) {
      return 'point_hit';
    }
    // Session continues
    return null;
  }
}

/**
 * Determine if a point should be established
 */
export function shouldEstablishPoint(roll: Roll, point: number | null): number | null {
  if (point !== null) {
    // Already have a point
    return null;
  }
  if (isPointNumber(roll.total)) {
    return roll.total;
  }
  return null;
}

// ============ BATCH RESOLUTION ============

/**
 * Resolve all bets after a roll
 * @param bets All active bets
 * @param roll The dice roll result
 * @param point Current point (null = come-out phase)
 * @returns Resolution results for all bets
 */
export function resolveAllBets(
  bets: CrapsBet[],
  roll: Roll,
  point: number | null
): RollResolutionResult {
  const sessionOutcome = determineSessionOutcome(roll, point);
  // Any session outcome (natural, craps, point_hit, seven_out) ends the session
  const sessionEnded = sessionOutcome !== null;
  const pointEstablished = shouldEstablishPoint(roll, point);

  const betResults: BetResolutionResult[] = [];
  let totalPaid = 0;

  for (const bet of bets) {
    if (bet.status !== 'active') {
      continue;
    }

    const result = resolveBet(bet, roll, point);

    // Update bet status based on outcome
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
        // Bet stays active but pays out winnings
        bet.payout = (bet.payout ?? 0) + result.payout;
        totalPaid += result.payout;
        break;
      case 'pending':
        // No change
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
    sessionEnded,
    sessionOutcome,
    pointEstablished,
    betResults,
    totalPaid,
  };
}

// ============ USER RESULTS AGGREGATION ============

/**
 * Mutable builder for user session results
 */
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

/**
 * Aggregate bet results by user for session summary
 */
export function aggregateUserResults(
  betResults: BetResolutionResult[]
): UserSessionResult[] {
  const userMap = new Map<string, UserResultBuilder>();

  for (const result of betResults) {
    const { bet, outcome, payout } = result;

    // Skip pending bets
    if (outcome === 'pending' || outcome === 'win_and_stay') {
      continue;
    }

    let user = userMap.get(bet.userId);
    if (!user) {
      user = {
        userId: bet.userId,
        username: bet.username,
        netResult: 0,
        breakdown: [],
      };
      userMap.set(bet.userId, user);
    }

    // Calculate net for this bet
    let netForBet: number;
    let outcomeLabel: 'won' | 'lost' | 'push';

    switch (outcome) {
      case 'win':
        netForBet = payout - bet.amount; // Profit only
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

  // Convert to readonly interface
  return Array.from(userMap.values()).map((builder): UserSessionResult => ({
    userId: builder.userId,
    username: builder.username,
    netResult: builder.netResult,
    breakdown: builder.breakdown,
  }));
}

// ============ VALIDATION ============

/**
 * Check if a bet type can be placed in the current phase
 */
export function canPlaceBetType(
  betType: BetType,
  point: number | null
): { allowed: boolean; reason?: string } {
  const isComeout = point === null;

  switch (betType) {
    case 'pass_line':
    case 'dont_pass':
      if (!isComeout) {
        return {
          allowed: false,
          reason: `${betType === 'pass_line' ? 'Pass Line' : "Don't Pass"} bets can only be placed during come-out phase`,
        };
      }
      return { allowed: true };

    case 'place_6':
    case 'place_8':
      if (isComeout) {
        return {
          allowed: false,
          reason: 'Place bets require a point to be established',
        };
      }
      return { allowed: true };

    case 'field':
      // Field can be placed any time
      return { allowed: true };

    default:
      return { allowed: false, reason: 'Unknown bet type' };
  }
}

/**
 * Check if user already has a conflicting bet
 * - Can only have one Pass Line bet
 * - Can only have one Don't Pass bet
 * - Multiple Field bets allowed (one-roll)
 * - Place bets aggregate (add to existing)
 */
export function checkDuplicateBet(
  existingBets: CrapsBet[],
  userId: string,
  betType: BetType
): { allowed: boolean; aggregate?: boolean; reason?: string } {
  const userBets = existingBets.filter(
    (b) => b.userId === userId && b.status === 'active'
  );

  switch (betType) {
    case 'pass_line':
      if (userBets.some((b) => b.betType === 'pass_line')) {
        return {
          allowed: false,
          reason: 'You already have a Pass Line bet',
        };
      }
      return { allowed: true };

    case 'dont_pass':
      if (userBets.some((b) => b.betType === 'dont_pass')) {
        return {
          allowed: false,
          reason: "You already have a Don't Pass bet",
        };
      }
      return { allowed: true };

    case 'field':
      // Multiple field bets allowed
      return { allowed: true };

    case 'place_6':
    case 'place_8':
      // Place bets aggregate
      if (userBets.some((b) => b.betType === betType)) {
        return { allowed: true, aggregate: true };
      }
      return { allowed: true };

    default:
      return { allowed: false, reason: 'Unknown bet type' };
  }
}

// ============ UTILITY ============

/**
 * Generate a unique bet ID
 */
export function generateBetId(): string {
  return `bet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get total exposure (sum of active bets) for a user
 */
export function getUserExposure(bets: CrapsBet[], userId: string): number {
  return bets
    .filter((b) => b.userId === userId && b.status === 'active')
    .reduce((sum, b) => sum + b.amount, 0);
}
