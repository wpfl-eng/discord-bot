// Economy System Configuration
// All constants and messages for the economy commands

// ============================================================
// Type Definitions
// ============================================================

export interface EconomyConfig {
  // Daily rewards
  readonly DAILY_AMOUNT: number;
  readonly DAILY_STREAK_BONUS: number;
  readonly DAILY_STREAK_MAX_BONUS: number;
  readonly DAILY_COOLDOWN_HOURS: number;
  readonly DAILY_STREAK_EXPIRE_HOURS: number;

  // Work
  readonly WORK_MIN: number;
  readonly WORK_MAX: number;
  readonly WORK_SUCCESS_RATE: number;
  readonly WORK_COOLDOWN_MINUTES: number;

  // Gamble
  readonly GAMBLE_MIN: number;
  readonly GAMBLE_MAX: number;
  readonly GAMBLE_COOLDOWN_SECONDS: number;

  // Slots
  readonly SLOTS_MIN: number;
  readonly SLOTS_MAX: number;
  readonly SLOTS_COOLDOWN_SECONDS: number;

  // Blackjack
  readonly BLACKJACK_MIN: number;
  readonly BLACKJACK_MAX: number;
  readonly BLACKJACK_COOLDOWN_SECONDS: number;
  readonly BLACKJACK_TIMEOUT_SECONDS: number;

  // Red Zone
  readonly REDZONE_MIN: number;
  readonly REDZONE_MAX: number;
  readonly REDZONE_COOLDOWN_SECONDS: number;
  readonly REDZONE_TIMEOUT_SECONDS: number;
  readonly REDZONE_YARD_GAIN_MIN: number;
  readonly REDZONE_YARD_GAIN_MAX: number;

  // Video Poker
  readonly VIDEO_POKER_MIN: number;
  readonly VIDEO_POKER_MAX: number;
  readonly VIDEO_POKER_COOLDOWN_SECONDS: number;
  readonly VIDEO_POKER_TIMEOUT_SECONDS: number;

  // Craps
  readonly CRAPS_MIN: number;
  readonly CRAPS_MAX: number;
  readonly CRAPS_MAX_EXPOSURE: number;

  // Rob
  readonly ROB_SUCCESS_RATE: number;
  readonly ROB_MIN_PERCENT: number;
  readonly ROB_MAX_PERCENT: number;
  readonly ROB_FAIL_FINE: number;
  readonly ROB_COOLDOWN_MINUTES: number;
  readonly ROB_VICTIM_COOLDOWN_MINUTES: number;
  readonly ROB_MIN_WALLET: number;

  // Bank
  readonly BANK_STARTING_CAPACITY: number;
  readonly BANK_EXPANSION_COST: number;
  readonly BANK_EXPANSION_AMOUNT: number;

  // Shop
  readonly PADLOCK_COST: number;
}

export interface WorkJob {
  readonly success: string;
  readonly fail: string;
}

export type SlotTier = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface SlotSymbol {
  readonly emoji: string;
  readonly name: string;
  readonly weight: number;
  readonly tier: SlotTier;
}

export interface SlotPayouts {
  readonly tripleJackpot: number;
  readonly tripleTrophy: number;
  readonly tripleGold: number;
  readonly tripleStar: number;
  readonly tripleStadium: number;
  readonly tripleCommon: number;
  readonly twoSpecial: number;
  readonly twoMatching: number;
}

export interface FieldPosition {
  readonly multiplier: number;
  readonly fumbleChance: number;
  readonly label: string;
}

export interface ChannelConfig {
  readonly TOWN_SQUARE: string | undefined;
  readonly CASINO: string | undefined;
}

// ============================================================
// Constants
// ============================================================

