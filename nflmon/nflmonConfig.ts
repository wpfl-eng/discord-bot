// NFLmon Configuration
// Pokemon-style collectible system for NFL players

// ============ TYPE DEFINITIONS ============

export type RarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type EvolutionStageId = 'rookie' | 'pro' | 'all_pro' | 'hall_of_famer';
export type PositionId = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'OL' | 'DL' | 'LB' | 'CB' | 'S';
export type XpSourceId = 'wordle_win' | 'wordle_first' | 'trivia_correct' | 'blackjack_win';
export type AcquisitionSource = 'wordle' | 'trivia' | 'shop' | 'trade';
export type ShopPackId = 'starter_pack' | 'pro_pack' | 'elite_pack';

export interface Rarity {
  readonly id: RarityId;
  readonly name: string;
  readonly weight: number;
  readonly sellValue: number;
  readonly multiplier: number;
  readonly color: number;
}

export interface EvolutionStage {
  readonly id: EvolutionStageId;
  readonly name: string;
  readonly emoji: string;
  readonly minLevel: number;
  readonly minRarity?: RarityId;
}

export interface BaseStats {
  readonly speed: number;
  readonly power: number;
  readonly agility: number;
  readonly awareness: number;
  readonly hp: number;
}

export interface IVs {
  speed: number;
  power: number;
  agility: number;
  awareness: number;
  hp: number;
}

export interface Stats {
  speed: number;
  power: number;
  agility: number;
  awareness: number;
  hp: number;
}

export interface Variant {
  readonly name: string;
  readonly statBonus: number;
}

export interface XpRange {
  readonly min: number;
  readonly max: number;
}

export interface ShopPack {
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
}

export interface CanEvolveResult {
  canEvolve: boolean;
  nextStage: EvolutionStage | null;
  reason: string | null;
}

export interface XpProgress {
  current: number;
  needed: number;
}

// ============ RARITIES ============
export const RARITIES: Record<Uppercase<RarityId>, Rarity> = {
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
} as const;

// ============ EVOLUTION STAGES ============
// Config-driven for easy extension (e.g., adding "Legend" tier later)
export const EVOLUTION_STAGES: readonly EvolutionStage[] = [
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
] as const;

// ============ POSITION BASE STATS ============
// 5 stats: Speed, Power, Agility, Awareness, HP
export const POSITION_BASE_STATS: Record<PositionId, BaseStats> = {
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
} as const;

// ============ VARIANTS ============
// Extensibility for future shiny/throwback/gold versions
export const VARIANTS: Record<string, Variant> = {
  standard: { name: 'Standard', statBonus: 0 },
  // Future variants (uncomment when implementing):
  // shiny: { name: 'Shiny', statBonus: 5, dropChance: 0.01 },
  // throwback: { name: 'Throwback', statBonus: 0, imageKey: 'throwback' },
  // gold: { name: 'Gold', statBonus: 10, dropChance: 0.001 },
} as const;

// ============ XP SOURCES ============
// XP amounts for training NFLmon (all NFLmon in training receive full XP)
export const XP_SOURCES: Record<XpSourceId, XpRange> = {
  wordle_win: { min: 10, max: 20 },
  wordle_first: { min: 25, max: 35 },
  trivia_correct: { min: 5, max: 15 },
  blackjack_win: { min: 3, max: 8 },
} as const;

// ============ DROP CONFIG ============
// Probability of NFLmon dropping from activities
export const DROP_CONFIG = {
  WORDLE_WIN_CHANCE: 0.2, // 20% chance on any wordle win
  WORDLE_FIRST_CHANCE: 1.0, // 100% guaranteed on first solve
  TRIVIA_CORRECT_CHANCE: 0.15, // 15% chance on correct trivia answer
} as const;

// ============ SHOP PACKS ============
export const SHOP_PACKS: Record<ShopPackId, ShopPack> = {
  starter_pack: { name: 'Starter Pack', price: 500, quantity: 1 },
  pro_pack: { name: 'Pro Pack', price: 1500, quantity: 3 },
  elite_pack: { name: 'Elite Pack', price: 5000, quantity: 5 },
} as const;

// ============ ACQUISITION SOURCES ============
export const ACQUISITION_SOURCES = {
  WORDLE: 'wordle' as AcquisitionSource,
  TRIVIA: 'trivia' as AcquisitionSource,
  SHOP: 'shop' as AcquisitionSource,
  TRADE: 'trade' as AcquisitionSource,
} as const;

// ============ TRAINING CONFIG ============
export const TRAINING_CONFIG = {
  DEFAULT_SLOTS: 1,
  MAX_SLOTS: 5,
  SLOT_COST: 3000,
} as const;

