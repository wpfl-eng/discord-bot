// Inventory Database Operations
// CRUD operations for user inventory items

import { sql } from '@vercel/postgres';
import * as economyDb from '../economy/economyDb.js';
import { getItemDefinition, getItemBaseValue, isItemSellable } from './inventoryConfig.js';

// ============ Type Definitions ============

/**
 * Inventory item record from user_inventory table
 */
export interface InventoryItem {
  readonly user_id: string;
  readonly item_type: string;
  readonly quantity: number;
  readonly item_value: number | null;
  readonly acquired_at: Date;
}

/**
 * Data for adding multiple items
 */
export interface AddItemData {
  readonly itemType: string;
  readonly quantity?: number;
  readonly itemValue?: number | null;
}

/**
 * Sell operation error types
 */
export type SellError =
  | 'INVALID_QUANTITY'
  | 'NOT_SELLABLE'
  | 'INSUFFICIENT_QUANTITY'
  | 'REMOVE_FAILED'
  | 'WALLET_UPDATE_FAILED';

/**
 * Transfer operation error types
 */
export type TransferError = 'INVALID_QUANTITY' | 'INSUFFICIENT_QUANTITY' | 'ADD_FAILED';

/**
 * Successful sell result
 */
export interface SellSuccess {
  readonly success: true;
  readonly item: InventoryItem;
  readonly earnings: number;
  readonly newBalance: number;
  readonly quantitySold: number;
}

/**
 * Failed sell result
 */
export interface SellFailure {
  readonly success: false;
  readonly error: SellError;
}

/**
 * Sell operation result (discriminated union)
 */
export type SellResult = SellSuccess | SellFailure;

/**
 * Successful transfer result
 */
export interface TransferSuccess {
  readonly success: true;
}

/**
 * Failed transfer result
 */
export interface TransferFailure {
  readonly success: false;
  readonly error: TransferError;
}

/**
 * Transfer operation result (discriminated union)
 */
export type TransferResult = TransferSuccess | TransferFailure;

// ============ Read Operations ============

/**
 * Get all inventory items for a user
 * @param userId - Discord user ID
 * @returns Array of inventory items
 */
export async function getInventory(userId: string): Promise<InventoryItem[]> {
  const result = await sql<InventoryItem>`
    SELECT * FROM user_inventory
    WHERE user_id = ${userId}
    ORDER BY item_type
  `;
  return result.rows;
}

/**
 * Get a single item from user's inventory
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @returns Inventory item or null if not found
 */
