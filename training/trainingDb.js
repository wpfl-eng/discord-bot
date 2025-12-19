import { sql } from "@vercel/postgres";
import * as inventoryDb from "../inventory/inventoryDb.js";
import { TRAINING_CONFIG, getPosition, calculateGraduationValue } from "./trainingConfig.js";

// ============ Read Operations ============

/**
 * Get a user's training ground
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getTrainingGround(userId) {
  const result = await sql`
    SELECT * FROM training_grounds
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Get all training slots for a user (ordered by slot_index)
 * @param {string} userId
 * @returns {Promise<array>}
 */
export async function getTrainingSlots(userId) {
  const result = await sql`
    SELECT * FROM training_slots
    WHERE user_id = ${userId}
    ORDER BY slot_index
  `;
  return result.rows;
}

/**
 * Get slots filtered by state
 * @param {string} userId
 * @param {string} state
 * @returns {Promise<array>}
 */
export async function getSlotsByState(userId, state) {
  const result = await sql`
    SELECT * FROM training_slots
    WHERE user_id = ${userId}
      AND state = ${state}
    ORDER BY slot_index
  `;
  return result.rows;
}

/**
 * Get a single slot by index
 * @param {string} userId
 * @param {number} slotIndex
 * @returns {Promise<object|null>}
 */
