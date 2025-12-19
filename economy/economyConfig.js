// Economy System Configuration
// All constants and messages for the economy commands

export const CONFIG = {
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
};

export const WORK_JOBS = [
  { success: "You ran routes at practice and earned", fail: "You ran the wrong route and got benched. No bonus today" },
  { success: "You hit the weight room and earned", fail: "You dropped the bar on your foot. Coach is not impressed" },
  { success: "You studied game film and earned", fail: "You fell asleep during film study. Coach saw everything" },
  { success: "You signed autographs for fans and earned", fail: "You signed the wrong name. Security escorted you out" },
  { success: "You did a press conference and earned", fail: "You said 'we're on to Cincinnati' 47 times. Media hated it" },
  { success: "You filmed a commercial and earned", fail: "You forgot your lines and they cut you from the ad" },
  { success: "You attended a charity event and earned", fail: "You showed up to the wrong charity. Awkward" },
  { success: "You ran cone drills and earned", fail: "You tripped over a cone and went viral for the wrong reasons" },
  { success: "You did blocking drills and earned", fail: "The tackling dummy knocked you over. Embarrassing" },
  { success: "You attended team meetings and earned", fail: "Your phone went off in the meeting. $10K fine from coach" },
  { success: "You did conditioning and earned", fail: "You failed the conditioning test. Extra laps tomorrow" },
  { success: "You practiced celebrations and earned", fail: "You pulled a muscle doing your celebration. Injured reserve" },
  { success: "You mentored a rookie and earned", fail: "The rookie outperformed you. Coach noticed" },
  { success: "You did a podcast interview and earned", fail: "You accidentally revealed the playbook. Front office is furious" },
  { success: "You worked on your footwork and earned", fail: "You stepped on a sprinkler head. Ankle is questionable" },
];

export const CURRENCY_EMOJI = "🪙";
export const CURRENCY_NAME = "coins";

// Slots symbols - football themed
export const SLOTS_SYMBOLS = [
  { emoji: "🏈", name: "Football", weight: 25, tier: "common" },
  { emoji: "⚽", name: "Ball", weight: 20, tier: "common" },
  { emoji: "🎯", name: "Target", weight: 15, tier: "common" },
  { emoji: "🏟️", name: "Stadium", weight: 15, tier: "uncommon" },
  { emoji: "⭐", name: "Star", weight: 10, tier: "uncommon" },
  { emoji: "🥇", name: "Gold", weight: 8, tier: "rare" },
  { emoji: "🏆", name: "Trophy", weight: 5, tier: "rare" },
  { emoji: "🎰", name: "Jackpot", weight: 2, tier: "legendary" },
];

// Slots payout multipliers
export const SLOTS_PAYOUTS = {
  tripleJackpot: 100,
  tripleTrophy: 25,
  tripleGold: 10,
  tripleStar: 7,
  tripleStadium: 5,
  tripleCommon: 3,
  twoSpecial: 2,
  twoMatching: 2,
};

// Channel IDs from environment variables
export const CHANNELS = {
  TOWN_SQUARE: process.env.ECONOMY_TOWN_SQUARE_CHANNEL_ID,
  CASINO: process.env.ECONOMY_CASINO_CHANNEL_ID,
};

// Helper function to format currency
export function formatCurrency(amount) {
  return `${CURRENCY_EMOJI} ${amount.toLocaleString()}`;
}

// Helper function to check if cooldown has passed
export function isCooldownOver(lastAction, cooldownMs) {
  if (!lastAction) return true;
  const elapsed = Date.now() - new Date(lastAction).getTime();
  return elapsed >= cooldownMs;
}

// Helper function to get remaining cooldown time as formatted string
export function formatCooldown(lastAction, cooldownMs) {
  if (!lastAction) return null;

  const elapsed = Date.now() - new Date(lastAction).getTime();
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

// Get a random integer between min and max (inclusive)
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Get a random job from the list
export function getRandomJob() {
  return WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
}
