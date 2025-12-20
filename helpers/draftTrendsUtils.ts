/**
 * Utility functions for draft trends analysis
 */

// Types
export type RoundCategory = 'early' | 'mid' | 'late';

export interface StatsResult {
  mean: number;
  variance: number;
  stdDev: number;
}

export interface TopItem {
  key: string;
  count: number;
  percentage: string | null;
}

export interface DraftPick {
  auction_value?: number;
  season: number;
  position?: number;
  [key: string]: unknown;
}

export interface DraftComplexStats {
  draftTrends?: {
    consistency?: number;
  };
  repeatPlayers?: unknown[];
}

export interface OwnerStats {
  auction_max_bid?: number;
  auction_avg_value?: number;
  complexStats?: DraftComplexStats;
}

// Constants
export const DRAFT_CONSTANTS = {
  AUCTION_START_YEAR: 2016,
  MIN_SEASON: 2010,
  MAX_SEASON: 2025,
  ROUNDS_PER_DRAFT: 12,

  // Thresholds
  HIGH_AUCTION_BID: 65,
  LOW_AVG_VALUE: 12,
  HIGH_CONSISTENCY: 80,
  HIGH_REPEAT_PLAYERS: 5,

  // Field limits
  MAX_FIELD_LENGTH: 1024,
  MAX_DESCRIPTION_LENGTH: 4096,

  // Analysis thresholds
  ELITE_ROI: 12,
  ELITE_CONSISTENCY: 85,
  ELITE_LOYALTY: 7,
  ELITE_HIT_RATE: 65,
  HIGH_RISK_BID: 50,
  HIGH_AVG_VALUE: 20,

  // Position analysis
  RB_HEAVY_THRESHOLD: 0.35,
  WR_HEAVY_THRESHOLD: 0.4,
  EARLY_WR_THRESHOLD: 0.6,
  EARLY_RB_THRESHOLD: 0.6,
  LATE_STREAMING_THRESHOLD: 0.5,

  // Value hunting
  LATE_ROUND_THRESHOLD: 100,
  VALUE_HUNTING_MULTIPLIER: 20,

  // Formatting
  EMOJI: {
    POWER: '⚡',
    ART: '🎨',
    TROPHY: '🏆',
    DNA: '🧬',
    ARCHITECTURE: '🏗️',
    LOVE: '💝',
    PREDICT: '🔮',
    TARGET: '🎯',
    SLEEP: '😴',
    STATS: '📊',
    SHARK: '🦈',
    FOX: '🦊',
    PRECISION: '🎯',
    LOYALTY: '💘',
    CHAOS: '🎲',
    RB: '🏃',
    WR: '📡',
    MONEY: '💸',
    SEARCH: '🔍',
    CROWN: '👑',
    SILVER: '🥈',
    BRONZE: '🥉',
    DIAMOND: '💎',
    STAR: '⭐',
    STAR2: '🌟',
    FISH: '🎣',
    SWORD: '⚔️',
    TRADE: '💰',
    BRAIN: '🧠',
    EYES: '👀',
    GEM: '💎',
    RADIO: '📻',
    MEAT: '🥩',
  },
} as const;

/**
 * Truncates a string to a maximum length
 */
export function truncateFieldValue(
  value: string | null | undefined,
  maxLength: number = DRAFT_CONSTANTS.MAX_FIELD_LENGTH
): string | null | undefined {
  // Handle null/undefined gracefully
  if (value === null || value === undefined) return value;
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength - 3) + '...';
}

/**
 * Formats a percentage with specified decimals
 */
export function formatPercentage(value: number, total: number, decimals: number = 1): string {
  if (!total || total === 0) return '0';
  return ((value / total) * 100).toFixed(decimals);
}

/**
 * Gets emoji based on rank
 */
export function getRankEmoji(rank: number): string {
  const { EMOJI } = DRAFT_CONSTANTS;
  switch (rank) {
    case 0:
      return EMOJI.CROWN;
    case 1:
      return EMOJI.SILVER;
    case 2:
      return EMOJI.BRONZE;
    default:
      return '';
  }
}

/**
 * Calculates draft round category
 */
export function getRoundCategory(position: number): RoundCategory {
  const round = Math.ceil(position / DRAFT_CONSTANTS.ROUNDS_PER_DRAFT);
  if (round <= 3) return 'early';
  if (round <= 8) return 'mid';
  return 'late';
}