export async function getSlot(userId, slotIndex) {
  const result = await sql`
    SELECT * FROM training_slots
    WHERE user_id = ${userId}
      AND slot_index = ${slotIndex}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

// ============ Write Operations ============

/**
 * Create a new training ground with 9 empty slots
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<{ground: object, slots: array, isNew: boolean}>}
 */
export async function getOrCreateTrainingGround(userId, username) {
  // Check if exists
  let ground = await getTrainingGround(userId);

  if (ground) {
    const slots = await getTrainingSlots(userId);
    return { ground, slots, isNew: false };
  }

  // Create new training ground
  const groundResult = await sql`
    INSERT INTO training_grounds (user_id, username)
    VALUES (${userId}, ${username})
    RETURNING *
  `;
  ground = groundResult.rows[0];

  try {
    // Create 9 empty slots (bulk insert)
    await sql`
      INSERT INTO training_slots (user_id, slot_index, state)
      SELECT ${userId}, generate_series(0, 8), 'empty'
    `;

    // Grant starter kit items
    for (const item of TRAINING_CONFIG.STARTER_KIT) {
      await inventoryDb.addItem(userId, item.itemType, item.quantity);
    }
  } catch (error) {
    // Rollback: delete training ground (CASCADE deletes slots)
    await sql`DELETE FROM training_grounds WHERE user_id = ${userId}`;
    throw error;
  }

  const slots = await getTrainingSlots(userId);
  return { ground, slots, isNew: true };
}

/**
 * Update slot state (atomic with state check)
 * @param {string} userId
 * @param {number} slotIndex
 * @param {string} fromState - Current state (for validation)
 * @param {string} toState - New state
 * @param {string|null} rookieType - Position if training, null otherwise
 * @param {object|null} timestamps - { planted_at, ready_at, wilts_at }
 * @returns {Promise<object|null>}
 */
export async function updateSlotState(userId, slotIndex, fromState, toState, rookieType = null, timestamps = null) {
  const result = await sql`
    UPDATE training_slots
    SET
      state = ${toState},
      rookie_type = ${rookieType},
      planted_at = ${timestamps?.planted_at || null},
      ready_at = ${timestamps?.ready_at || null},
      wilts_at = ${timestamps?.wilts_at || null}
    WHERE user_id = ${userId}
      AND slot_index = ${slotIndex}
      AND state = ${fromState}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Setup slots (empty → prepared) - consumes Setup Kit
 * @param {string} userId
 * @param {number[]} slotIndexes
 * @returns {Promise<{success: boolean, updated: number, error?: string}>}
 */
export async function setupSlots(userId, slotIndexes) {
  if (slotIndexes.length === 0) {
    return { success: false, updated: 0, error: "NO_SLOTS_SELECTED" };
  }

  // Check tool quantity
  const quantity = await inventoryDb.getItemQuantity(userId, "tool_setup_kit");
  if (quantity < slotIndexes.length) {
    return { success: false, updated: 0, error: "INSUFFICIENT_TOOLS", needed: slotIndexes.length, have: quantity };
  }

  // Update each slot atomically, track which ones succeeded
  const updatedIndexes = [];
  for (const slotIndex of slotIndexes) {
    const result = await updateSlotState(userId, slotIndex, "empty", "prepared");
    if (result) updatedIndexes.push(slotIndex);
  }

  if (updatedIndexes.length === 0) {
    return { success: false, updated: 0, error: "NO_EMPTY_SLOTS" };
  }

  // Consume tools - rollback on failure
  try {
    await inventoryDb.removeItem(userId, "tool_setup_kit", updatedIndexes.length);
  } catch (error) {
    // Rollback: revert slots to empty
    for (const idx of updatedIndexes) {
      await updateSlotState(userId, idx, "prepared", "empty");
    }
    throw error;
  }

  return { success: true, updated: updatedIndexes.length };
}

/**
 * Hydrate slots (prepared → hydrated) - consumes Water Cooler
 * @param {string} userId
 * @param {number[]} slotIndexes
 * @returns {Promise<{success: boolean, updated: number, error?: string}>}
 */
export async function hydrateSlots(userId, slotIndexes) {
  if (slotIndexes.length === 0) {
    return { success: false, updated: 0, error: "NO_SLOTS_SELECTED" };
  }

  // Check tool quantity
  const quantity = await inventoryDb.getItemQuantity(userId, "tool_water_cooler");
  if (quantity < slotIndexes.length) {
    return { success: false, updated: 0, error: "INSUFFICIENT_TOOLS", needed: slotIndexes.length, have: quantity };
  }

  // Update each slot atomically, track which ones succeeded
  const updatedIndexes = [];
  for (const slotIndex of slotIndexes) {
    const result = await updateSlotState(userId, slotIndex, "prepared", "hydrated");
    if (result) updatedIndexes.push(slotIndex);
  }

  if (updatedIndexes.length === 0) {
    return { success: false, updated: 0, error: "NO_PREPARED_SLOTS" };
  }

  // Consume tools - rollback on failure
  try {
    await inventoryDb.removeItem(userId, "tool_water_cooler", updatedIndexes.length);
  } catch (error) {
    // Rollback: revert slots to prepared
    for (const idx of updatedIndexes) {
      await updateSlotState(userId, idx, "hydrated", "prepared");
    }
    throw error;
  }

  return { success: true, updated: updatedIndexes.length };
}

/**
 * Draft a rookie into a hydrated slot
 * @param {string} userId
 * @param {number} slotIndex
 * @param {string} position - QB, RB, WR, TE
 * @returns {Promise<{success: boolean, slot?: object, error?: string}>}
 */
export async function draftRookie(userId, slotIndex, position) {
  const posConfig = getPosition(position);
  if (!posConfig) {
    return { success: false, error: "INVALID_POSITION" };
  }

  // Check contract
  const contractQty = await inventoryDb.getItemQuantity(userId, posConfig.contractItemType);
  if (contractQty < 1) {
    return { success: false, error: "NO_CONTRACT", position };
  }

  // Calculate timestamps
  const now = new Date();
  const readyAt = new Date(now.getTime() + posConfig.trainTimeMinutes * 60 * 1000);
  const wiltsAt = new Date(readyAt.getTime() + posConfig.wiltWindowMinutes * 60 * 1000);

  // Update slot
  const slot = await updateSlotState(userId, slotIndex, "hydrated", "training", position, {
    planted_at: now,
    ready_at: readyAt,
    wilts_at: wiltsAt,
  });

  if (!slot) {
    return { success: false, error: "SLOT_NOT_HYDRATED" };
  }

  // Consume contract - rollback on failure
  try {
    await inventoryDb.removeItem(userId, posConfig.contractItemType, 1);
  } catch (error) {
    // Rollback: revert slot to hydrated
    await updateSlotState(userId, slotIndex, "training", "hydrated", null, null);
    throw error;
  }

  return { success: true, slot };
}

/**
 * Graduate a ready player to inventory
 * @param {string} userId
 * @param {number} slotIndex
 * @returns {Promise<{success: boolean, value?: number, position?: string, error?: string}>}
 */
export async function graduateSlot(userId, slotIndex) {
  // Get current slot
  const slot = await getSlot(userId, slotIndex);
  if (!slot || slot.state !== "ready") {
    return { success: false, error: "NOT_READY" };
  }

  const position = slot.rookie_type;
  const posConfig = getPosition(position);
  if (!posConfig) {
    return { success: false, error: "INVALID_POSITION" };
  }

  // Calculate random graduation value
  const value = calculateGraduationValue(position);

  // Clear slot FIRST (atomic - prevents duplicate graduation)
  const cleared = await updateSlotState(userId, slotIndex, "ready", "empty", null, null);
  if (!cleared) {
    return { success: false, error: "NOT_READY" };
  }

  // Increment total_graduated
  await sql`
    UPDATE training_grounds
    SET total_graduated = total_graduated + 1
    WHERE user_id = ${userId}
  `;

  // Add rookie to inventory (slot already cleared, safe from duplicates)
  await inventoryDb.addItem(userId, posConfig.rookieItemType, 1, value);

  return { success: true, value, position };
}

/**
 * Clear a busted slot
 * @param {string} userId
 * @param {number} slotIndex
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function clearBustedSlot(userId, slotIndex) {
  const slot = await updateSlotState(userId, slotIndex, "busted", "empty", null, null);

  if (!slot) {
    return { success: false, error: "NOT_BUSTED" };
  }

  return { success: true };
}

// ============ Timer Operations ============

/**
 * Check for training → ready transitions
 * @param {string} userId
 * @returns {Promise<number>} - Number of slots that became ready
 */
export async function checkTrainingComplete(userId) {
  const result = await sql`
    UPDATE training_slots
    SET state = 'ready'
    WHERE user_id = ${userId}
      AND state = 'training'
      AND ready_at <= NOW()
    RETURNING *
  `;
  return result.rows.length;
}

/**
 * Check for ready → busted transitions (wilted)
 * @param {string} userId
 * @returns {Promise<number>} - Number of slots that busted
 */
export async function checkAndUpdateWilted(userId) {
  const result = await sql`
    UPDATE training_slots
    SET state = 'busted'
    WHERE user_id = ${userId}
      AND state = 'ready'
      AND wilts_at <= NOW()
    RETURNING *
  `;

  // Increment total_busted if any wilted
  if (result.rows.length > 0) {
    await sql`
      UPDATE training_grounds
      SET total_busted = total_busted + ${result.rows.length}
      WHERE user_id = ${userId}
    `;
  }

  return result.rows.length;
}

/**
 * Refresh all slot states (training→ready, ready→busted)
 * Call this before displaying grid
 * @param {string} userId
 * @returns {Promise<{becameReady: number, busted: number}>}
 */
export async function refreshSlotStates(userId) {
  const becameReady = await checkTrainingComplete(userId);
  const busted = await checkAndUpdateWilted(userId);
  return { becameReady, busted };
}
