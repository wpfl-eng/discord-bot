// NFLmon Configuration
// Pokemon-style collectible system for NFL players

// ============ RARITIES ============
export const RARITIES = {
  COMMON: {
    id: 'common',
    name: 'Common',
    weight: 50,
    sellValue: 50,
    multiplier: 1.0,
    color: 0x95a5a6,
  },
  UNCOMMON: {
    id: 'uncommon',
    name: 'Uncommon',
    weight: 25,
    sellValue: 100,
    multiplier: 1.1,
    color: 0x2ecc71,
  },
  RARE: {
    id: 'rare',
    name: 'Rare',
    weight: 12,
    sellValue: 250,
    multiplier: 1.2,
    color: 0x3498db,
  },
  EPIC: {
    id: 'epic',
    name: 'Epic',
    weight: 5,
    sellValue: 500,
    multiplier: 1.35,
    color: 0x9b59b6,
  },
  LEGENDARY: {
    id: 'legendary',
    name: 'Legendary',
    weight: 8,
    sellValue: 1000,
    multiplier: 1.5,
    color: 0xffd700,
  },
};

// ============ EVOLUTION STAGES ============
// Config-driven for easy extension (e.g., adding "Legend" tier later)
export const EVOLUTION_STAGES = [
  { id: 'rookie', name: 'Rookie', emoji: '🌱', minLevel: 1 },
  { id: 'pro', name: 'Pro', emoji: '⭐', minLevel: 21 },
  { id: 'all_pro', name: 'All-Pro', emoji: '🌟', minLevel: 41 },
  {
    id: 'hall_of_famer',
    name: 'Hall of Famer',
    emoji: '👑',
    minLevel: 61,
    minRarity: 'rare',
  },
];

// ============ POSITION BASE STATS ============
// 5 stats: Speed, Power, Agility, Awareness, HP
export const POSITION_BASE_STATS = {
  QB: { speed: 60, power: 50, agility: 65, awareness: 80, hp: 70 },
  RB: { speed: 80, power: 70, agility: 75, awareness: 55, hp: 85 },
  WR: { speed: 85, power: 50, agility: 80, awareness: 60, hp: 75 },
  TE: { speed: 65, power: 75, agility: 60, awareness: 65, hp: 90 },
  K: { speed: 40, power: 70, agility: 50, awareness: 90, hp: 60 },
  OL: { speed: 40, power: 90, agility: 45, awareness: 70, hp: 95 },
  DL: { speed: 65, power: 85, agility: 60, awareness: 65, hp: 90 },
  LB: { speed: 70, power: 80, agility: 70, awareness: 75, hp: 88 },
  CB: { speed: 90, power: 55, agility: 85, awareness: 70, hp: 75 },
  S: { speed: 80, power: 65, agility: 75, awareness: 80, hp: 82 },
};

// ============ VARIANTS ============
// Extensibility for future shiny/throwback/gold versions
export const VARIANTS = {
  standard: { name: 'Standard', statBonus: 0 },
  // Future variants (uncomment when implementing):
  // shiny: { name: 'Shiny', statBonus: 5, dropChance: 0.01 },
  // throwback: { name: 'Throwback', statBonus: 0, imageKey: 'throwback' },
  // gold: { name: 'Gold', statBonus: 10, dropChance: 0.001 },
};

// ============ XP SOURCES ============
// XP amounts for training NFLmon (all NFLmon in training receive full XP)
export const XP_SOURCES = {
  wordle_win: { min: 10, max: 20 },
  wordle_first: { min: 25, max: 35 },
  trivia_correct: { min: 5, max: 15 },
  blackjack_win: { min: 3, max: 8 },
};

// ============ DROP CONFIG ============
// Probability of NFLmon dropping from activities
export const DROP_CONFIG = {
  WORDLE_WIN_CHANCE: 0.2, // 20% chance on any wordle win
  WORDLE_FIRST_CHANCE: 1.0, // 100% guaranteed on first solve
  TRIVIA_CORRECT_CHANCE: 0.15, // 15% chance on correct trivia answer
};

// ============ SHOP PACKS ============
export const SHOP_PACKS = {
  starter_pack: { name: 'Starter Pack', price: 500, quantity: 1 },
  pro_pack: { name: 'Pro Pack', price: 1500, quantity: 3 },
  elite_pack: { name: 'Elite Pack', price: 5000, quantity: 5 },
};

// ============ ACQUISITION SOURCES ============
export const ACQUISITION_SOURCES = {
  WORDLE: 'wordle',
  TRIVIA: 'trivia',
  SHOP: 'shop',
  TRADE: 'trade',
};

// ============ TRAINING CONFIG ============
export const TRAINING_CONFIG = {
  DEFAULT_SLOTS: 1,
  MAX_SLOTS: 5,
  SLOT_COST: 3000,
};

