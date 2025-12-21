// Polymarket API Types
// Types for Gamma API responses and internal data structures

// ============ API Response Types ============

/**
 * Tag/category from Polymarket
 */
export interface PolymarketTag {
  readonly id: number;
  readonly label: string;
  readonly slug: string;
}

/**
 * Market from Polymarket Gamma API
 */
export interface PolymarketMarket {
  readonly id: string;
  readonly slug: string;
  readonly question: string;
  readonly description: string;
  readonly outcomes: string[]; // ["Trump", "Harris", "Other"]
  readonly outcomePrices: string[]; // ["0.35", "0.42", "0.23"] - strings from API
  readonly clobTokenIds: string[]; // Token IDs for each outcome
  readonly endDate: string; // ISO timestamp
  readonly closed: boolean;
  readonly volume: string;
  readonly liquidity: string;
  readonly active: boolean;
}

/**
 * Simplified market for display
 */
export interface MarketDisplay {
  readonly id: string;
  readonly slug: string;
  readonly question: string;
  readonly outcomes: OutcomeDisplay[];
  readonly endDate: Date;
  readonly closed: boolean;
  readonly volume: number;
}

/**
 * Outcome with calculated payout
 */
export interface OutcomeDisplay {
  readonly index: number;
  readonly name: string;
  readonly price: number; // 0.35 = 35 cents
  readonly clobTokenId: string;
  readonly payoutMultiplier: number; // 1 / price = potential return
}

// ============ Database Types ============

/**
 * Bet status
 */
export type BetStatus = 'open' | 'won' | 'lost' | 'voided';

/**
 * Prediction bet record from database
 */
export interface PredictionBet {
  readonly id: number;
  readonly user_id: string;
  readonly market_id: string;
  readonly market_slug: string | null;
  readonly market_question: string;
  readonly outcome_name: string;
  readonly clob_token_id: string;
  readonly coins_wagered: number;
  readonly locked_odds: string; // Decimal comes as string from postgres
  readonly potential_payout: number;
  readonly status: BetStatus;
  readonly payout: number;
  readonly resolved_at: Date | null;
  readonly placed_at: Date;
  readonly expires_at: Date | null;
}

// ============ Operation Result Types ============

/**
 * Place bet error types
 */
export type PlaceBetError = 'INSUFFICIENT_FUNDS' | 'MARKET_CLOSED' | 'INVALID_AMOUNT';

/**
 * Successful bet placement
 */
export interface PlaceBetSuccess {
  readonly success: true;
  readonly bet: PredictionBet;
}

/**
 * Failed bet placement
 */
export interface PlaceBetFailure {
  readonly success: false;
  readonly error: PlaceBetError;
}

/**
 * Place bet result (discriminated union)
 */
export type PlaceBetResult = PlaceBetSuccess | PlaceBetFailure;

/**
 * Resolution result for a single bet
 */
export interface BetResolutionResult {
  readonly bet: PredictionBet;
  readonly previousStatus: BetStatus;
  readonly newStatus: BetStatus;
  readonly payout: number;
}

/**
 * Settlement summary for user
 */
export interface SettlementSummary {
  readonly results: BetResolutionResult[];
  readonly totalWon: number;
  readonly totalLost: number;
  readonly netChange: number;
  readonly stillOpen: number;
}

// ============ API Client Types ============

/**
 * Resolution info for a market
 */
export interface MarketResolution {
  readonly marketId: string;
  readonly resolved: boolean;
  readonly winningOutcomeIndex: number | null;
  readonly winningTokenId: string | null;
  readonly voided: boolean;
}
