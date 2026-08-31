import { describe, test, expect } from '@jest/globals';
import {
  ITEM_DEFINITIONS,
  ITEM_CATEGORIES,
  getItemDefinition,
  getItemsInCategory,
  getSellableItems,
  isValidItemType,
  isItemSellable,
  getItemDisplayName,
  getItemEmoji,
  getItemBaseValue,
} from '../../inventory/inventoryConfig.js';

describe('inventoryConfig', () => {
  // ============ ITEM_DEFINITIONS TESTS ============

  describe('ITEM_DEFINITIONS', () => {
    test('has wordle collectibles', () => {
      expect(ITEM_DEFINITIONS.wordle_lucky_letter).toBeDefined();
    });

    test('each item has required properties', () => {
      Object.values(ITEM_DEFINITIONS).forEach((item) => {
        expect(typeof item.category).toBe('string');
        expect(typeof item.displayName).toBe('string');
        expect(typeof item.emoji).toBe('string');
        expect(typeof item.description).toBe('string');
        expect(typeof item.stackable).toBe('boolean');
        expect(typeof item.sellable).toBe('boolean');
        expect(item.displayName.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(0);
      });
    });

    test('sellable items have baseValue', () => {
      Object.values(ITEM_DEFINITIONS).forEach((item) => {
        if (item.sellable) {
          expect(typeof item.baseValue).toBe('number');
          expect(item.baseValue).toBeGreaterThan(0);
        }
      });
    });

    test('every item belongs to a defined category', () => {
      Object.values(ITEM_DEFINITIONS).forEach((item) => {
        expect(ITEM_CATEGORIES[item.category]).toBeDefined();
      });
    });

    test('lucky letter is a sellable, stackable wordle collectible', () => {
      const luckyLetter = ITEM_DEFINITIONS.wordle_lucky_letter;
      expect(luckyLetter.category).toBe('wordle');
      expect(luckyLetter.displayName).toBe('Lucky Letter');
      expect(luckyLetter.stackable).toBe(true);
      expect(luckyLetter.sellable).toBe(true);
      expect(luckyLetter.baseValue).toBe(500);
    });
  });

  // ============ ITEM_CATEGORIES TESTS ============

  describe('ITEM_CATEGORIES', () => {
    test('has the wordle category', () => {
      expect(ITEM_CATEGORIES.wordle).toBeDefined();
    });

    test('each category has displayName, emoji, and order', () => {
      Object.values(ITEM_CATEGORIES).forEach((category) => {
        expect(typeof category.displayName).toBe('string');
        expect(typeof category.emoji).toBe('string');
        expect(typeof category.order).toBe('number');
        expect(category.displayName.length).toBeGreaterThan(0);
      });
    });

    test('category orders are unique', () => {
      const orders = Object.values(ITEM_CATEGORIES).map((c) => c.order);
      expect(new Set(orders).size).toBe(orders.length);
    });
  });

  // ============ FUNCTION TESTS ============

  describe('getItemDefinition', () => {
    test('returns definition for valid item type', () => {
      const def = getItemDefinition('wordle_lucky_letter');
      expect(def).not.toBeNull();
      expect(def?.displayName).toBe('Lucky Letter');
    });

    test('returns null for unknown item type', () => {
      expect(getItemDefinition('not_a_real_item')).toBeNull();
    });

    test('returns null for retired training-ground items', () => {
      expect(getItemDefinition('contract_te')).toBeNull();
      expect(getItemDefinition('tool_setup_kit')).toBeNull();
      expect(getItemDefinition('rookie_qb')).toBeNull();
    });

    test('handles null/undefined gracefully', () => {
      expect(getItemDefinition(null)).toBeNull();
      expect(getItemDefinition(undefined)).toBeNull();
    });
  });

  describe('getItemsInCategory', () => {
    test('returns wordle items', () => {
      const items = getItemsInCategory('wordle');
      expect(items.length).toBe(1);
      expect(items.map((i) => i.itemType)).toContain('wordle_lucky_letter');
    });

    test('returns empty array for unknown category', () => {
      expect(getItemsInCategory('nonexistent')).toEqual([]);
    });

    test('returns empty array for retired categories', () => {
      expect(getItemsInCategory('contract')).toEqual([]);
      expect(getItemsInCategory('tool')).toEqual([]);
      expect(getItemsInCategory('player')).toEqual([]);
    });

    test('each returned item has itemType property', () => {
      const items = getItemsInCategory('wordle');
      items.forEach((item) => {
        expect(typeof item.itemType).toBe('string');
      });
    });
  });

  describe('getSellableItems', () => {
    test('returns only sellable items', () => {
      const items = getSellableItems();
      items.forEach((item) => {
        expect(item.sellable).toBe(true);
      });
    });

    test('returns the single sellable item', () => {
      const items = getSellableItems();
      expect(items.length).toBe(1);
      expect(items[0].itemType).toBe('wordle_lucky_letter');
    });

    test('each returned item has itemType property', () => {
      const items = getSellableItems();
      items.forEach((item) => {
        expect(typeof item.itemType).toBe('string');
      });
    });
  });

  describe('isValidItemType', () => {
    test('returns true for valid item types', () => {
      expect(isValidItemType('wordle_lucky_letter')).toBe(true);
    });

    test('returns false for invalid item types', () => {
      expect(isValidItemType('not_a_real_item')).toBe(false);
      expect(isValidItemType('rookie_qb')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isValidItemType(null)).toBe(false);
      expect(isValidItemType(undefined)).toBe(false);
    });
  });

  describe('isItemSellable', () => {
    test('returns true for sellable items', () => {
      expect(isItemSellable('wordle_lucky_letter')).toBe(true);
    });

    test('returns false for invalid item types', () => {
      expect(isItemSellable('not_a_real_item')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isItemSellable(null)).toBe(false);
      expect(isItemSellable(undefined)).toBe(false);
    });
  });

  describe('getItemDisplayName', () => {
    test('returns display name for valid items', () => {
      expect(getItemDisplayName('wordle_lucky_letter')).toBe('Lucky Letter');
    });

    test('returns item type as fallback for unknown items', () => {
      expect(getItemDisplayName('mystery_item')).toBe('mystery_item');
    });
  });

  describe('getItemEmoji', () => {
    test('returns emoji for valid items', () => {
      expect(getItemEmoji('wordle_lucky_letter')).toBe('🔤');
    });

    test('returns empty string for unknown items', () => {
      expect(getItemEmoji('mystery_item')).toBe('');
    });
  });

  describe('getItemBaseValue', () => {
    test('returns base value for sellable items', () => {
      expect(getItemBaseValue('wordle_lucky_letter')).toBe(500);
    });

    test('returns 0 for unknown items', () => {
      expect(getItemBaseValue('mystery_item')).toBe(0);
    });

    test('returns 0 for null/undefined', () => {
      expect(getItemBaseValue(null)).toBe(0);
      expect(getItemBaseValue(undefined)).toBe(0);
    });
  });
});
