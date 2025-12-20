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
    test('has all contract items', () => {
      expect(ITEM_DEFINITIONS.contract_te).toBeDefined();
      expect(ITEM_DEFINITIONS.contract_rb).toBeDefined();
      expect(ITEM_DEFINITIONS.contract_wr).toBeDefined();
      expect(ITEM_DEFINITIONS.contract_qb).toBeDefined();
    });

    test('has all tool items', () => {
      expect(ITEM_DEFINITIONS.tool_setup_kit).toBeDefined();
      expect(ITEM_DEFINITIONS.tool_water_cooler).toBeDefined();
    });

    test('has all player items', () => {
      expect(ITEM_DEFINITIONS.rookie_te).toBeDefined();
      expect(ITEM_DEFINITIONS.rookie_rb).toBeDefined();
      expect(ITEM_DEFINITIONS.rookie_wr).toBeDefined();
      expect(ITEM_DEFINITIONS.rookie_qb).toBeDefined();
    });

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

    test('contracts are not sellable', () => {
      expect(ITEM_DEFINITIONS.contract_te.sellable).toBe(false);
      expect(ITEM_DEFINITIONS.contract_rb.sellable).toBe(false);
      expect(ITEM_DEFINITIONS.contract_wr.sellable).toBe(false);
      expect(ITEM_DEFINITIONS.contract_qb.sellable).toBe(false);
    });

    test('tools are not sellable', () => {
      expect(ITEM_DEFINITIONS.tool_setup_kit.sellable).toBe(false);
      expect(ITEM_DEFINITIONS.tool_water_cooler.sellable).toBe(false);
    });

    test('rookies are sellable', () => {
      expect(ITEM_DEFINITIONS.rookie_te.sellable).toBe(true);
      expect(ITEM_DEFINITIONS.rookie_rb.sellable).toBe(true);
      expect(ITEM_DEFINITIONS.rookie_wr.sellable).toBe(true);
      expect(ITEM_DEFINITIONS.rookie_qb.sellable).toBe(true);
    });
  });

  // ============ ITEM_CATEGORIES TESTS ============

  describe('ITEM_CATEGORIES', () => {
    test('has all 4 categories', () => {
      expect(ITEM_CATEGORIES.contract).toBeDefined();
      expect(ITEM_CATEGORIES.tool).toBeDefined();
      expect(ITEM_CATEGORIES.player).toBeDefined();
      expect(ITEM_CATEGORIES.wordle).toBeDefined();
    });

    test('each category has displayName, emoji, and order', () => {
      Object.values(ITEM_CATEGORIES).forEach((cat) => {
        expect(typeof cat.displayName).toBe('string');
        expect(typeof cat.emoji).toBe('string');
        expect(typeof cat.order).toBe('number');
      });
    });

    test('categories are ordered correctly', () => {
      expect(ITEM_CATEGORIES.contract.order).toBe(1);
      expect(ITEM_CATEGORIES.tool.order).toBe(2);
      expect(ITEM_CATEGORIES.player.order).toBe(3);
      expect(ITEM_CATEGORIES.wordle.order).toBe(4);
    });
  });

  // ============ FUNCTION TESTS ============

  describe('getItemDefinition', () => {
    test('returns definition for valid item type', () => {
      const def = getItemDefinition('contract_te');
      expect(def).not.toBeNull();
      expect(def?.displayName).toBe('TE Contract');
    });

    test('returns null for unknown item type', () => {
      expect(getItemDefinition('invalid_item')).toBeNull();
    });

    test('handles null/undefined gracefully', () => {
      expect(getItemDefinition(null as unknown as string)).toBeNull();
      expect(getItemDefinition(undefined as unknown as string)).toBeNull();
    });
  });

  describe('getItemsInCategory', () => {
    test('returns all items in contract category', () => {
      const items = getItemsInCategory('contract');
      expect(items.length).toBe(4);
      expect(items.map((i) => i.itemType)).toContain('contract_te');
      expect(items.map((i) => i.itemType)).toContain('contract_qb');
    });

    test('returns all items in player category', () => {
      const items = getItemsInCategory('player');
      expect(items.length).toBe(4);
    });

    test('returns all items in tool category', () => {
      const items = getItemsInCategory('tool');
      expect(items.length).toBe(2);
    });

    test('returns wordle items', () => {
      const items = getItemsInCategory('wordle');
      expect(items.length).toBe(1);
      expect(items[0].itemType).toBe('wordle_lucky_letter');
    });

    test('returns empty array for unknown category', () => {
      const items = getItemsInCategory('invalid');
      expect(items).toEqual([]);
    });

    test('each returned item has itemType property', () => {
      const items = getItemsInCategory('contract');
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

    test('returns all 5 sellable items', () => {
      const items = getSellableItems();
      expect(items.length).toBe(5); // 4 rookies + 1 wordle item
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
      expect(isValidItemType('contract_te')).toBe(true);
      expect(isValidItemType('tool_setup_kit')).toBe(true);
      expect(isValidItemType('rookie_qb')).toBe(true);
    });

    test('returns false for invalid item types', () => {
      expect(isValidItemType('invalid_item')).toBe(false);
      expect(isValidItemType('contract')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isValidItemType(null as unknown as string)).toBe(false);
      expect(isValidItemType(undefined as unknown as string)).toBe(false);
    });
  });

  describe('isItemSellable', () => {
    test('returns true for sellable items', () => {
      expect(isItemSellable('rookie_te')).toBe(true);
      expect(isItemSellable('wordle_lucky_letter')).toBe(true);
    });

    test('returns false for non-sellable items', () => {
      expect(isItemSellable('contract_te')).toBe(false);
      expect(isItemSellable('tool_setup_kit')).toBe(false);
    });

    test('returns false for invalid item types', () => {
      expect(isItemSellable('invalid_item')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isItemSellable(null as unknown as string)).toBe(false);
      expect(isItemSellable(undefined as unknown as string)).toBe(false);
    });
  });

  describe('getItemDisplayName', () => {
    test('returns display name for valid items', () => {
      expect(getItemDisplayName('contract_te')).toBe('TE Contract');
      expect(getItemDisplayName('rookie_qb')).toBe('Quarterback Rookie');
    });

    test('returns item type as fallback for unknown items', () => {
      expect(getItemDisplayName('unknown_item')).toBe('unknown_item');
    });
  });

  describe('getItemEmoji', () => {
    test('returns emoji for valid items', () => {
      expect(getItemEmoji('contract_te')).toBe('📜🤲');
      expect(getItemEmoji('tool_setup_kit')).toBe('🔧');
    });

    test('returns empty string for unknown items', () => {
      expect(getItemEmoji('unknown_item')).toBe('');
    });
  });

  describe('getItemBaseValue', () => {
    test('returns base value for sellable items', () => {
      expect(getItemBaseValue('rookie_te')).toBe(75);
      expect(getItemBaseValue('rookie_qb')).toBe(375);
      expect(getItemBaseValue('wordle_lucky_letter')).toBe(500);
    });

    test('returns 0 for non-sellable items', () => {
      expect(getItemBaseValue('contract_te')).toBe(0);
      expect(getItemBaseValue('tool_setup_kit')).toBe(0);
    });

    test('returns 0 for unknown items', () => {
      expect(getItemBaseValue('unknown_item')).toBe(0);
    });

    test('returns 0 for null/undefined', () => {
      expect(getItemBaseValue(null as unknown as string)).toBe(0);
      expect(getItemBaseValue(undefined as unknown as string)).toBe(0);
    });
  });
});
