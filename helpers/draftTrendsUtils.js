/**
 * Utility functions for draft trends analysis
 */

// Constants
export const DRAFT_CONSTANTS = {
  AUCTION_START_YEAR: 2016,
  MIN_SEASON: 2010,
  MAX_SEASON: 2024,
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
  WR_HEAVY_THRESHOLD: 0.40,
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
    MEAT: '🥩'
  }
};

/**
 * Truncates a string to a maximum length
 * @param {string} value - The string to truncate
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Truncated string
 */
export function truncateFieldValue(value, maxLength = DRAFT_CONSTANTS.MAX_FIELD_LENGTH) {
  if (!value || value.length <= maxLength) return value;
  return value.substring(0, maxLength - 3) + "...";
}


/**
 * Formats a percentage with specified decimals
 * @param {number} value - The value to format
 * @param {number} total - The total for percentage calculation
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage
 */
export function formatPercentage(value, total, decimals = 1) {
  if (!total || total === 0) return "0";
  return ((value / total) * 100).toFixed(decimals);
}

/**
 * Gets emoji based on rank
 * @param {number} rank - The rank (0-based)
 * @returns {string} Appropriate emoji
 */
export function getRankEmoji(rank) {
  const { EMOJI } = DRAFT_CONSTANTS;
  switch(rank) {
    case 0: return EMOJI.CROWN;
    case 1: return EMOJI.SILVER;
    case 2: return EMOJI.BRONZE;
    default: return "";
  }
}

/**
 * Calculates draft round category
 * @param {number} position - Draft position
 * @returns {string} Round category (early/mid/late)
 */
export function getRoundCategory(position) {
  const round = Math.ceil(position / DRAFT_CONSTANTS.ROUNDS_PER_DRAFT);
  if (round <= 3) return "early";
  if (round <= 8) return "mid";
  return "late";
}

/**
 * Determines if a pick is an auction pick
 * @param {Object} pick - The draft pick object
 * @returns {boolean} Whether it's an auction pick
 */
export function isAuctionPick(pick) {
  return pick.auction_value && 
         pick.auction_value > 0 && 
         pick.season >= DRAFT_CONSTANTS.AUCTION_START_YEAR;
}

/**
 * Calculates basic statistics for an array of numbers
 * @param {number[]} values - Array of numeric values
 * @returns {Object} Statistics object with mean, variance, stdDev
 */
export function calculateStats(values) {
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
 * @param {Array} items - Array of items to group
 * @param {string} key - Key to group by
 * @returns {Object} Grouped counts
 */
export function groupAndCount(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Gets top N items from a frequency object
 * @param {Object} frequency - Object with counts
 * @param {number} n - Number of top items to return
 * @param {number} total - Total count for percentage calculation
 * @returns {Array} Array of top items with count and percentage
 */
export function getTopItems(frequency, n = 3, total = null) {
  return Object.entries(frequency)
    .filter(([key]) => key !== "Unknown")
    .sort(([,a], [,b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({
      key,
      count,
      percentage: total ? formatPercentage(count, total) : null
    }));
}

/**
 * Safely parses a float value
 * @param {any} value - Value to parse
 * @param {number} defaultValue - Default if parsing fails
 * @returns {number} Parsed float or default
 */
export function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Creates a bullet point list
 * @param {string[]} items - Array of items
 * @returns {string} Formatted bullet list
 */
export function bulletList(items) {
  return items.map(item => `• ${item}`).join("\n");
}

/**
 * Formats a player name to last name only
 * @param {string} fullName - Full player name
 * @returns {string} Last name
 */
export function getLastName(fullName) {
  if (!fullName) return "";
  const parts = fullName.split(' ');
  return parts[parts.length - 1];
}

/**
 * Determines draft personality archetype
 * @param {Object} stats - Owner stats object
 * @returns {string} Personality archetype
 */
export function getDraftArchetype(stats) {
  const { EMOJI, HIGH_AUCTION_BID, LOW_AVG_VALUE, HIGH_CONSISTENCY, HIGH_REPEAT_PLAYERS } = DRAFT_CONSTANTS;
  const complexStats = stats.complexStats || {};
  
  if (stats.auction_max_bid > HIGH_AUCTION_BID) {
    return `**${EMOJI.SHARK} SHARK MENTALITY**`;
  } else if (stats.auction_avg_value < LOW_AVG_VALUE) {
    return `**${EMOJI.FOX} VALUE VULTURE**`;
  } else if (complexStats.draftTrends?.consistency > HIGH_CONSISTENCY) {
    return `**${EMOJI.PRECISION} PRECISION DRAFTER**`;
  } else if (complexStats.repeatPlayers?.length > HIGH_REPEAT_PLAYERS) {
    return `**${EMOJI.LOYALTY} LOYALTY LEGEND**`;
  } else {
    return `**${EMOJI.CHAOS} CHAOS AGENT**`;
  }
}

/**
 * Validates season range
 * @param {number} min - Minimum season
 * @param {number} max - Maximum season
 * @returns {Object} Validated and potentially swapped season range
 */
export function validateSeasonRange(min, max) {
  let seasonMin = min;
  let seasonMax = max;
  
  // Handle defaults
  if (!seasonMin && !seasonMax) {
    seasonMin = DRAFT_CONSTANTS.MIN_SEASON;
    seasonMax = DRAFT_CONSTANTS.MAX_SEASON;
  } else if (seasonMin && !seasonMax) {
    seasonMax = DRAFT_CONSTANTS.MAX_SEASON;
  } else if (!seasonMin && seasonMax) {
    seasonMin = DRAFT_CONSTANTS.MIN_SEASON;
  }
  
  // Swap if backwards
  if (seasonMin > seasonMax) {
    [seasonMin, seasonMax] = [seasonMax, seasonMin];
  }
  
  return { seasonMin, seasonMax };
}