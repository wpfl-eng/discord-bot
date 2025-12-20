import { describe, test, expect } from '@jest/globals';
import {
  TRAINING_CONFIG,
  getPosition,
  getPositionKeys,
  getState,
  randomInt,
  calculateGraduationValue,
} from '../../training/trainingConfig.js';

describe('trainingConfig', () => {
  // ============ TRAINING_CONFIG TESTS ============

  describe('TRAINING_CONFIG', () => {
    test('has GRID_SIZE of 9', () => {
      expect(TRAINING_CONFIG.GRID_SIZE).toBe(9);
    });

    describe('POSITIONS', () => {
      test('has all 4 positions (TE, RB, WR, QB)', () => {
        expect(TRAINING_CONFIG.POSITIONS.TE).toBeDefined();
        expect(TRAINING_CONFIG.POSITIONS.RB).toBeDefined();
        expect(TRAINING_CONFIG.POSITIONS.WR).toBeDefined();
        expect(TRAINING_CONFIG.POSITIONS.QB).toBeDefined();
      });

      test('each position has required properties', () => {
        Object.values(TRAINING_CONFIG.POSITIONS).forEach((pos) => {
          expect(typeof pos.emoji).toBe('string');
          expect(typeof pos.displayName).toBe('string');
          expect(typeof pos.contractItemType).toBe('string');
          expect(typeof pos.rookieItemType).toBe('string');
          expect(typeof pos.trainTimeMinutes).toBe('number');
          expect(typeof pos.graduateValueMin).toBe('number');
          expect(typeof pos.graduateValueMax).toBe('number');
          expect(typeof pos.wiltWindowMinutes).toBe('number');
        });
      });

      test('graduateValueMin is less than graduateValueMax for each position', () => {
        Object.values(TRAINING_CONFIG.POSITIONS).forEach((pos) => {
          expect(pos.graduateValueMin).toBeLessThan(pos.graduateValueMax);
        });
      });

      test('positions are ordered by training time', () => {
        expect(TRAINING_CONFIG.POSITIONS.TE.trainTimeMinutes).toBeLessThan(
          TRAINING_CONFIG.POSITIONS.RB.trainTimeMinutes
        );
        expect(TRAINING_CONFIG.POSITIONS.RB.trainTimeMinutes).toBeLessThan(
          TRAINING_CONFIG.POSITIONS.WR.trainTimeMinutes
        );
        expect(TRAINING_CONFIG.POSITIONS.WR.trainTimeMinutes).toBeLessThan(
          TRAINING_CONFIG.POSITIONS.QB.trainTimeMinutes
        );
      });

      test('positions are ordered by value', () => {
        expect(TRAINING_CONFIG.POSITIONS.TE.graduateValueMax).toBeLessThan(
          TRAINING_CONFIG.POSITIONS.RB.graduateValueMax
        );
        expect(TRAINING_CONFIG.POSITIONS.RB.graduateValueMax).toBeLessThan(
          TRAINING_CONFIG.POSITIONS.WR.graduateValueMax
        );
        expect(TRAINING_CONFIG.POSITIONS.WR.graduateValueMax).toBeLessThan(
          TRAINING_CONFIG.POSITIONS.QB.graduateValueMax
        );
      });
    });

    describe('STATES', () => {
      test('has all 6 states', () => {
        expect(TRAINING_CONFIG.STATES.EMPTY).toBeDefined();
        expect(TRAINING_CONFIG.STATES.PREPARED).toBeDefined();
        expect(TRAINING_CONFIG.STATES.HYDRATED).toBeDefined();
        expect(TRAINING_CONFIG.STATES.TRAINING).toBeDefined();
        expect(TRAINING_CONFIG.STATES.READY).toBeDefined();
        expect(TRAINING_CONFIG.STATES.BUSTED).toBeDefined();
      });

      test('each state has name and description', () => {
        Object.values(TRAINING_CONFIG.STATES).forEach((state) => {
          expect(typeof state.name).toBe('string');
          expect(typeof state.description).toBe('string');
        });
      });

      test('TRAINING state has null emoji', () => {
        expect(TRAINING_CONFIG.STATES.TRAINING.emoji).toBeNull();
      });

      test('other states have string emoji', () => {
        expect(typeof TRAINING_CONFIG.STATES.EMPTY.emoji).toBe('string');
        expect(typeof TRAINING_CONFIG.STATES.PREPARED.emoji).toBe('string');
        expect(typeof TRAINING_CONFIG.STATES.READY.emoji).toBe('string');
      });
    });

    describe('TOOLS', () => {
      test('has SETUP_KIT and WATER_COOLER', () => {
        expect(TRAINING_CONFIG.TOOLS.SETUP_KIT).toBeDefined();
        expect(TRAINING_CONFIG.TOOLS.WATER_COOLER).toBeDefined();
      });

      test('each tool has itemType, displayName, and emoji', () => {
        Object.values(TRAINING_CONFIG.TOOLS).forEach((tool) => {
          expect(typeof tool.itemType).toBe('string');
          expect(typeof tool.displayName).toBe('string');
          expect(typeof tool.emoji).toBe('string');
        });
      });
    });

    describe('STARTER_KIT', () => {
      test('is an array with items', () => {
        expect(Array.isArray(TRAINING_CONFIG.STARTER_KIT)).toBe(true);
        expect(TRAINING_CONFIG.STARTER_KIT.length).toBeGreaterThan(0);
      });

      test('each item has itemType and quantity', () => {
        TRAINING_CONFIG.STARTER_KIT.forEach((item) => {
          expect(typeof item.itemType).toBe('string');
          expect(typeof item.quantity).toBe('number');
          expect(item.quantity).toBeGreaterThan(0);
        });
      });
    });
  });

  // ============ FUNCTION TESTS ============

  describe('getPosition', () => {
    test('returns position for valid key', () => {
      const qb = getPosition('QB');
      expect(qb).not.toBeNull();
      expect(qb?.displayName).toBe('Quarterback');
    });

    test('returns position for all valid keys', () => {
      expect(getPosition('TE')?.displayName).toBe('Tight End');
      expect(getPosition('RB')?.displayName).toBe('Running Back');
      expect(getPosition('WR')?.displayName).toBe('Wide Receiver');
      expect(getPosition('QB')?.displayName).toBe('Quarterback');
    });

    test('returns null for unknown key', () => {
      expect(getPosition('INVALID')).toBeNull();
      expect(getPosition('OL')).toBeNull();
    });

    test('is case sensitive', () => {
      expect(getPosition('qb')).toBeNull();
      expect(getPosition('Qb')).toBeNull();
    });

    test('handles null/undefined gracefully', () => {
      expect(getPosition(null as unknown as string)).toBeNull();
      expect(getPosition(undefined as unknown as string)).toBeNull();
    });
  });

  describe('getPositionKeys', () => {
    test('returns array of all position keys', () => {
      const keys = getPositionKeys();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys).toHaveLength(4);
    });

    test('includes all 4 positions', () => {
      const keys = getPositionKeys();
      expect(keys).toContain('TE');
      expect(keys).toContain('RB');
      expect(keys).toContain('WR');
      expect(keys).toContain('QB');
    });
  });

  describe('getState', () => {
    test('returns state for valid name', () => {
      const empty = getState('empty');
      expect(empty).not.toBeNull();
      expect(empty?.emoji).toBe('⬛');
    });

    test('returns state for all valid names', () => {
      expect(getState('empty')?.emoji).toBe('⬛');
      expect(getState('prepared')?.emoji).toBe('🟫');
      expect(getState('hydrated')?.emoji).toBe('💧');
      expect(getState('training')?.emoji).toBeNull();
      expect(getState('ready')?.emoji).toBe('⭐');
      expect(getState('busted')?.emoji).toBe('💀');
    });

    test('returns null for unknown name', () => {
      expect(getState('invalid')).toBeNull();
      expect(getState('EMPTY')).toBeNull(); // Case sensitive
    });

    test('handles null/undefined gracefully', () => {
      expect(getState(null as unknown as string)).toBeNull();
      expect(getState(undefined as unknown as string)).toBeNull();
    });
  });

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
  });

  describe('calculateGraduationValue', () => {
    test('returns value within range for TE', () => {
      for (let i = 0; i < 50; i++) {
        const value = calculateGraduationValue('TE');
        expect(value).toBeGreaterThanOrEqual(75);
        expect(value).toBeLessThanOrEqual(100);
      }
    });

    test('returns value within range for QB', () => {
      for (let i = 0; i < 50; i++) {
        const value = calculateGraduationValue('QB');
        expect(value).toBeGreaterThanOrEqual(375);
        expect(value).toBeLessThanOrEqual(500);
      }
    });

    test('returns 0 for unknown position', () => {
      expect(calculateGraduationValue('INVALID')).toBe(0);
      expect(calculateGraduationValue('OL')).toBe(0);
    });

    test('returns 0 for null/undefined position', () => {
      expect(calculateGraduationValue(null as unknown as string)).toBe(0);
      expect(calculateGraduationValue(undefined as unknown as string)).toBe(0);
    });

    test('QB has higher values than WR', () => {
      // Test statistical property: QB min > WR max
      const qbMin = TRAINING_CONFIG.POSITIONS.QB.graduateValueMin;
      const wrMax = TRAINING_CONFIG.POSITIONS.WR.graduateValueMax;
      expect(qbMin).toBeGreaterThan(wrMax);
    });
  });
});
