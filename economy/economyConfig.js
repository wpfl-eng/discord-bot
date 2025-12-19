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
  { success: "You worked as a barista and earned", fail: "You spilled coffee on a customer and got fired" },
  { success: "You mowed lawns in the neighborhood and earned", fail: "You ran over a sprinkler head and had to pay for repairs" },
  { success: "You walked dogs at the park and earned", fail: "The dogs walked you instead. No pay today" },
  { success: "You delivered pizzas and earned", fail: "You ate all the pizzas. You're fired" },
  { success: "You worked as a cashier and earned", fail: "Your register came up short. No pay" },
  { success: "You did some freelance coding and earned", fail: "Your code had bugs. Client refused to pay" },
  { success: "You helped someone move furniture and earned", fail: "You dropped their TV. You owe them money now" },
  { success: "You washed cars and earned", fail: "You scratched someone's paint job. Oops" },
  { success: "You tutored a student and earned", fail: "Your student failed their test. No referrals for you" },
  { success: "You worked as a server and earned", fail: "You spilled soup on a customer. Tips? None" },
  { success: "You did yard work and earned", fail: "You mowed over their flower garden. No payment" },
  { success: "You babysat for a family and earned", fail: "The kid drew on the walls. You paid for the damage" },
  { success: "You drove for a rideshare and earned", fail: "You got lost and the passenger demanded a refund" },
  { success: "You sold lemonade and earned", fail: "Nobody wanted lemonade today. You drank it all" },
  { success: "You did data entry work and earned", fail: "You fell asleep and missed the deadline" },
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
