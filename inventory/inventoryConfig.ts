// Inventory System Configuration
// Item definitions and categories for the training ground system

// ============ TYPE DEFINITIONS ============

export type ItemCategory = 'contract' | 'tool' | 'player' | 'wordle';

export type ItemType =
  | 'contract_te'
  | 'contract_rb'
  | 'contract_wr'
  | 'contract_qb'
  | 'tool_setup_kit'
  | 'tool_water_cooler'
  | 'rookie_te'
  | 'rookie_rb'
  | 'rookie_wr'
  | 'rookie_qb'
  | 'wordle_lucky_letter';

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
  // ============ Contracts (consumable - used to draft rookies) ============
  contract_te: {
    category: 'contract',
    displayName: 'TE Contract',
    emoji: '📜🤲',
    description: 'Draft a Tight End rookie',
    stackable: true,
    sellable: false,
  },
  contract_rb: {
    category: 'contract',
    displayName: 'RB Contract',
    emoji: '📜🏃',
    description: 'Draft a Running Back rookie',
    stackable: true,
    sellable: false,
  },
  contract_wr: {
    category: 'contract',
    displayName: 'WR Contract',
    emoji: '📜🎯',
    description: 'Draft a Wide Receiver rookie',
    stackable: true,
    sellable: false,
  },
  contract_qb: {
    category: 'contract',
    displayName: 'QB Contract',
    emoji: '📜🏈',
    description: 'Draft a Quarterback rookie',
    stackable: true,
    sellable: false,
  },

  // ============ Tools (consumable - have limited uses) ============
  tool_setup_kit: {
    category: 'tool',
    displayName: 'Setup Kit',
    emoji: '🔧',
    description: 'Prepares training slots with equipment',
    stackable: true,
    sellable: false,
  },
  tool_water_cooler: {
    category: 'tool',
    displayName: 'Water Cooler',
    emoji: '💧',
    description: 'Hydrates prepared slots for drafting',
    stackable: true,
    sellable: false,
  },

  // ============ Graduated Players (sellable) ============
  rookie_te: {
    category: 'player',
    displayName: 'Tight End Rookie',
    emoji: '🤲⭐',
    description: 'Graduated Tight End',
    stackable: true,
    sellable: true,
    baseValue: 75, // 75-100 range on graduation
  },
  rookie_rb: {
    category: 'player',
    displayName: 'Running Back Rookie',
    emoji: '🏃⭐',
    description: 'Graduated Running Back',
    stackable: true,
    sellable: true,
    baseValue: 150, // 150-200 range on graduation
  },
  rookie_wr: {
    category: 'player',
    displayName: 'Wide Receiver Rookie',
    emoji: '🎯⭐',
    description: 'Graduated Wide Receiver',
    stackable: true,
    sellable: true,
    baseValue: 225, // 225-300 range on graduation
  },
  rookie_qb: {
    category: 'player',
    displayName: 'Quarterback Rookie',
    emoji: '🏈⭐',
    description: 'Graduated Quarterback',
    stackable: true,
    sellable: true,
    baseValue: 375, // 375-500 range on graduation
  },

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
  contract: { displayName: 'Contracts', emoji: '📜', order: 1 },
  tool: { displayName: 'Training Tools', emoji: '🔧', order: 2 },
  player: { displayName: 'Graduated Players', emoji: '⭐', order: 3 },
  wordle: { displayName: 'Wordle Collectibles', emoji: '🔤', order: 4 },
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