// ============ LEVEL CONFIG ============
export const LEVEL_CONFIG = {
  MAX_LEVEL: 100,
  XP_MULTIPLIER: 100, // XP = level^2 * 100
};

// ============ IV CONFIG ============
export const IV_CONFIG = {
  MIN: 0,
  MAX: 15,
};

// ============ HELPER FUNCTIONS ============

/**
 * Generate random integer between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random integer
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate level from total XP
 * Formula: level = floor(sqrt(xp / 100)) + 1, capped at 100
 * @param {number} xp - Total XP
 * @returns {number} Current level (1-100)
 */
export function getLevelFromXp(xp) {
  if (xp < 0) return 1;
  return Math.min(
    LEVEL_CONFIG.MAX_LEVEL,
    Math.floor(Math.sqrt(xp / LEVEL_CONFIG.XP_MULTIPLIER)) + 1
  );
}

/**
 * Calculate XP required to reach a specific level
 * Formula: XP = (level-1)^2 * 100
 * @param {number} level - Target level
 * @returns {number} Total XP needed
 */
export function getXpForLevel(level) {
  if (level <= 1) return 0;
  return (level - 1) * (level - 1) * LEVEL_CONFIG.XP_MULTIPLIER;
}

/**
 * Get XP progress within current level
 * @param {number} currentXp - Current total XP
 * @param {number} currentLevel - Current level
 * @returns {{current: number, needed: number}} Progress towards next level
 */
export function getXpProgress(currentXp, currentLevel) {
  if (currentLevel >= LEVEL_CONFIG.MAX_LEVEL) {
    return { current: 0, needed: 0 };
  }
  const currentLevelXp = getXpForLevel(currentLevel);
  const nextLevelXp = getXpForLevel(currentLevel + 1);
  return {
    current: currentXp - currentLevelXp,
    needed: nextLevelXp - currentLevelXp,
  };
}

/**
 * Calculate a single stat value
 * Formula: floor((baseStat + IV) * (1 + level * 0.01) * rarityMultiplier)
 * @param {number} baseStat - Base stat for position
 * @param {number} iv - Individual value (0-15)
 * @param {number} level - Current level
 * @param {number} rarityMultiplier - Rarity stat multiplier
 * @returns {number} Final stat value
 */
export function calculateStat(baseStat, iv, level, rarityMultiplier) {
  return Math.floor((baseStat + iv) * (1 + level * 0.01) * rarityMultiplier);
}

/**
 * Calculate all stats for an NFLmon
 * @param {string} position - Player position (QB, RB, WR, etc.)
 * @param {{speed: number, power: number, agility: number, awareness: number, hp: number}} ivs - IVs
 * @param {number} level - Current level
 * @param {string} rarityId - Rarity ID (common, uncommon, rare, epic, legendary)
 * @returns {{speed: number, power: number, agility: number, awareness: number, hp: number}} Final stats
 */
export function calculateAllStats(position, ivs, level, rarityId) {
  const baseStats = POSITION_BASE_STATS[position];
  if (!baseStats) {
    throw new Error(`Unknown position: ${position}`);
  }

  const rarity = getRarityById(rarityId);
  if (!rarity) {
    throw new Error(`Unknown rarity: ${rarityId}`);
  }

  const multiplier = rarity.multiplier;

  return {
    speed: calculateStat(baseStats.speed, ivs.speed, level, multiplier),
    power: calculateStat(baseStats.power, ivs.power, level, multiplier),
    agility: calculateStat(baseStats.agility, ivs.agility, level, multiplier),
    awareness: calculateStat(baseStats.awareness, ivs.awareness, level, multiplier),
    hp: calculateStat(baseStats.hp, ivs.hp, level, multiplier),
  };
}

/**
 * Generate random IVs for a new NFLmon
 * @returns {{speed: number, power: number, agility: number, awareness: number, hp: number}} Random IVs (0-15 each)
 */
export function generateIVs() {
  return {
    speed: randomInt(IV_CONFIG.MIN, IV_CONFIG.MAX),
    power: randomInt(IV_CONFIG.MIN, IV_CONFIG.MAX),
    agility: randomInt(IV_CONFIG.MIN, IV_CONFIG.MAX),
    awareness: randomInt(IV_CONFIG.MIN, IV_CONFIG.MAX),
    hp: randomInt(IV_CONFIG.MIN, IV_CONFIG.MAX),
  };
}

/**
 * Calculate total IV sum (for display purposes)
 * @param {{speed: number, power: number, agility: number, awareness: number, hp: number}} ivs - IVs
 * @returns {number} Total IV sum (0-75)
 */
export function getTotalIVs(ivs) {
  return ivs.speed + ivs.power + ivs.agility + ivs.awareness + ivs.hp;
}

/**
 * Get rarity object by ID
 * @param {string} rarityId - Rarity ID (common, uncommon, rare, epic, legendary)
 * @returns {object|null} Rarity object or null
 */
