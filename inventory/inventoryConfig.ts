// Inventory System Configuration
// Item definitions and categories for player-held items

// ============ TYPE DEFINITIONS ============

export type ItemCategory = 'wordle';

export type ItemType = 'wordle_lucky_letter';

export interface ItemDefinition {
  readonly category: ItemCategory;
  readonly displayName: string;
  readonly emoji: string;
  readonly description: string;
  readonly stackable: boolean;
  readonly sellable: boolean;
  readonly baseValue?: number;
}

export interface ItemWithType extends ItemDefinition {
  itemType: string;
}

export interface CategoryInfo {
  readonly displayName: string;
  readonly emoji: string;
  readonly order: number;
}

// ============ ITEM_DEFINITIONS ============

/**
 * Item type definitions
 * Each item has: category, displayName, emoji, description, stackable, sellable, baseValue (optional)
 */
export const ITEM_DEFINITIONS: Record<ItemType, ItemDefinition> = {
  // ============ Wordle Collectibles ============
  wordle_lucky_letter: {
    category: 'wordle',
    displayName: 'Lucky Letter',
    emoji: '🔤',
    description: 'A golden letter tile from being first to solve a Wordle',
    stackable: true,
    sellable: true,
    baseValue: 500,
  },
} as const;

/**
 * Item categories with display info
 */
export const ITEM_CATEGORIES: Record<ItemCategory, CategoryInfo> = {
  wordle: { displayName: 'Wordle Collectibles', emoji: '🔤', order: 1 },
} as const;

// ============ HELPER FUNCTIONS ============

/**
 * Get item definition by type
 */
export function getItemDefinition(itemType: string | null | undefined): ItemDefinition | null {
  if (!itemType) return null;
  return ITEM_DEFINITIONS[itemType as ItemType] || null;
}

/**
 * Get all items in a specific category
 */
export function getItemsInCategory(category: string): ItemWithType[] {
  return Object.entries(ITEM_DEFINITIONS)
    .filter(([_, def]) => def.category === category)
    .map(([itemType, def]) => ({ itemType, ...def }));
}

/**
 * Get all sellable items
 */
export function getSellableItems(): ItemWithType[] {
  return Object.entries(ITEM_DEFINITIONS)
    .filter(([_, def]) => def.sellable)
    .map(([itemType, def]) => ({ itemType, ...def }));
}

/**
 * Check if an item type exists
 */
export function isValidItemType(itemType: string | null | undefined): boolean {
  if (!itemType) return false;
  return itemType in ITEM_DEFINITIONS;
}

/**
 * Check if an item is sellable
 */
export function isItemSellable(itemType: string | null | undefined): boolean {
  if (!itemType) return false;
  const def = ITEM_DEFINITIONS[itemType as ItemType];
  return def ? def.sellable : false;
}

/**
 * Get the display name for an item
 */
export function getItemDisplayName(itemType: string): string {
  const def = ITEM_DEFINITIONS[itemType as ItemType];
  return def ? def.displayName : itemType;
}

/**
 * Get the emoji for an item
 */
export function getItemEmoji(itemType: string): string {
  const def = ITEM_DEFINITIONS[itemType as ItemType];
  return def ? def.emoji : '';
}

/**
 * Get the base value for an item (for selling)
 */
export function getItemBaseValue(itemType: string | null | undefined): number {
  if (!itemType) return 0;
  const def = ITEM_DEFINITIONS[itemType as ItemType];
  return def && def.sellable && def.baseValue !== undefined ? def.baseValue : 0;
}
