/**
 * WPFL API Response Types
 * Base URL: https://wpflapi.azurewebsites.net/api
 */

/**
 * Expected Wins API Response
 * Endpoint: /api/expectedwins
 */
export interface ExpectedWinsResponse {
  readonly owner: string;
  readonly expectedWins: number;
  readonly actualWins: number;
  readonly seasonMin: number;
  readonly seasonMax: number;
  readonly weekMin: number;
  readonly weekMax: number;
}

/**
 * Optimal Coaching API Response
 * Endpoint: /api/optimalcoaching/pointsfor/{year}
 */
export interface OptimalCoachingResponse {
  readonly owner: string;
  readonly actualPointsFor: number;
  readonly optimalPointsFor: number;
  readonly season: number;
  readonly week: number;
}

/**
 * Fantasy Matchup Winners API Response
 * Endpoint: /api/fantasyMatchupWinners
 * Used by: clutch, cursed, closestscores
 */
export interface FantasyMatchupResponse {
  readonly id: number;
  readonly week: string;
  readonly season: string;
  readonly teamA: string;
  readonly teamAPoints: number;
  readonly teamB: string;
  readonly teamBPoints: number;
  readonly homeTeam: string;
  readonly isPlayoffs: boolean;
  readonly fantasyLeague: string;
  readonly margin: number;
}

/**
 * Draft History API Response
 * Endpoint: /api/draft/history
 */
export interface DraftHistoryResponse {
  readonly id: number;
  readonly owner: string;
  readonly player: string;
  readonly playerNflTeam: string;
  readonly playerNflPosition: string;
  readonly averageDraftPosition: number | null;
  readonly league: string;
  readonly draftPosition: number;
  readonly auctionValue: number | null;
  readonly season: number;
}

/**
 * Player Scores API Response
 * Endpoint: /api/playerscores
 */
export interface PlayerScoreResponse {
  readonly playerScoreId: number;
  readonly owner: string;
  readonly player: string;
  readonly week: number;
  readonly season: number;
  readonly playerOpponent: string;
  readonly playerHome: string;
  readonly points: number;
  readonly rosterSlot: string;
  readonly playerNflTeam: string;
  readonly playerNflPosition: string;
  readonly fantasyLeague: string;
}

/**
 * Transactions API Response
 * Endpoint: /api/transactions
 *
 * The wire shape. The /ask cache (wpfl/historyCache.ts) writes these rows with
 * `manager` renamed to `owner`, the key every other cached table joins on.
 * `result` is "Processed" for a bid that went through; every other value
 * ("Outbid", "Roster Limit", "Budget Exceeded", ...) is a failed bid that
 * still carries its `bidAmount`. `percentOfBudget` is the bid against that
 * season's FAAB budget, which has changed over the years.
 */
export interface TransactionResponse {
  readonly id: number;
  readonly season: number;
  readonly week: number;
  readonly manager: string;
  readonly addedPlayer: string;
  readonly addedPlayerNflPosition: string;
  readonly droppedPlayer: string;
  readonly bidAmount: number;
  readonly percentOfBudget: number;
  readonly processedTime: string;
  readonly result: string;
}

/**
 * Drafted Points API Response
 * Endpoint: /api/draft/draftedpoints
 */
export interface DraftedPointsResponse {
  readonly owner: string;
  readonly draftedPoints: number;
  readonly rosteredOptimalPoints: number;
  readonly actualPoints: number;
}