export function getRarityById(rarityId) {
  return Object.values(RARITIES).find((r) => r.id === rarityId.toLowerCase()) || null;
}

/**
 * Get embed color for a rarity
 * @param {string} rarityId - Rarity ID
 * @returns {number} Discord embed color
 */
export function getRarityColor(rarityId) {
  const rarity = getRarityById(rarityId);
  return rarity ? rarity.color : RARITIES.COMMON.color;
}

/**
 * Get sell value for a rarity
 * @param {string} rarityId - Rarity ID
 * @returns {number} Sell value in coins
 */
export function getSellValue(rarityId) {
  const rarity = getRarityById(rarityId);
  return rarity ? rarity.sellValue : RARITIES.COMMON.sellValue;
}

/**
 * Get the rarity order index (for sorting)
 * @param {string} rarityId - Rarity ID
 * @returns {number} Order index (0-4, higher = rarer)
 */
export function getRarityOrder(rarityId) {
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  return order.indexOf(rarityId.toLowerCase());
}

/**
 * Get evolution stage for given level and rarity
 * @param {number} level - Current level
 * @param {string} rarityId - Current rarity ID
 * @returns {object} Evolution stage object
 */
export function getEvolutionStage(level, rarityId) {
  const rarityOrder = getRarityOrder(rarityId);

  // Find the highest stage the NFLmon qualifies for
  for (let i = EVOLUTION_STAGES.length - 1; i >= 0; i--) {
    const stage = EVOLUTION_STAGES[i];

    // Check level requirement
    if (level < stage.minLevel) continue;

    // Check rarity requirement if present
    if (stage.minRarity) {
      const requiredRarityOrder = getRarityOrder(stage.minRarity);
      if (rarityOrder < requiredRarityOrder) continue;
    }

    return stage;
  }

  // Default to rookie
  return EVOLUTION_STAGES[0];
}

/**
 * Get the next evolution stage (if any)
 * @param {string} currentStageId - Current stage ID
 * @returns {object|null} Next stage or null if at max
 */
export function getNextEvolutionStage(currentStageId) {
  const currentIndex = EVOLUTION_STAGES.findIndex((s) => s.id === currentStageId);
  if (currentIndex === -1 || currentIndex >= EVOLUTION_STAGES.length - 1) {
    return null;
  }
  return EVOLUTION_STAGES[currentIndex + 1];
}

/**
 * Check if an NFLmon can evolve to the next stage
 * @param {string} currentStageId - Current stage ID
 * @param {number} level - Current level
 * @param {string} rarityId - Current rarity ID
 * @returns {{canEvolve: boolean, nextStage: object|null, reason: string|null}} Evolution check result
 */
export function canEvolve(currentStageId, level, rarityId) {
  const nextStage = getNextEvolutionStage(currentStageId);

  if (!nextStage) {
    return {
      canEvolve: false,
      nextStage: null,
      reason: 'Already at maximum evolution',
    };
  }

  // Check level requirement
  if (level < nextStage.minLevel) {
    return {
      canEvolve: false,
      nextStage,
      reason: `Requires level ${nextStage.minLevel} (current: ${level})`,
    };
  }

  // Check rarity requirement
  if (nextStage.minRarity) {
    const currentRarityOrder = getRarityOrder(rarityId);
    const requiredRarityOrder = getRarityOrder(nextStage.minRarity);

    if (currentRarityOrder < requiredRarityOrder) {
      return {
        canEvolve: false,
        nextStage,
        reason: `Requires ${nextStage.minRarity} rarity or higher`,
      };
    }
  }

  return { canEvolve: true, nextStage, reason: null };
}

/**
 * Get random XP amount for a source
 * @param {string} source - XP source (wordle_win, wordle_first, trivia_correct, blackjack_win)
 * @returns {number} Random XP amount
 */
export function getRandomXp(source) {
  const xpRange = XP_SOURCES[source];
  if (!xpRange) {
    console.warn(`Unknown XP source: ${source}`);
    return 0;
  }
  return randomInt(xpRange.min, xpRange.max);
}

/**
 * Format rarity name with color for display
 * @param {string} rarityId - Rarity ID
 * @returns {string} Formatted rarity name
 */
export function formatRarity(rarityId) {
  const rarity = getRarityById(rarityId);
  return rarity ? rarity.name : 'Unknown';
}

/**
 * Get evolution emoji for display
 * @param {string} stageId - Evolution stage ID
 * @returns {string} Emoji
 */
export function getEvolutionEmoji(stageId) {
  const stage = EVOLUTION_STAGES.find((s) => s.id === stageId);
  return stage ? stage.emoji : '🌱';
}

/**
 * Check if level is at max
 * @param {number} level - Current level
 * @returns {boolean} True if at max level
 */
export function isMaxLevel(level) {
  return level >= LEVEL_CONFIG.MAX_LEVEL;
}