export async function getItem(
  userId: string,
  itemType: string
): Promise<InventoryItem | null> {
  const result = await sql<InventoryItem>`
    SELECT * FROM user_inventory
    WHERE user_id = ${userId}
      AND item_type = ${itemType}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Get items filtered by category
 * @param userId - Discord user ID
 * @param category - Category to filter by
 * @returns Array of inventory items in category
 */
export async function getItemsByCategory(
  userId: string,
  category: string
): Promise<InventoryItem[]> {
  // Get all items and filter by category (category is in config, not DB)
  const allItems = await getInventory(userId);
  return allItems.filter((item) => {
    const def = getItemDefinition(item.item_type);
    return def && def.category === category;
  });
}

/**
 * Check if user has at least N of an item
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @param minQuantity - Minimum quantity required (default: 1)
 * @returns True if user has enough
 */
export async function hasItem(
  userId: string,
  itemType: string,
  minQuantity: number = 1
): Promise<boolean> {
  const result = await sql`
    SELECT quantity FROM user_inventory
    WHERE user_id = ${userId}
      AND item_type = ${itemType}
      AND quantity >= ${minQuantity}
    LIMIT 1
  `;
  return result.rows.length > 0;
}

/**
 * Get quantity of a specific item
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @returns Quantity owned (0 if not owned)
 */
export async function getItemQuantity(
  userId: string,
  itemType: string
): Promise<number> {
  const item = await getItem(userId, itemType);
  return item ? item.quantity : 0;
}

// ============ Write Operations ============

/**
 * Add item to inventory (upsert - adds to quantity if exists)
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @param quantity - Quantity to add (default: 1)
 * @param itemValue - Value per item (for sellable items)
 * @returns Updated inventory item or null if invalid quantity
 */
export async function addItem(
  userId: string,
  itemType: string,
  quantity: number = 1,
  itemValue: number | null = null
): Promise<InventoryItem | null> {
  if (quantity <= 0) return null;

  // If no value provided, use base value from config
  const value = itemValue !== null ? itemValue : getItemBaseValue(itemType);

  const result = await sql<InventoryItem>`
    INSERT INTO user_inventory (user_id, item_type, quantity, item_value, acquired_at)
    VALUES (${userId}, ${itemType}, ${quantity}, ${value}, NOW())
    ON CONFLICT (user_id, item_type) DO UPDATE SET
      quantity = user_inventory.quantity + ${quantity},
      item_value = COALESCE(${value}, user_inventory.item_value)
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Remove item from inventory (atomic - fails if insufficient)
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @param quantity - Quantity to remove (default: 1)
 * @returns Updated inventory item or null if insufficient
 */
export async function removeItem(
  userId: string,
  itemType: string,
  quantity: number = 1
): Promise<InventoryItem | null> {
  if (quantity <= 0) return null;

  const result = await sql<InventoryItem>`
    UPDATE user_inventory
    SET quantity = quantity - ${quantity}
    WHERE user_id = ${userId}
      AND item_type = ${itemType}
      AND quantity >= ${quantity}
    RETURNING *
  `;

  const item = result.rows[0];
  if (!item) return null;

  // If quantity is now 0, delete the row
  if (item.quantity === 0) {
    await sql`
      DELETE FROM user_inventory
      WHERE user_id = ${userId}
        AND item_type = ${itemType}
        AND quantity = 0
    `;
  }

  return item;
}

/**
 * Set exact quantity of an item (use with caution)
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @param quantity - New quantity
 * @returns Updated inventory item or null if deleted
 */
export async function setItemQuantity(
  userId: string,
  itemType: string,
  quantity: number
): Promise<InventoryItem | null> {
  if (quantity <= 0) {
    // Delete the item if setting to 0 or negative
    await sql`
      DELETE FROM user_inventory
      WHERE user_id = ${userId}
        AND item_type = ${itemType}
    `;
    return null;
  }

  const result = await sql<InventoryItem>`
    INSERT INTO user_inventory (user_id, item_type, quantity, acquired_at)
    VALUES (${userId}, ${itemType}, ${quantity}, NOW())
    ON CONFLICT (user_id, item_type) DO UPDATE SET
      quantity = ${quantity}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// ============ Transaction Operations ============

/**
 * Sell item from inventory (atomic: remove from inventory + add to wallet)
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @param quantity - Quantity to sell (default: 1)
 * @returns Sell result with success/failure discriminated union
 */
export async function sellItem(
  userId: string,
  itemType: string,
  quantity: number = 1
): Promise<SellResult> {
  if (quantity <= 0) {
    return { success: false, error: 'INVALID_QUANTITY' };
  }

  // Check if item is sellable
  if (!isItemSellable(itemType)) {
    return { success: false, error: 'NOT_SELLABLE' };
  }

  // Get current item to check quantity and value
  const currentItem = await getItem(userId, itemType);
  if (!currentItem || currentItem.quantity < quantity) {
    return { success: false, error: 'INSUFFICIENT_QUANTITY' };
  }

  // Calculate earnings (use item_value from DB if set, otherwise base value)
  const valuePerItem = currentItem.item_value ?? getItemBaseValue(itemType);
  const totalEarnings = valuePerItem * quantity;

  // Remove items from inventory (atomic)
  const removedItem = await removeItem(userId, itemType, quantity);
  if (!removedItem) {
    return { success: false, error: 'REMOVE_FAILED' };
  }

  // Add earnings to wallet
  const updatedUser = await economyDb.addToWallet(userId, totalEarnings);
  if (!updatedUser) {
    // Rollback: re-add the items that were removed
    await addItem(userId, itemType, quantity, valuePerItem);
    console.error(
      `Rolled back sale: Failed to add ${totalEarnings} to wallet for user ${userId} after selling ${quantity}x ${itemType}`
    );
    return { success: false, error: 'WALLET_UPDATE_FAILED' };
  }

  return {
    success: true,
    item: removedItem,
    earnings: totalEarnings,
    newBalance: updatedUser.wallet,
    quantitySold: quantity,
  };
}

/**
 * Transfer items between users
 * @param fromUserId - Source user ID
 * @param toUserId - Destination user ID
 * @param itemType - Item type key
 * @param quantity - Quantity to transfer
 * @returns Transfer result with success/failure discriminated union
 */
export async function transferItem(
  fromUserId: string,
  toUserId: string,
  itemType: string,
  quantity: number = 1
): Promise<TransferResult> {
  if (quantity <= 0) {
    return { success: false, error: 'INVALID_QUANTITY' };
  }

  // Remove from source user
  const removed = await removeItem(fromUserId, itemType, quantity);
  if (!removed) {
    return { success: false, error: 'INSUFFICIENT_QUANTITY' };
  }

  // Get value from removed item to preserve it
  const itemValue = removed.item_value;

  // Add to destination user
  const added = await addItem(toUserId, itemType, quantity, itemValue);
  if (!added) {
    // Rollback - add items back to source
    await addItem(fromUserId, itemType, quantity, itemValue);
    return { success: false, error: 'ADD_FAILED' };
  }

  return { success: true };
}

// ============ Bulk Operations ============

/**
 * Add multiple items at once
 * @param userId - Discord user ID
 * @param items - Array of item data to add
 * @returns Array of added items
 */
export async function addItems(
  userId: string,
  items: AddItemData[]
): Promise<InventoryItem[]> {
  const results: InventoryItem[] = [];
  for (const item of items) {
    const result = await addItem(userId, item.itemType, item.quantity ?? 1, item.itemValue ?? null);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

/**
 * Clear all items of a specific type from user's inventory
 * @param userId - Discord user ID
 * @param itemType - Item type key
 * @returns True if deleted
 */
export async function clearItem(userId: string, itemType: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM user_inventory
    WHERE user_id = ${userId}
      AND item_type = ${itemType}
    RETURNING *
  `;
  return result.rows.length > 0;
}

/**
 * Clear entire inventory for a user (use with caution!)
 * @param userId - Discord user ID
 * @returns Number of items deleted
 */
export async function clearInventory(userId: string): Promise<number> {
  const result = await sql`
    DELETE FROM user_inventory
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows.length;
}
