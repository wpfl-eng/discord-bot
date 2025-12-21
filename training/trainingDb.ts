// Training Database Operations
// CRUD operations for the training ground system

import { sql } from '@vercel/postgres';
import * as inventoryDb from '../inventory/inventoryDb.js';
import { TRAINING_CONFIG, getPosition, calculateGraduationValue, type StateName } from './trainingConfig.js';

// ============ Type Definitions ============

/**
 * Training ground record from training_grounds table
 */
export interface TrainingGround {
  readonly user_id: string;
  readonly username: string;
  readonly total_graduated: number;
  readonly total_busted: number;
  readonly notify_ready: boolean;
  readonly last_notified_at: Date | null;
  readonly created_at: Date;
}

/**
 * Training slot record from training_slots table
 */
export interface TrainingSlot {
  readonly id: number;
  readonly user_id: string;
  readonly slot_index: number;
  readonly state: StateName;
  readonly rookie_type: string | null;
  readonly planted_at: Date | null;
  readonly ready_at: Date | null;
  readonly wilts_at: Date | null;
}

/**
 * Timestamps for training slot transitions
 */
export interface SlotTimestamps {
  readonly planted_at?: Date | null;
  readonly ready_at?: Date | null;
  readonly wilts_at?: Date | null;
}

/**
 * Result of getOrCreateTrainingGround
 */
export interface TrainingGroundResult {
  readonly ground: TrainingGround;
  readonly slots: TrainingSlot[];
  readonly isNew: boolean;
}

/**
 * Setup/Hydrate operation error types
 */
export type SlotOperationError =
  | 'NO_SLOTS_SELECTED'
  | 'INSUFFICIENT_TOOLS'
  | 'NO_EMPTY_SLOTS'
  | 'NO_PREPARED_SLOTS';

/**
 * Draft rookie error types
 */
export type DraftError =
  | 'INVALID_POSITION'
  | 'NO_CONTRACT'
  | 'SLOT_NOT_HYDRATED';

/**
 * Graduate slot error types
 */
export type GraduateError = 'NOT_READY' | 'INVALID_POSITION';

/**
 * Clear busted slot error types
 */
export type ClearError = 'NOT_BUSTED';

/**
 * Successful slot operation result
 */
export interface SlotOperationSuccess {
  readonly success: true;
  readonly updated: number;
}

/**
 * Failed slot operation result
 */
export interface SlotOperationFailure {
  readonly success: false;
  readonly updated: number;
  readonly error: SlotOperationError;
  readonly needed?: number;
  readonly have?: number;
}

/**
 * Slot operation result (discriminated union)
 */
export type SlotOperationResult = SlotOperationSuccess | SlotOperationFailure;

/**
 * Successful draft result
 */
export interface DraftSuccess {
  readonly success: true;
  readonly slot: TrainingSlot;
}

/**
 * Failed draft result
 */
export interface DraftFailure {
  readonly success: false;
  readonly error: DraftError;
  readonly position?: string;
}

/**
 * Draft result (discriminated union)
 */
export type DraftResult = DraftSuccess | DraftFailure;

/**
 * Successful graduate result
 */
export interface GraduateSuccess {
  readonly success: true;
  readonly value: number;
  readonly position: string;
}

/**
 * Failed graduate result
 */
export interface GraduateFailure {
  readonly success: false;
  readonly error: GraduateError;
}

/**
 * Graduate result (discriminated union)
 */
export type GraduateResult = GraduateSuccess | GraduateFailure;

/**
 * Successful clear result
 */
export interface ClearSuccess {
  readonly success: true;
}

/**
 * Failed clear result
 */
export interface ClearFailure {
  readonly success: false;
  readonly error: ClearError;
}

/**
 * Clear result (discriminated union)
 */
export type ClearResult = ClearSuccess | ClearFailure;

/**
 * Refresh slot states result
 */
export interface RefreshResult {
  readonly becameReady: number;
  readonly busted: number;
}

/**
 * User needing notification
 */
