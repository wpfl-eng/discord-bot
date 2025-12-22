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
 *
 * Design note: Fetches all items and filters in-memory because category
 * is defined in config (inventoryConfig.ts), not stored in the database.
 * This is acceptable because:
 * - User inventories are typically small (tens of items)
 * - Avoids schema changes to add category column
 * - Categories can be modified in code without DB migration
 *
 * @param userId - Discord user ID
 * @param category - Category to filter by
 * @returns Array of inventory items in category
 */
export async function getItemsByCategory(
  userId: string,
  category: string
): Promise<InventoryItem[]> {
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
 * Uses a proper database transaction to ensure both operations succeed or both fail
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

  // Check if item is sellable (config check - no DB needed)
  if (!isItemSellable(itemType)) {
    return { success: false, error: 'NOT_SELLABLE' };
  }

  // Get current item to check quantity and value (before transaction)
  const currentItem = await getItem(userId, itemType);
  if (!currentItem || currentItem.quantity < quantity) {
    return { success: false, error: 'INSUFFICIENT_QUANTITY' };
  }

  // Calculate earnings (use item_value from DB if set, otherwise base value)
  const valuePerItem = currentItem.item_value ?? getItemBaseValue(itemType);
  const totalEarnings = valuePerItem * quantity;

  // Use a transaction for the inventory removal + wallet update
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    // Remove items from inventory (atomic check within transaction)
    const removeResult = await client.query<InventoryItem>(
      `UPDATE user_inventory
       SET quantity = quantity - $1
       WHERE user_id = $2 AND item_type = $3 AND quantity >= $1
       RETURNING *`,
      [quantity, userId, itemType]
    );

    if (!removeResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'REMOVE_FAILED' };
    }

    const removedItem = removeResult.rows[0];

    // Clean up if quantity is now 0
    if (removedItem.quantity === 0) {
      await client.query(
        `DELETE FROM user_inventory WHERE user_id = $1 AND item_type = $2 AND quantity = 0`,
        [userId, itemType]
      );
    }

    // Add earnings to wallet
    const walletResult = await client.query<{ wallet: number }>(
      `UPDATE economy_users
       SET wallet = wallet + $1, total_earned = total_earned + $1
       WHERE user_id = $2
       RETURNING wallet`,
      [totalEarnings, userId]
    );

    if (!walletResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'WALLET_UPDATE_FAILED' };
    }

    await client.query('COMMIT');

    return {
      success: true,
      item: removedItem,
      earnings: totalEarnings,
      newBalance: walletResult.rows[0].wallet,
      quantitySold: quantity,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Transaction failed for sellItem: ${error}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transfer items between users
 * Uses a proper database transaction to ensure both operations succeed or both fail
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

  // Get source item to verify quantity and preserve value (before transaction)
  const sourceItem = await getItem(fromUserId, itemType);
  if (!sourceItem || sourceItem.quantity < quantity) {
    return { success: false, error: 'INSUFFICIENT_QUANTITY' };
  }

  const itemValue = sourceItem.item_value;

  // Use a transaction for the transfer
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    // Remove from source user
    const removeResult = await client.query<InventoryItem>(
      `UPDATE user_inventory
       SET quantity = quantity - $1
       WHERE user_id = $2 AND item_type = $3 AND quantity >= $1
       RETURNING *`,
      [quantity, fromUserId, itemType]
    );

    if (!removeResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'INSUFFICIENT_QUANTITY' };
    }

    // Clean up if quantity is now 0
    if (removeResult.rows[0].quantity === 0) {
      await client.query(
        `DELETE FROM user_inventory WHERE user_id = $1 AND item_type = $2 AND quantity = 0`,
        [fromUserId, itemType]
      );
    }

    // Add to destination user (upsert)
    const addResult = await client.query<InventoryItem>(
      `INSERT INTO user_inventory (user_id, item_type, quantity, item_value, acquired_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, item_type) DO UPDATE SET
         quantity = user_inventory.quantity + $3,
         item_value = COALESCE($4, user_inventory.item_value)
       RETURNING *`,
      [toUserId, itemType, quantity, itemValue]
    );

    if (!addResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'ADD_FAILED' };
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Transaction failed for transferItem: ${error}`);
    throw error;
  } finally {
    client.release();
  }
}

// ============ Bulk Operations ============

/**
 * Add multiple items at once
 * Uses batch INSERT with UNNEST arrays for single-query efficiency
 * @param userId - Discord user ID
 * @param items - Array of item data to add
 * @returns Array of added items
 */
export async function addItems(
  userId: string,
  items: AddItemData[]
): Promise<InventoryItem[]> {
  if (items.length === 0) return [];

  // Prepare arrays for UNNEST
  const itemTypes: string[] = [];
  const quantities: number[] = [];
  const itemValues: (number | null)[] = [];

  for (const item of items) {
    if ((item.quantity ?? 1) <= 0) continue; // Skip invalid quantities
    itemTypes.push(item.itemType);
    quantities.push(item.quantity ?? 1);
    // Use provided value or get base value from config
    const value = item.itemValue !== undefined ? item.itemValue : getItemBaseValue(item.itemType);
    itemValues.push(value);
  }

  if (itemTypes.length === 0) return [];

  const client = await sql.connect();
  try {
    // Use UNNEST to batch insert all items in a single query
    const result = await client.query<InventoryItem>(
      `INSERT INTO user_inventory (user_id, item_type, quantity, item_value, acquired_at)
       SELECT $1, unnest($2::text[]), unnest($3::int[]), unnest($4::int[]), NOW()
       ON CONFLICT (user_id, item_type) DO UPDATE SET
         quantity = user_inventory.quantity + EXCLUDED.quantity,
         item_value = COALESCE(EXCLUDED.item_value, user_inventory.item_value)
       RETURNING *`,
      [userId, itemTypes, quantities, itemValues]
    );
    return result.rows;
  } finally {
    client.release();
  }
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