export const CONFIG: EconomyConfig = {
  // Daily rewards
  DAILY_AMOUNT: 100,
  DAILY_STREAK_BONUS: 10,
  DAILY_STREAK_MAX_BONUS: 100,
  DAILY_COOLDOWN_HOURS: 24,
  DAILY_STREAK_EXPIRE_HOURS: 48,

  // Work
  WORK_MIN: 20,
  WORK_MAX: 80,
  WORK_SUCCESS_RATE: 0.7,
  WORK_COOLDOWN_MINUTES: 30,

  // Gamble
  GAMBLE_MIN: 10,
  GAMBLE_MAX: 10000,
  GAMBLE_COOLDOWN_SECONDS: 10,

  // Slots
  SLOTS_MIN: 10,
  SLOTS_MAX: 10000,
  SLOTS_COOLDOWN_SECONDS: 10,

  // Blackjack
  BLACKJACK_MIN: 10,
  BLACKJACK_MAX: 10000,
  BLACKJACK_COOLDOWN_SECONDS: 5,
  BLACKJACK_TIMEOUT_SECONDS: 120,

  // Red Zone
  REDZONE_MIN: 10,
  REDZONE_MAX: 10000,
  REDZONE_COOLDOWN_SECONDS: 10,
  REDZONE_TIMEOUT_SECONDS: 120,
  REDZONE_YARD_GAIN_MIN: 5,
  REDZONE_YARD_GAIN_MAX: 20,

  // Video Poker
  VIDEO_POKER_MIN: 10,
  VIDEO_POKER_MAX: 10000,
  VIDEO_POKER_COOLDOWN_SECONDS: 5,
  VIDEO_POKER_TIMEOUT_SECONDS: 120,

  // Craps
  CRAPS_MIN: 10,
  CRAPS_MAX: 10000,
  CRAPS_MAX_EXPOSURE: 50000,

  // Rob
  ROB_SUCCESS_RATE: 0.4,
  ROB_MIN_PERCENT: 0.1,
  ROB_MAX_PERCENT: 0.3,
  ROB_FAIL_FINE: 100,
  ROB_COOLDOWN_MINUTES: 30,
  ROB_VICTIM_COOLDOWN_MINUTES: 60,
  ROB_MIN_WALLET: 100,

  // Bank
  BANK_STARTING_CAPACITY: 1000,
  BANK_EXPANSION_COST: 2000,
  BANK_EXPANSION_AMOUNT: 1000,

  // Shop
  PADLOCK_COST: 500,
} as const;

export const WORK_JOBS: readonly WorkJob[] = [
  {
    success: 'You ran routes at practice and earned',
    fail: 'You ran the wrong route and got benched. No bonus today',
  },
  {
    success: 'You hit the weight room and earned',
    fail: 'You dropped the bar on your foot. Coach is not impressed',
  },
  {
    success: 'You studied game film and earned',
    fail: 'You fell asleep during film study. Coach saw everything',
  },
  {
    success: 'You signed autographs for fans and earned',
    fail: 'You signed the wrong name. Security escorted you out',
  },
  {
    success: 'You did a press conference and earned',
    fail: "You said 'we're on to Cincinnati' 47 times. Media hated it",
  },
  {
    success: 'You filmed a commercial and earned',
    fail: 'You forgot your lines and they cut you from the ad',
  },
  {
    success: 'You attended a charity event and earned',
    fail: 'You showed up to the wrong charity. Awkward',
  },
  {
    success: 'You ran cone drills and earned',
    fail: 'You tripped over a cone and went viral for the wrong reasons',
  },
  {
    success: 'You did blocking drills and earned',
    fail: 'The tackling dummy knocked you over. Embarrassing',
  },
  {
    success: 'You attended team meetings and earned',
    fail: 'Your phone went off in the meeting. $10K fine from coach',
  },
  {
    success: 'You did conditioning and earned',
    fail: 'You failed the conditioning test. Extra laps tomorrow',
  },
  {
    success: 'You practiced celebrations and earned',
    fail: 'You pulled a muscle doing your celebration. Injured reserve',
  },
  {
    success: 'You mentored a rookie and earned',
    fail: 'The rookie outperformed you. Coach noticed',
  },
  {
    success: 'You did a podcast interview and earned',
    fail: 'You accidentally revealed the playbook. Front office is furious',
  },
  {
    success: 'You worked on your footwork and earned',
    fail: 'You stepped on a sprinkler head. Ankle is questionable',
  },
] as const;

export const CURRENCY_EMOJI = '🪙' as const;
export const CURRENCY_NAME = 'coins' as const;