export interface NotificationUser {
  readonly user_id: string;
  readonly username: string;
  readonly ready_count: string; // COUNT returns string
}

// ============ Read Operations ============

/**
 * Get a user's training ground
 * @param userId - Discord user ID
 * @returns Training ground or null
 */
export async function getTrainingGround(userId: string): Promise<TrainingGround | null> {
  const result = await sql<TrainingGround>`
    SELECT * FROM training_grounds
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Get all training slots for a user (ordered by slot_index)
 * @param userId - Discord user ID
 * @returns Array of training slots
 */
export async function getTrainingSlots(userId: string): Promise<TrainingSlot[]> {
  const result = await sql<TrainingSlot>`
    SELECT * FROM training_slots
    WHERE user_id = ${userId}
    ORDER BY slot_index
  `;
  return result.rows;
}

/**
 * Get slots filtered by state
 * @param userId - Discord user ID
 * @param state - Slot state to filter by
 * @returns Array of training slots
 */
export async function getSlotsByState(
  userId: string,
  state: string
): Promise<TrainingSlot[]> {
  const result = await sql<TrainingSlot>`
    SELECT * FROM training_slots
    WHERE user_id = ${userId}
      AND state = ${state}
    ORDER BY slot_index
  `;
  return result.rows;
}

/**
 * Get a single slot by index
 * @param userId - Discord user ID
 * @param slotIndex - Slot index (0-8)
 * @returns Training slot or null
 */
export async function getSlot(
  userId: string,
  slotIndex: number
): Promise<TrainingSlot | null> {
  const result = await sql<TrainingSlot>`
    SELECT * FROM training_slots
    WHERE user_id = ${userId}
      AND slot_index = ${slotIndex}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

// ============ Write Operations ============

/**
 * Create a new training ground with 9 empty slots
 * @param userId - Discord user ID
 * @param username - Discord username
 * @returns Training ground result with ground, slots, and isNew flag
 */
export async function getOrCreateTrainingGround(
  userId: string,
  username: string
): Promise<TrainingGroundResult> {
  // Check if exists
  let ground = await getTrainingGround(userId);

  if (ground) {
    const slots = await getTrainingSlots(userId);
    return { ground, slots, isNew: false };
  }

  // Create new training ground
  const groundResult = await sql<TrainingGround>`
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
 * @param userId - Discord user ID
 * @param slotIndex - Slot index
 * @param fromState - Current state (for validation)
 * @param toState - New state
 * @param rookieType - Position if training, null otherwise
 * @param timestamps - Timestamps for training slots
 * @returns Updated slot or null
 */
export async function updateSlotState(
  userId: string,
  slotIndex: number,
  fromState: string,
  toState: string,
  rookieType: string | null = null,
  timestamps: SlotTimestamps | null = null
): Promise<TrainingSlot | null> {
  // Convert Date objects to ISO strings for SQL
  const plantedAt = timestamps?.planted_at instanceof Date
    ? timestamps.planted_at.toISOString()
    : timestamps?.planted_at ?? null;
  const readyAt = timestamps?.ready_at instanceof Date
    ? timestamps.ready_at.toISOString()
    : timestamps?.ready_at ?? null;
  const wiltsAt = timestamps?.wilts_at instanceof Date
    ? timestamps.wilts_at.toISOString()
    : timestamps?.wilts_at ?? null;

  const result = await sql<TrainingSlot>`
    UPDATE training_slots
    SET
      state = ${toState},
      rookie_type = ${rookieType},
      planted_at = ${plantedAt},
      ready_at = ${readyAt},
      wilts_at = ${wiltsAt}
    WHERE user_id = ${userId}
      AND slot_index = ${slotIndex}
      AND state = ${fromState}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Setup slots (empty → prepared) - consumes Setup Kit
 * @param userId - Discord user ID
 * @param slotIndexes - Array of slot indexes to setup
 * @returns Slot operation result
 */
export async function setupSlots(
  userId: string,
  slotIndexes: number[]
): Promise<SlotOperationResult> {
  if (slotIndexes.length === 0) {
    return { success: false, updated: 0, error: 'NO_SLOTS_SELECTED' };
  }

  // Check tool quantity
  const quantity = await inventoryDb.getItemQuantity(userId, 'tool_setup_kit');
  if (quantity < slotIndexes.length) {
    return {
      success: false,
      updated: 0,
      error: 'INSUFFICIENT_TOOLS',
      needed: slotIndexes.length,
      have: quantity,
    };
  }

  // Update each slot atomically, track which ones succeeded
  const updatedIndexes: number[] = [];
  for (const slotIndex of slotIndexes) {
    const result = await updateSlotState(userId, slotIndex, 'empty', 'prepared');
    if (result) updatedIndexes.push(slotIndex);
  }

  if (updatedIndexes.length === 0) {
    return { success: false, updated: 0, error: 'NO_EMPTY_SLOTS' };
  }

  // Consume tools - rollback on failure
  try {
    await inventoryDb.removeItem(userId, 'tool_setup_kit', updatedIndexes.length);
  } catch (error) {
    // Rollback: revert slots to empty
    for (const idx of updatedIndexes) {
      await updateSlotState(userId, idx, 'prepared', 'empty');
    }
    throw error;
  }

  return { success: true, updated: updatedIndexes.length };
}

/**
 * Hydrate slots (prepared → hydrated) - consumes Water Cooler
 * @param userId - Discord user ID
 * @param slotIndexes - Array of slot indexes to hydrate
 * @returns Slot operation result
 */
export async function hydrateSlots(
  userId: string,
  slotIndexes: number[]
): Promise<SlotOperationResult> {
  if (slotIndexes.length === 0) {
    return { success: false, updated: 0, error: 'NO_SLOTS_SELECTED' };
  }

  // Check tool quantity
  const quantity = await inventoryDb.getItemQuantity(userId, 'tool_water_cooler');
  if (quantity < slotIndexes.length) {
    return {
      success: false,
      updated: 0,
      error: 'INSUFFICIENT_TOOLS',
      needed: slotIndexes.length,
      have: quantity,
    };
  }

  // Update each slot atomically, track which ones succeeded
  const updatedIndexes: number[] = [];
  for (const slotIndex of slotIndexes) {
    const result = await updateSlotState(userId, slotIndex, 'prepared', 'hydrated');
    if (result) updatedIndexes.push(slotIndex);
  }

  if (updatedIndexes.length === 0) {
    return { success: false, updated: 0, error: 'NO_PREPARED_SLOTS' };
  }

  // Consume tools - rollback on failure
  try {
    await inventoryDb.removeItem(userId, 'tool_water_cooler', updatedIndexes.length);
  } catch (error) {
    // Rollback: revert slots to prepared
    for (const idx of updatedIndexes) {
      await updateSlotState(userId, idx, 'hydrated', 'prepared');
    }
    throw error;
  }

  return { success: true, updated: updatedIndexes.length };
}

/**
 * Draft a rookie into a hydrated slot
 * @param userId - Discord user ID
 * @param slotIndex - Slot index
 * @param position - QB, RB, WR, TE
 * @returns Draft result
 */
export async function draftRookie(
  userId: string,
  slotIndex: number,
  position: string
): Promise<DraftResult> {
  const posConfig = getPosition(position);
  if (!posConfig) {
    return { success: false, error: 'INVALID_POSITION' };
  }

  // Check contract
  const contractQty = await inventoryDb.getItemQuantity(userId, posConfig.contractItemType);
  if (contractQty < 1) {
    return { success: false, error: 'NO_CONTRACT', position };
  }

  // Calculate timestamps
  const now = new Date();
  const readyAt = new Date(now.getTime() + posConfig.trainTimeMinutes * 60 * 1000);
  const wiltsAt = new Date(readyAt.getTime() + posConfig.wiltWindowMinutes * 60 * 1000);

  // Update slot
  const slot = await updateSlotState(userId, slotIndex, 'hydrated', 'training', position, {
    planted_at: now,
    ready_at: readyAt,
    wilts_at: wiltsAt,
  });

  if (!slot) {
    return { success: false, error: 'SLOT_NOT_HYDRATED' };
  }

  // Consume contract - rollback on failure
  try {
    await inventoryDb.removeItem(userId, posConfig.contractItemType, 1);
  } catch (error) {
    // Rollback: revert slot to hydrated
    await updateSlotState(userId, slotIndex, 'training', 'hydrated', null, null);
    throw error;
  }

  return { success: true, slot };
}

/**
 * Graduate a ready player to inventory
 * @param userId - Discord user ID
 * @param slotIndex - Slot index
 * @returns Graduate result
 */
export async function graduateSlot(
  userId: string,
  slotIndex: number
): Promise<GraduateResult> {
  // Get current slot
  const slot = await getSlot(userId, slotIndex);
  if (!slot || slot.state !== 'ready') {
    return { success: false, error: 'NOT_READY' };
  }

  const position = slot.rookie_type;
  if (!position) {
    return { success: false, error: 'INVALID_POSITION' };
  }

  const posConfig = getPosition(position);
  if (!posConfig) {
    return { success: false, error: 'INVALID_POSITION' };
  }

  // Calculate random graduation value
  const value = calculateGraduationValue(position);

  // Clear slot FIRST (atomic - prevents duplicate graduation)
  const cleared = await updateSlotState(userId, slotIndex, 'ready', 'empty', null, null);
  if (!cleared) {
    return { success: false, error: 'NOT_READY' };
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
 * @param userId - Discord user ID
 * @param slotIndex - Slot index
 * @returns Clear result
 */
export async function clearBustedSlot(
  userId: string,
  slotIndex: number
): Promise<ClearResult> {
  const slot = await updateSlotState(userId, slotIndex, 'busted', 'empty', null, null);

  if (!slot) {
    return { success: false, error: 'NOT_BUSTED' };
  }

  return { success: true };
}

// ============ Timer Operations ============

/**
 * Check for training → ready transitions
 * @param userId - Discord user ID
 * @returns Number of slots that became ready
 */
export async function checkTrainingComplete(userId: string): Promise<number> {
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
 * @param userId - Discord user ID
 * @returns Number of slots that busted
 */
export async function checkAndUpdateWilted(userId: string): Promise<number> {
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
 * @param userId - Discord user ID
 * @returns Refresh result with counts
 */
export async function refreshSlotStates(userId: string): Promise<RefreshResult> {
  const becameReady = await checkTrainingComplete(userId);
  const busted = await checkAndUpdateWilted(userId);
  return { becameReady, busted };
}

// ============ Notification Operations ============

/**
 * Update user's notification setting
 * @param userId - Discord user ID
 * @param enabled - Whether notifications are enabled
 * @returns Updated training ground or null
 */
export async function updateNotificationSetting(
  userId: string,
  enabled: boolean
): Promise<TrainingGround | null> {
  const result = await sql<TrainingGround>`
    UPDATE training_grounds
    SET notify_ready = ${enabled}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Update last notification timestamp
 * @param userId - Discord user ID
 */
export async function updateLastNotified(userId: string): Promise<void> {
  await sql`
    UPDATE training_grounds
    SET last_notified_at = NOW()
    WHERE user_id = ${userId}
  `;
}

/**
 * Get users who need notification (ready players + opted in + cooldown expired)
 * @returns Array of users needing notification
 */
export async function getUsersNeedingNotification(): Promise<NotificationUser[]> {
  const result = await sql<NotificationUser>`
    SELECT
      tg.user_id,
      tg.username,
      COUNT(ts.id) as ready_count
    FROM training_grounds tg
    JOIN training_slots ts ON tg.user_id = ts.user_id
    WHERE tg.notify_ready = true
      AND ts.state = 'ready'
      AND (tg.last_notified_at IS NULL
           OR tg.last_notified_at < NOW() - INTERVAL '30 minutes')
    GROUP BY tg.user_id, tg.username
  `;
  return result.rows;
}