// ============ LEVEL CONFIG ============
export const LEVEL_CONFIG = {
  MAX_LEVEL: 100,
  XP_MULTIPLIER: 100, // XP = level^2 * 100
} as const;

// ============ IV CONFIG ============
export const IV_CONFIG = {
  MIN: 0,
  MAX: 15,
} as const;

// ============ HELPER FUNCTIONS ============

/**
 * Generate random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate level from total XP
 * Formula: level = floor(sqrt(xp / 100)) + 1, capped at 100
 */
export function getLevelFromXp(xp: number): number {
  if (xp < 0) return 1;
  return Math.min(
    LEVEL_CONFIG.MAX_LEVEL,
    Math.floor(Math.sqrt(xp / LEVEL_CONFIG.XP_MULTIPLIER)) + 1
  );
}

/**
 * Calculate XP required to reach a specific level
 * Formula: XP = (level-1)^2 * 100
 */
export function getXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return (level - 1) * (level - 1) * LEVEL_CONFIG.XP_MULTIPLIER;
}

/**
 * Get XP progress within current level
 */
export function getXpProgress(currentXp: number, currentLevel: number): XpProgress {
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
 */
export function calculateStat(
  baseStat: number,
  iv: number,
  level: number,
  rarityMultiplier: number
): number {
  return Math.floor((baseStat + iv) * (1 + level * 0.01) * rarityMultiplier);
}

/**
 * Calculate all stats for an NFLmon
 */
export function calculateAllStats(
  position: string,
  ivs: IVs,
  level: number,
  rarityId: string
): Stats {
  const baseStats = POSITION_BASE_STATS[position as PositionId];
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
 */
export function generateIVs(): IVs {
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
 */
export function getTotalIVs(ivs: IVs): number {
  return ivs.speed + ivs.power + ivs.agility + ivs.awareness + ivs.hp;
}

/**
 * Get rarity object by ID
 * Returns null for invalid or missing rarityId
 */
export function getRarityById(rarityId: string | null | undefined): Rarity | null {
  if (!rarityId || typeof rarityId !== 'string') {
    return null;
  }
  return Object.values(RARITIES).find((r) => r.id === rarityId.toLowerCase()) || null;
}

/**
 * Get embed color for a rarity
 */
export function getRarityColor(rarityId: string): number {
  const rarity = getRarityById(rarityId);
  return rarity ? rarity.color : RARITIES.COMMON.color;
}

/**
 * Get sell value for a rarity
 */
export function getSellValue(rarityId: string): number {
  const rarity = getRarityById(rarityId);
  return rarity ? rarity.sellValue : RARITIES.COMMON.sellValue;
}

/**
 * Get the rarity order index (for sorting)
 * Returns -1 for unknown rarities
 */
export function getRarityOrder(rarityId: string | null | undefined): number {
  if (!rarityId || typeof rarityId !== 'string') {
    return -1;
  }
  const order: readonly RarityId[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  return order.indexOf(rarityId.toLowerCase() as RarityId);
}

/**
 * Get evolution stage for given level and rarity
 */
export function getEvolutionStage(level: number, rarityId: string): EvolutionStage {
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
 */
export function getNextEvolutionStage(currentStageId: string): EvolutionStage | null {
  const currentIndex = EVOLUTION_STAGES.findIndex((s) => s.id === currentStageId);
  if (currentIndex === -1 || currentIndex >= EVOLUTION_STAGES.length - 1) {
    return null;
  }
  return EVOLUTION_STAGES[currentIndex + 1];
}

/**
 * Check if an NFLmon can evolve to the next stage
 */
export function canEvolve(
  currentStageId: string,
  level: number,
  rarityId: string
): CanEvolveResult {
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
 */
export function getRandomXp(source: string): number {
  const xpRange = XP_SOURCES[source as XpSourceId];
  if (!xpRange) {
    console.warn(`Unknown XP source: ${source}`);
    return 0;
  }
  return randomInt(xpRange.min, xpRange.max);
}

/**
 * Format rarity name with color for display
 */
export function formatRarity(rarityId: string): string {
  const rarity = getRarityById(rarityId);
  return rarity ? rarity.name : 'Unknown';
}

/**
 * Get evolution emoji for display
 */
export function getEvolutionEmoji(stageId: string): string {
  const stage = EVOLUTION_STAGES.find((s) => s.id === stageId);
  return stage ? stage.emoji : '🌱';
}

/**
 * Check if level is at max
 */
export function isMaxLevel(level: number): boolean {
  return level >= LEVEL_CONFIG.MAX_LEVEL;
}
