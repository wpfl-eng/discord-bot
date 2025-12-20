import { describe, test, expect } from '@jest/globals';
import {
  RARITIES,
  EVOLUTION_STAGES,
  POSITION_BASE_STATS,
  VARIANTS,
  XP_SOURCES,
  DROP_CONFIG,
  SHOP_PACKS,
  ACQUISITION_SOURCES,
  TRAINING_CONFIG,
  LEVEL_CONFIG,
  IV_CONFIG,
  randomInt,
  getLevelFromXp,
  getXpForLevel,
  getXpProgress,
  calculateStat,
  calculateAllStats,
  generateIVs,
  getTotalIVs,
  getRarityById,
  getRarityColor,
  getSellValue,
  getRarityOrder,
  getEvolutionStage,
  getNextEvolutionStage,
  canEvolve,
  getRandomXp,
  formatRarity,
  getEvolutionEmoji,
  isMaxLevel,
} from '../../nflmon/nflmonConfig.js';

describe('nflmonConfig', () => {
  // ============ CONSTANTS TESTS ============

  describe('RARITIES', () => {
    test('has all expected rarity tiers', () => {
      expect(RARITIES.COMMON).toBeDefined();
      expect(RARITIES.UNCOMMON).toBeDefined();
      expect(RARITIES.RARE).toBeDefined();
      expect(RARITIES.EPIC).toBeDefined();
      expect(RARITIES.LEGENDARY).toBeDefined();
    });

    test('each rarity has required properties', () => {
      Object.values(RARITIES).forEach((rarity) => {
        expect(typeof rarity.id).toBe('string');
        expect(typeof rarity.name).toBe('string');
        expect(typeof rarity.weight).toBe('number');
        expect(typeof rarity.sellValue).toBe('number');
        expect(typeof rarity.multiplier).toBe('number');
        expect(typeof rarity.color).toBe('number');
      });
    });

    test('weights sum to 100', () => {
      const totalWeight = Object.values(RARITIES).reduce((sum, r) => sum + r.weight, 0);
      expect(totalWeight).toBe(100);
    });

    test('multipliers increase with rarity', () => {
      expect(RARITIES.UNCOMMON.multiplier).toBeGreaterThan(RARITIES.COMMON.multiplier);
      expect(RARITIES.RARE.multiplier).toBeGreaterThan(RARITIES.UNCOMMON.multiplier);
      expect(RARITIES.EPIC.multiplier).toBeGreaterThan(RARITIES.RARE.multiplier);
      expect(RARITIES.LEGENDARY.multiplier).toBeGreaterThan(RARITIES.EPIC.multiplier);
    });
  });

  describe('EVOLUTION_STAGES', () => {
    test('is an array with 4 stages', () => {
      expect(Array.isArray(EVOLUTION_STAGES)).toBe(true);
      expect(EVOLUTION_STAGES).toHaveLength(4);
    });

    test('each stage has required properties', () => {
      EVOLUTION_STAGES.forEach((stage) => {
        expect(typeof stage.id).toBe('string');
        expect(typeof stage.name).toBe('string');
        expect(typeof stage.emoji).toBe('string');
        expect(typeof stage.minLevel).toBe('number');
      });
    });

    test('stages are ordered by minLevel', () => {
      for (let i = 1; i < EVOLUTION_STAGES.length; i++) {
        expect(EVOLUTION_STAGES[i].minLevel).toBeGreaterThan(EVOLUTION_STAGES[i - 1].minLevel);
      }
    });

    test('hall_of_famer has minRarity requirement', () => {
      const hofStage = EVOLUTION_STAGES.find((s) => s.id === 'hall_of_famer');
      expect(hofStage).toBeDefined();
      expect(hofStage?.minRarity).toBe('rare');
    });
  });

  describe('POSITION_BASE_STATS', () => {
    test('has all NFL positions', () => {
      const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'OL', 'DL', 'LB', 'CB', 'S'];
      positions.forEach((pos) => {
        expect(POSITION_BASE_STATS[pos as keyof typeof POSITION_BASE_STATS]).toBeDefined();
      });
    });

    test('each position has 5 stat categories', () => {
      const statNames = ['speed', 'power', 'agility', 'awareness', 'hp'];
      Object.values(POSITION_BASE_STATS).forEach((stats) => {
        statNames.forEach((stat) => {
          expect(typeof stats[stat as keyof typeof stats]).toBe('number');
          expect(stats[stat as keyof typeof stats]).toBeGreaterThan(0);
          expect(stats[stat as keyof typeof stats]).toBeLessThanOrEqual(100);
        });
      });
    });
  });

  describe('LEVEL_CONFIG', () => {
    test('has MAX_LEVEL of 100', () => {
      expect(LEVEL_CONFIG.MAX_LEVEL).toBe(100);
    });

    test('has XP_MULTIPLIER of 100', () => {
      expect(LEVEL_CONFIG.XP_MULTIPLIER).toBe(100);
    });
  });

  describe('IV_CONFIG', () => {
    test('has MIN of 0 and MAX of 15', () => {
      expect(IV_CONFIG.MIN).toBe(0);
      expect(IV_CONFIG.MAX).toBe(15);
    });
  });

  // ============ FUNCTION TESTS ============

  describe('randomInt', () => {
    test('returns value within range', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomInt(1, 10);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    test('returns integer values', () => {
      for (let i = 0; i < 50; i++) {
        const result = randomInt(1, 100);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    test('handles min === max', () => {
      expect(randomInt(5, 5)).toBe(5);
    });

    test('handles negative ranges', () => {
      for (let i = 0; i < 50; i++) {
        const result = randomInt(-10, -1);
        expect(result).toBeGreaterThanOrEqual(-10);
        expect(result).toBeLessThanOrEqual(-1);
      }
    });
  });

  describe('getLevelFromXp', () => {
    test('returns level 1 for 0 XP', () => {
      expect(getLevelFromXp(0)).toBe(1);
    });

    test('returns level 1 for negative XP', () => {
      expect(getLevelFromXp(-100)).toBe(1);
    });

    test('calculates correct level for known XP values', () => {
      // Level 2: XP >= 100 (level-1)^2 * 100 = 1^2 * 100 = 100
      expect(getLevelFromXp(100)).toBe(2);
      // Level 10: XP >= 8100 (9^2 * 100)
      expect(getLevelFromXp(8100)).toBe(10);
      // Level 11: XP >= 10000
      expect(getLevelFromXp(10000)).toBe(11);
    });

    test('caps at MAX_LEVEL (100)', () => {
      expect(getLevelFromXp(1000000)).toBe(100);
      expect(getLevelFromXp(999999999)).toBe(100);
    });
  });

  describe('getXpForLevel', () => {
    test('returns 0 XP for level 1', () => {
      expect(getXpForLevel(1)).toBe(0);
    });

    test('returns 0 XP for level <= 1', () => {
      expect(getXpForLevel(0)).toBe(0);
      expect(getXpForLevel(-5)).toBe(0);
    });

    test('calculates correct XP for known levels', () => {
      // Level 2: (2-1)^2 * 100 = 100
      expect(getXpForLevel(2)).toBe(100);
      // Level 10: (10-1)^2 * 100 = 8100
      expect(getXpForLevel(10)).toBe(8100);
      // Level 50: (50-1)^2 * 100 = 240100
      expect(getXpForLevel(50)).toBe(240100);
    });
  });

  describe('getXpProgress', () => {
    test('returns zeros at max level', () => {
      const result = getXpProgress(1000000, 100);
      expect(result).toEqual({ current: 0, needed: 0 });
    });

    test('calculates progress correctly at level 1', () => {
      // At level 1, current XP 50, next level at 100
      const result = getXpProgress(50, 1);
      expect(result.current).toBe(50);
      expect(result.needed).toBe(100);
    });

    test('calculates progress correctly at higher levels', () => {
      // At level 10 (XP 8100), with 8500 XP, next level at 10000
      const result = getXpProgress(8500, 10);
      expect(result.current).toBe(400); // 8500 - 8100
      expect(result.needed).toBe(1900); // 10000 - 8100
    });
  });

  describe('calculateStat', () => {
    test('calculates stat correctly at level 1', () => {
      // (baseStat + IV) * (1 + level * 0.01) * multiplier
      // (60 + 10) * (1 + 1 * 0.01) * 1.0 = 70 * 1.01 * 1.0 = 70.7 -> 70
      const result = calculateStat(60, 10, 1, 1.0);
      expect(result).toBe(70);
    });

    test('calculates stat correctly at level 50', () => {
      // (60 + 10) * (1 + 50 * 0.01) * 1.0 = 70 * 1.5 * 1.0 = 105
      const result = calculateStat(60, 10, 50, 1.0);
      expect(result).toBe(105);
    });

    test('applies rarity multiplier correctly', () => {
      // (60 + 10) * (1 + 1 * 0.01) * 1.5 = 70 * 1.01 * 1.5 = 106.05 -> 106
      const result = calculateStat(60, 10, 1, 1.5);
      expect(result).toBe(106);
    });

    test('returns integer value (floors result)', () => {
      const result = calculateStat(60, 10, 1, 1.0);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('calculateAllStats', () => {
    const testIVs = { speed: 10, power: 10, agility: 10, awareness: 10, hp: 10 };

    test('returns all 5 stats', () => {
      const stats = calculateAllStats('QB', testIVs, 1, 'common');
      expect(stats).toHaveProperty('speed');
      expect(stats).toHaveProperty('power');
      expect(stats).toHaveProperty('agility');
      expect(stats).toHaveProperty('awareness');
      expect(stats).toHaveProperty('hp');
    });

    test('throws for unknown position', () => {
      expect(() => calculateAllStats('INVALID', testIVs, 1, 'common')).toThrow(
        'Unknown position: INVALID'
      );
    });

    test('throws for unknown rarity', () => {
      expect(() => calculateAllStats('QB', testIVs, 1, 'mythic')).toThrow('Unknown rarity: mythic');
    });

    test('calculates QB stats correctly at level 1 common', () => {
      const stats = calculateAllStats('QB', testIVs, 1, 'common');
      // QB base: speed: 60, power: 50, agility: 65, awareness: 80, hp: 70
      // All IVs are 10, level 1, common multiplier 1.0
      // Formula: floor((base + IV) * 1.01 * 1.0)
      expect(stats.speed).toBe(70); // floor(70 * 1.01) = 70
      expect(stats.power).toBe(60); // floor(60 * 1.01) = 60
      expect(stats.agility).toBe(75); // floor(75 * 1.01) = 75
      expect(stats.awareness).toBe(90); // floor(90 * 1.01) = 90
      expect(stats.hp).toBe(80); // floor(80 * 1.01) = 80
    });

    test('legendary rarity increases stats', () => {
      const commonStats = calculateAllStats('QB', testIVs, 1, 'common');
      const legendaryStats = calculateAllStats('QB', testIVs, 1, 'legendary');

      expect(legendaryStats.speed).toBeGreaterThan(commonStats.speed);
      expect(legendaryStats.power).toBeGreaterThan(commonStats.power);
    });
  });

  describe('generateIVs', () => {
    test('generates all 5 IV types', () => {
      const ivs = generateIVs();
      expect(ivs).toHaveProperty('speed');
      expect(ivs).toHaveProperty('power');
      expect(ivs).toHaveProperty('agility');
      expect(ivs).toHaveProperty('awareness');
      expect(ivs).toHaveProperty('hp');
    });

    test('generates IVs within 0-15 range', () => {
      for (let i = 0; i < 50; i++) {
        const ivs = generateIVs();
        Object.values(ivs).forEach((iv) => {
          expect(iv).toBeGreaterThanOrEqual(0);
          expect(iv).toBeLessThanOrEqual(15);
        });
      }
    });

    test('generates integer values', () => {
      const ivs = generateIVs();
      Object.values(ivs).forEach((iv) => {
        expect(Number.isInteger(iv)).toBe(true);
      });
    });
  });

  describe('getTotalIVs', () => {
    test('sums all IVs correctly', () => {
      const ivs = { speed: 10, power: 10, agility: 10, awareness: 10, hp: 10 };
      expect(getTotalIVs(ivs)).toBe(50);
    });

    test('handles max IVs', () => {
      const maxIVs = { speed: 15, power: 15, agility: 15, awareness: 15, hp: 15 };
      expect(getTotalIVs(maxIVs)).toBe(75);
    });

    test('handles min IVs', () => {
      const minIVs = { speed: 0, power: 0, agility: 0, awareness: 0, hp: 0 };
      expect(getTotalIVs(minIVs)).toBe(0);
    });
  });

  describe('getRarityById', () => {
    test('returns rarity for valid ID', () => {
      const rarity = getRarityById('common');
      expect(rarity).not.toBeNull();
      expect(rarity?.name).toBe('Common');
    });

    test('handles case insensitivity', () => {
      expect(getRarityById('COMMON')?.id).toBe('common');
      expect(getRarityById('Common')?.id).toBe('common');
      expect(getRarityById('cOmMoN')?.id).toBe('common');
    });

    test('returns null for unknown ID', () => {
      expect(getRarityById('mythic')).toBeNull();
      expect(getRarityById('invalid')).toBeNull();
    });

    test('handles null/undefined input gracefully', () => {
      // Bug fix: now returns null instead of throwing
      expect(getRarityById(null as unknown as string)).toBeNull();
      expect(getRarityById(undefined as unknown as string)).toBeNull();
      expect(getRarityById('')).toBeNull();
    });
  });

  describe('getRarityColor', () => {
    test('returns correct color for valid rarity', () => {
      expect(getRarityColor('common')).toBe(0x95a5a6);
      expect(getRarityColor('legendary')).toBe(0xffd700);
    });

    test('returns common color for unknown rarity', () => {
      expect(getRarityColor('invalid')).toBe(0x95a5a6);
    });
  });

  describe('getSellValue', () => {
    test('returns correct sell value for valid rarity', () => {
      expect(getSellValue('common')).toBe(50);
      expect(getSellValue('legendary')).toBe(1000);
    });

    test('returns common sell value for unknown rarity', () => {
      expect(getSellValue('invalid')).toBe(50);
    });
  });

  describe('getRarityOrder', () => {
    test('returns correct order for all rarities', () => {
      expect(getRarityOrder('common')).toBe(0);
      expect(getRarityOrder('uncommon')).toBe(1);
      expect(getRarityOrder('rare')).toBe(2);
      expect(getRarityOrder('epic')).toBe(3);
      expect(getRarityOrder('legendary')).toBe(4);
    });

    test('handles case insensitivity', () => {
      expect(getRarityOrder('LEGENDARY')).toBe(4);
    });

    test('returns -1 for unknown rarity', () => {
      expect(getRarityOrder('mythic')).toBe(-1);
    });

    test('handles null/undefined input gracefully', () => {
      // Bug fix: now returns -1 instead of throwing
      expect(getRarityOrder(null as unknown as string)).toBe(-1);
      expect(getRarityOrder(undefined as unknown as string)).toBe(-1);
      expect(getRarityOrder('')).toBe(-1);
    });
  });

  describe('getEvolutionStage', () => {
    test('returns rookie for level 1', () => {
      const stage = getEvolutionStage(1, 'common');
      expect(stage.id).toBe('rookie');
    });

    test('returns pro for level 21+', () => {
      const stage = getEvolutionStage(21, 'common');
      expect(stage.id).toBe('pro');
    });

    test('returns all_pro for level 41+', () => {
      const stage = getEvolutionStage(41, 'common');
      expect(stage.id).toBe('all_pro');
    });

    test('returns hall_of_famer for level 61+ with rare rarity', () => {
      const stage = getEvolutionStage(61, 'rare');
      expect(stage.id).toBe('hall_of_famer');
    });

    test('returns all_pro for level 61+ common (rarity too low)', () => {
      const stage = getEvolutionStage(61, 'common');
      expect(stage.id).toBe('all_pro');
    });

    test('returns hall_of_famer for level 61+ epic', () => {
      const stage = getEvolutionStage(61, 'epic');
      expect(stage.id).toBe('hall_of_famer');
    });

    test('returns hall_of_famer for level 61+ legendary', () => {
      const stage = getEvolutionStage(61, 'legendary');
      expect(stage.id).toBe('hall_of_famer');
    });
  });

  describe('getNextEvolutionStage', () => {
    test('returns pro from rookie', () => {
      const next = getNextEvolutionStage('rookie');
      expect(next?.id).toBe('pro');
    });

    test('returns all_pro from pro', () => {
      const next = getNextEvolutionStage('pro');
      expect(next?.id).toBe('all_pro');
    });

    test('returns hall_of_famer from all_pro', () => {
      const next = getNextEvolutionStage('all_pro');
      expect(next?.id).toBe('hall_of_famer');
    });

    test('returns null at max stage (hall_of_famer)', () => {
      expect(getNextEvolutionStage('hall_of_famer')).toBeNull();
    });

    test('returns null for unknown stage', () => {
      expect(getNextEvolutionStage('invalid')).toBeNull();
    });
  });

  describe('canEvolve', () => {
    test('cannot evolve from hall_of_famer', () => {
      const result = canEvolve('hall_of_famer', 100, 'legendary');
      expect(result.canEvolve).toBe(false);
      expect(result.reason).toBe('Already at maximum evolution');
      expect(result.nextStage).toBeNull();
    });

    test('can evolve from rookie to pro at level 21', () => {
      const result = canEvolve('rookie', 21, 'common');
      expect(result.canEvolve).toBe(true);
      expect(result.nextStage?.id).toBe('pro');
    });

    test('cannot evolve from rookie to pro at level 20', () => {
      const result = canEvolve('rookie', 20, 'common');
      expect(result.canEvolve).toBe(false);
      expect(result.reason).toContain('Requires level 21');
    });

    test('cannot evolve to hall_of_famer with common rarity', () => {
      const result = canEvolve('all_pro', 61, 'common');
      expect(result.canEvolve).toBe(false);
      expect(result.reason).toContain('Requires rare rarity');
    });

    test('can evolve to hall_of_famer with rare rarity at level 61', () => {
      const result = canEvolve('all_pro', 61, 'rare');
      expect(result.canEvolve).toBe(true);
    });
  });

  describe('getRandomXp', () => {
    test('returns XP within range for wordle_win', () => {
      for (let i = 0; i < 50; i++) {
        const xp = getRandomXp('wordle_win');
        expect(xp).toBeGreaterThanOrEqual(10);
        expect(xp).toBeLessThanOrEqual(20);
      }
    });

    test('returns XP within range for wordle_first', () => {
      for (let i = 0; i < 50; i++) {
        const xp = getRandomXp('wordle_first');
        expect(xp).toBeGreaterThanOrEqual(25);
        expect(xp).toBeLessThanOrEqual(35);
      }
    });

    test('returns 0 for unknown source', () => {
      expect(getRandomXp('invalid_source')).toBe(0);
    });
  });

  describe('formatRarity', () => {
    test('returns correct name for valid rarity', () => {
      expect(formatRarity('common')).toBe('Common');
      expect(formatRarity('legendary')).toBe('Legendary');
    });

    test('handles case insensitivity', () => {
      expect(formatRarity('LEGENDARY')).toBe('Legendary');
    });

    test('returns Unknown for invalid rarity', () => {
      expect(formatRarity('mythic')).toBe('Unknown');
    });
  });

  describe('getEvolutionEmoji', () => {
    test('returns correct emoji for each stage', () => {
      expect(getEvolutionEmoji('rookie')).toBe('🌱');
      expect(getEvolutionEmoji('pro')).toBe('⭐');
      expect(getEvolutionEmoji('all_pro')).toBe('🌟');
      expect(getEvolutionEmoji('hall_of_famer')).toBe('👑');
    });

    test('returns default emoji for unknown stage', () => {
      expect(getEvolutionEmoji('invalid')).toBe('🌱');
    });
  });

  describe('isMaxLevel', () => {
    test('returns true at max level (100)', () => {
      expect(isMaxLevel(100)).toBe(true);
    });

    test('returns true above max level', () => {
      expect(isMaxLevel(101)).toBe(true);
      expect(isMaxLevel(200)).toBe(true);
    });

    test('returns false below max level', () => {
      expect(isMaxLevel(99)).toBe(false);
      expect(isMaxLevel(50)).toBe(false);
      expect(isMaxLevel(1)).toBe(false);
    });
  });

  // ============ OTHER CONSTANTS TESTS ============

  describe('XP_SOURCES', () => {
    test('has all expected sources', () => {
      expect(XP_SOURCES.wordle_win).toBeDefined();
      expect(XP_SOURCES.wordle_first).toBeDefined();
      expect(XP_SOURCES.trivia_correct).toBeDefined();
      expect(XP_SOURCES.blackjack_win).toBeDefined();
    });

    test('each source has min and max', () => {
      Object.values(XP_SOURCES).forEach((source) => {
        expect(typeof source.min).toBe('number');
        expect(typeof source.max).toBe('number');
        expect(source.max).toBeGreaterThanOrEqual(source.min);
      });
    });
  });

  describe('DROP_CONFIG', () => {
    test('has valid probability values', () => {
      expect(DROP_CONFIG.WORDLE_WIN_CHANCE).toBeGreaterThanOrEqual(0);
      expect(DROP_CONFIG.WORDLE_WIN_CHANCE).toBeLessThanOrEqual(1);
      expect(DROP_CONFIG.WORDLE_FIRST_CHANCE).toBe(1.0);
      expect(DROP_CONFIG.TRIVIA_CORRECT_CHANCE).toBeGreaterThanOrEqual(0);
      expect(DROP_CONFIG.TRIVIA_CORRECT_CHANCE).toBeLessThanOrEqual(1);
    });
  });

  describe('SHOP_PACKS', () => {
    test('has expected packs', () => {
      expect(SHOP_PACKS.starter_pack).toBeDefined();
      expect(SHOP_PACKS.pro_pack).toBeDefined();
      expect(SHOP_PACKS.elite_pack).toBeDefined();
    });

    test('each pack has name, price, and quantity', () => {
      Object.values(SHOP_PACKS).forEach((pack) => {
        expect(typeof pack.name).toBe('string');
        expect(typeof pack.price).toBe('number');
        expect(typeof pack.quantity).toBe('number');
        expect(pack.price).toBeGreaterThan(0);
        expect(pack.quantity).toBeGreaterThan(0);
      });
    });
  });

  describe('TRAINING_CONFIG', () => {
    test('has valid slot configuration', () => {
      expect(TRAINING_CONFIG.DEFAULT_SLOTS).toBe(1);
      expect(TRAINING_CONFIG.MAX_SLOTS).toBe(5);
      expect(TRAINING_CONFIG.MAX_SLOTS).toBeGreaterThan(TRAINING_CONFIG.DEFAULT_SLOTS);
      expect(TRAINING_CONFIG.SLOT_COST).toBeGreaterThan(0);
    });
  });

  describe('VARIANTS', () => {
    test('has standard variant', () => {
      expect(VARIANTS.standard).toBeDefined();
      expect(VARIANTS.standard.name).toBe('Standard');
      expect(VARIANTS.standard.statBonus).toBe(0);
    });
  });

  describe('ACQUISITION_SOURCES', () => {
    test('has all acquisition sources', () => {
      expect(ACQUISITION_SOURCES.WORDLE).toBe('wordle');
      expect(ACQUISITION_SOURCES.TRIVIA).toBe('trivia');
      expect(ACQUISITION_SOURCES.SHOP).toBe('shop');
      expect(ACQUISITION_SOURCES.TRADE).toBe('trade');
    });
  });
});