// Slots symbols - football themed
export const SLOTS_SYMBOLS: readonly SlotSymbol[] = [
  { emoji: '🏈', name: 'Football', weight: 25, tier: 'common' },
  { emoji: '⚽', name: 'Ball', weight: 20, tier: 'common' },
  { emoji: '🎯', name: 'Target', weight: 15, tier: 'common' },
  { emoji: '🏟️', name: 'Stadium', weight: 15, tier: 'uncommon' },
  { emoji: '⭐', name: 'Star', weight: 10, tier: 'uncommon' },
  { emoji: '🥇', name: 'Gold', weight: 8, tier: 'rare' },
  { emoji: '🏆', name: 'Trophy', weight: 5, tier: 'rare' },
  { emoji: '🎰', name: 'Jackpot', weight: 2, tier: 'legendary' },
] as const;

// Slots payout multipliers
export const SLOTS_PAYOUTS: SlotPayouts = {
  tripleJackpot: 100,
  tripleTrophy: 25,
  tripleGold: 10,
  tripleStar: 7,
  tripleStadium: 5,
  tripleCommon: 3,
  twoSpecial: 2,
  twoMatching: 2,
} as const;

// Red Zone field positions - yard line -> { multiplier, fumbleChance }
// Tuned for moderate difficulty - reduced multipliers, increased fumble risk
export const REDZONE_FIELD_POSITIONS: Readonly<Record<number, FieldPosition>> = {
  20: { multiplier: 1.0, fumbleChance: 0.05, label: 'Own 20' },
  30: { multiplier: 1.1, fumbleChance: 0.15, label: 'Own 30' },
  40: { multiplier: 1.3, fumbleChance: 0.2, label: 'Own 40' },
  50: { multiplier: 1.6, fumbleChance: 0.25, label: 'Midfield' },
  60: { multiplier: 2.2, fumbleChance: 0.32, label: 'Opp 40' },
  70: { multiplier: 3.0, fumbleChance: 0.4, label: 'Opp 30' },
  80: { multiplier: 4.0, fumbleChance: 0.5, label: 'Red Zone' },
  90: { multiplier: 5.5, fumbleChance: 0.6, label: 'Opp 10' },
  100: { multiplier: 8.0, fumbleChance: 0, label: 'Touchdown!' },
} as const;

// Channel IDs from environment variables
export const CHANNELS: ChannelConfig = {
  TOWN_SQUARE: process.env.ECONOMY_TOWN_SQUARE_CHANNEL_ID,
  CASINO: process.env.ECONOMY_CASINO_CHANNEL_ID,
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * Formats an amount with the currency emoji
 * @param amount - The numeric amount to format
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number): string {
  // Handle NaN gracefully
  if (Number.isNaN(amount)) {
    return `${CURRENCY_EMOJI} 0`;
  }
  return `${CURRENCY_EMOJI} ${amount.toLocaleString()}`;
}

/**
 * Checks if a cooldown period has passed
 * @param lastAction - The timestamp of the last action (Date, string, null, or undefined)
 * @param cooldownMs - The cooldown duration in milliseconds
 * @returns true if cooldown has passed, false otherwise
 */
export function isCooldownOver(
  lastAction: Date | string | null | undefined,
  cooldownMs: number
): boolean {
  if (!lastAction) return true;

  const lastActionTime = new Date(lastAction).getTime();

  // Handle invalid date (NaN)
  if (Number.isNaN(lastActionTime)) {
    return true;
  }

  const elapsed = Date.now() - lastActionTime;
  return elapsed >= cooldownMs;
}

/**
 * Gets the remaining cooldown time as a formatted string
 * @param lastAction - The timestamp of the last action (Date, string, null, or undefined)
 * @param cooldownMs - The cooldown duration in milliseconds
 * @returns Formatted time string or null if cooldown has expired
 */
export function formatCooldown(
  lastAction: Date | string | null | undefined,
  cooldownMs: number
): string | null {
  if (!lastAction) return null;

  const lastActionTime = new Date(lastAction).getTime();

  // Handle invalid date (NaN)
  if (Number.isNaN(lastActionTime)) {
    return null;
  }

  const elapsed = Date.now() - lastActionTime;
  const remaining = cooldownMs - elapsed;

  if (remaining <= 0) return null;

  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Generates a random integer between min and max (inclusive)
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Random integer in range [min, max]
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Gets a random work job from the list
 * @returns A random WorkJob object
 */
export function getRandomJob(): WorkJob {
  return WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
}
