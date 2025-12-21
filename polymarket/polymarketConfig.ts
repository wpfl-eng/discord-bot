// Polymarket Configuration
// Betting limits, API settings, and category mappings

// ============ Betting Limits ============

export const CONFIG = {
  /** Minimum bet amount in coins */
  MIN_BET: 10,

  /** Maximum bet amount in coins */
  MAX_BET: 10_000,

  /** Cooldown between bets in seconds (0 = no cooldown) */
  BET_COOLDOWN_SECONDS: 0,

  /** Button collector timeout in milliseconds */
  COLLECTOR_TIMEOUT_MS: 60_000,

  /** How many markets to show per page */
  MARKETS_PER_PAGE: 5,

  /** Threshold for determining winning outcome (price > this = winner) */
  WINNING_PRICE_THRESHOLD: 0.95,
} as const;

// ============ API Configuration ============

export const API_CONFIG = {
  /** Polymarket Gamma API base URL */
  BASE_URL: 'https://gamma-api.polymarket.com',

  /** Cache TTL for tags in milliseconds (1 hour) */
  TAGS_CACHE_TTL_MS: 60 * 60 * 1000,

  /** Minimum delay between API requests in milliseconds */
  REQUEST_DELAY_MS: 100,

  /** Request timeout in milliseconds */
  REQUEST_TIMEOUT_MS: 10_000,

  /** Default limit for market queries */
  DEFAULT_MARKET_LIMIT: 10,
} as const;

// ============ Featured Categories ============

/**
 * Categories to show as main buttons
 * These are curated from Polymarket's tags for best UX
 */
export const FEATURED_CATEGORIES = [
  { slug: 'politics', label: 'Politics', emoji: '🏛️' },
  { slug: 'sports', label: 'Sports', emoji: '🏈' },
  { slug: 'crypto', label: 'Crypto', emoji: '💎' },
  { slug: 'entertainment', label: 'Culture', emoji: '🎬' },
] as const;

/**
 * Tag IDs mapped to category slugs (populated at runtime from API)
 */
export const categoryTagIds: Map<string, number> = new Map();

// ============ Display Formatting ============

/**
 * Format odds as cents (e.g., 0.35 -> "35¢")
 */
export function formatOdds(odds: number): string {
  const cents = Math.round(odds * 100);
  return `${cents}¢`;
}

/**
 * Format payout multiplier (e.g., 2.86x)
 */
export function formatMultiplier(odds: number): string {
  if (odds <= 0) return '0x';
  const multiplier = 1 / odds;
  return `${multiplier.toFixed(2)}x`;
}

/**
 * Format coins with emoji
 */
export function formatCoins(amount: number): string {
  return `🪙 ${amount.toLocaleString()}`;
}

/**
 * Calculate potential payout from wager and odds
 */
export function calculatePayout(wager: number, odds: number): number {
  if (odds <= 0) return 0;
  return Math.floor(wager / odds);
}

/**
 * Format date for display
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