/**
 * Determines if a pick is an auction pick
 */
export function isAuctionPick(pick: DraftPick): boolean {
  return (
    pick.auction_value !== undefined &&
    pick.auction_value > 0 &&
    pick.season >= DRAFT_CONSTANTS.AUCTION_START_YEAR
  );
}

/**
 * Calculates basic statistics for an array of numbers
 */
export function calculateStats(values: number[] | null | undefined): StatsResult {
  if (!values || values.length === 0) {
    return { mean: 0, variance: 0, stdDev: 0 };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return { mean, variance, stdDev };
}

/**
 * Groups and counts items by a key
 */
export function groupAndCount<T extends Record<string, unknown>>(
  items: T[],
  key: keyof T
): Record<string, number> {
  return items.reduce(
    (acc, item) => {
      const value = String(item[key] ?? 'Unknown');
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

/**
 * Gets top N items from a frequency object
 */
export function getTopItems(
  frequency: Record<string, number>,
  n: number = 3,
  total: number | null = null
): TopItem[] {
  return Object.entries(frequency)
    .filter(([key]) => key !== 'Unknown')
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({
      key,
      count,
      percentage: total ? formatPercentage(count, total) : null,
    }));
}

/**
 * Safely parses a float value
 */
export function safeParseFloat(value: unknown, defaultValue: number = 0): number {
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Creates a bullet point list
 */
export function bulletList(items: string[]): string {
  return items.map((item) => `• ${item}`).join('\n');
}

/**
 * Formats a player name to last name only
 */
export function getLastName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.split(' ');
  return parts[parts.length - 1];
}

/**
 * Determines draft personality archetype
 * FIXED: Added optional chaining for complexStats access
 */
export function getDraftArchetype(stats: OwnerStats): string {
  const { EMOJI, HIGH_AUCTION_BID, LOW_AVG_VALUE, HIGH_CONSISTENCY, HIGH_REPEAT_PLAYERS } =
    DRAFT_CONSTANTS;

  if ((stats.auction_max_bid ?? 0) > HIGH_AUCTION_BID) {
    return `**${EMOJI.SHARK} SHARK MENTALITY**`;
  } else if ((stats.auction_avg_value ?? Infinity) < LOW_AVG_VALUE) {
    return `**${EMOJI.FOX} VALUE VULTURE**`;
  } else if ((stats.complexStats?.draftTrends?.consistency ?? 0) > HIGH_CONSISTENCY) {
    return `**${EMOJI.PRECISION} PRECISION DRAFTER**`;
  } else if ((stats.complexStats?.repeatPlayers?.length ?? 0) > HIGH_REPEAT_PLAYERS) {
    return `**${EMOJI.LOYALTY} LOYALTY LEGEND**`;
  } else {
    return `**${EMOJI.CHAOS} CHAOS AGENT**`;
  }
}

/**
 * Validates season range
 * FIXED: Use explicit null/undefined checks instead of falsy checks (0 is valid)
 */
export function validateSeasonRange(
  min: number | null | undefined,
  max: number | null | undefined
): { seasonMin: number; seasonMax: number } {
  let seasonMin = min;
  let seasonMax = max;

  // Handle defaults using explicit null/undefined checks (not falsy)
  const minIsNullish = seasonMin === null || seasonMin === undefined;
  const maxIsNullish = seasonMax === null || seasonMax === undefined;

  if (minIsNullish && maxIsNullish) {
    seasonMin = DRAFT_CONSTANTS.MIN_SEASON;
    seasonMax = DRAFT_CONSTANTS.MAX_SEASON;
  } else if (!minIsNullish && maxIsNullish) {
    seasonMax = DRAFT_CONSTANTS.MAX_SEASON;
  } else if (minIsNullish && !maxIsNullish) {
    seasonMin = DRAFT_CONSTANTS.MIN_SEASON;
  }

  // TypeScript now knows these are numbers
  const finalMin = seasonMin as number;
  const finalMax = seasonMax as number;

  // Swap if backwards
  if (finalMin > finalMax) {
    return { seasonMin: finalMax, seasonMax: finalMin };
  }

  return { seasonMin: finalMin, seasonMax: finalMax };
}
