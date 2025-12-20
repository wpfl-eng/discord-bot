// Inventory System Configuration
// Item definitions and categories for the training ground system

/**
 * Item type definitions
 * Each item has: category, displayName, emoji, description, stackable, sellable, baseValue (optional)
 */
export const ITEM_DEFINITIONS = {
  // ============ Contracts (consumable - used to draft rookies) ============
  contract_te: {
    category: "contract",
    displayName: "TE Contract",
    emoji: "📜🤲",
    description: "Draft a Tight End rookie",
    stackable: true,
    sellable: false,
  },
  contract_rb: {
    category: "contract",
    displayName: "RB Contract",
    emoji: "📜🏃",
    description: "Draft a Running Back rookie",
    stackable: true,
    sellable: false,
  },
  contract_wr: {
    category: "contract",
    displayName: "WR Contract",
    emoji: "📜🎯",
    description: "Draft a Wide Receiver rookie",
    stackable: true,
    sellable: false,
  },
  contract_qb: {
    category: "contract",
    displayName: "QB Contract",
    emoji: "📜🏈",
    description: "Draft a Quarterback rookie",
    stackable: true,
    sellable: false,
  },

  // ============ Tools (consumable - have limited uses) ============
  tool_setup_kit: {
    category: "tool",
    displayName: "Setup Kit",
    emoji: "🔧",
    description: "Prepares training slots with equipment",
    stackable: true,
    sellable: false,
  },
  tool_water_cooler: {
    category: "tool",
    displayName: "Water Cooler",
    emoji: "💧",
    description: "Hydrates prepared slots for drafting",
    stackable: true,
    sellable: false,
  },

  // ============ Graduated Players (sellable) ============
  rookie_te: {
    category: "player",
    displayName: "Tight End Rookie",
    emoji: "🤲⭐",
    description: "Graduated Tight End",
    stackable: true,
    sellable: true,
    baseValue: 75, // 75-100 range on graduation
  },
  rookie_rb: {
    category: "player",
    displayName: "Running Back Rookie",
    emoji: "🏃⭐",
    description: "Graduated Running Back",
    stackable: true,
    sellable: true,
    baseValue: 150, // 150-200 range on graduation
  },
  rookie_wr: {
    category: "player",
    displayName: "Wide Receiver Rookie",
    emoji: "🎯⭐",
    description: "Graduated Wide Receiver",
    stackable: true,
    sellable: true,
    baseValue: 225, // 225-300 range on graduation
  },
  rookie_qb: {
    category: "player",
    displayName: "Quarterback Rookie",
    emoji: "🏈⭐",
    description: "Graduated Quarterback",
    stackable: true,
    sellable: true,
    baseValue: 375, // 375-500 range on graduation
  },

  // ============ Wordle Collectibles ============
  wordle_lucky_letter: {
    category: "wordle",
    displayName: "Lucky Letter",
    emoji: "🔤",
    description: "A golden letter tile from being first to solve a Wordle",
    stackable: true,
    sellable: true,
    baseValue: 500,
  },
};

/**
 * Item categories with display info
 */
export const ITEM_CATEGORIES = {
  contract: { displayName: "Contracts", emoji: "📜", order: 1 },
  tool: { displayName: "Training Tools", emoji: "🔧", order: 2 },
  player: { displayName: "Graduated Players", emoji: "⭐", order: 3 },
  wordle: { displayName: "Wordle Collectibles", emoji: "🔤", order: 4 },
};

/**
 * Get item definition by type
 * @param {string} itemType - The item type key
 * @returns {object|null} - Item definition or null if not found
 */
export function getItemDefinition(itemType) {
  return ITEM_DEFINITIONS[itemType] || null;
}

/**
 * Get all items in a specific category
 * @param {string} category - The category to filter by
 * @returns {array} - Array of items with their types
 */
export function getItemsInCategory(category) {
  return Object.entries(ITEM_DEFINITIONS)
    .filter(([_, def]) => def.category === category)
    .map(([itemType, def]) => ({ itemType, ...def }));
}

/**
 * Get all sellable items
 * @returns {array} - Array of sellable items with their types
 */
export function getSellableItems() {
  return Object.entries(ITEM_DEFINITIONS)
    .filter(([_, def]) => def.sellable)
    .map(([itemType, def]) => ({ itemType, ...def }));
}

/**
 * Check if an item type exists
 * @param {string} itemType - The item type key
 * @returns {boolean} - True if item exists
 */
export function isValidItemType(itemType) {
  return itemType in ITEM_DEFINITIONS;
}

/**
 * Check if an item is sellable
 * @param {string} itemType - The item type key
 * @returns {boolean} - True if item can be sold
 */
export function isItemSellable(itemType) {
  const def = ITEM_DEFINITIONS[itemType];
  return def ? def.sellable : false;
}

/**
 * Get the display name for an item
 * @param {string} itemType - The item type key
 * @returns {string} - Display name or the item type if not found
 */
export function getItemDisplayName(itemType) {
  const def = ITEM_DEFINITIONS[itemType];
  return def ? def.displayName : itemType;
}

/**
 * Get the emoji for an item
 * @param {string} itemType - The item type key
 * @returns {string} - Emoji or empty string if not found
 */
export function getItemEmoji(itemType) {
  const def = ITEM_DEFINITIONS[itemType];
  return def ? def.emoji : "";
}

/**
 * Get the base value for an item (for selling)
 * @param {string} itemType - The item type key
 * @returns {number} - Base value or 0 if not sellable
 */
export function getItemBaseValue(itemType) {
  const def = ITEM_DEFINITIONS[itemType];
  return def && def.sellable ? def.baseValue : 0;
}
