// Training Utility Functions
// Grid rendering, time formatting, and slot management helpers

import { TRAINING_CONFIG, getPosition, getState } from './trainingConfig.js';
import type { TrainingSlot } from './trainingDb.js';

// Re-export TrainingSlot for consumers that import from utils
export type { TrainingSlot };

export interface StatusSummary {
  empty: number;
  prepared: number;
  hydrated: number;
  training: number;
  ready: number;
  busted: number;
}

export interface NextReadySlot {
  readonly slot: TrainingSlot;
  readonly timeRemaining: string;
}

export type ActionType = 'setup' | 'hydrate' | 'draft' | 'graduate' | 'clear';

// ============ SLOT DISPLAY ============

/**
 * Get the emoji for a slot based on its state
 * @param slot - Slot from database
 * @returns Emoji to display
 */
export function getSlotEmoji(slot: TrainingSlot): string {
  const state = slot.state;

  // Training state uses position emoji
  if (state === 'training' && slot.rookie_type) {
    const pos = getPosition(slot.rookie_type);
    return pos?.emoji || '🏈';
  }

  // Ready state - could show position or star
  if (state === 'ready') {
    return TRAINING_CONFIG.STATES.READY.emoji ?? '⭐';
  }

  // Busted state
  if (state === 'busted') {
    return TRAINING_CONFIG.STATES.BUSTED.emoji ?? '💀';
  }

  // Other states use their defined emoji
  const stateConfig = getState(state);
  return stateConfig?.emoji || '❓';
}

/**
 * Render the 3x3 training grid
 * @param slots - Array of 9 slots (ordered by slot_index)
 * @returns Grid display string
 */
export function renderGrid(slots: TrainingSlot[]): string {
  // Ensure we have 9 slots, fill with empty if missing
  const grid: string[] = [];
  for (let i = 0; i < 9; i++) {
    const slot = slots.find((s) => s.slot_index === i);
    grid.push(slot ? getSlotEmoji(slot) : '⬛');
  }

  // Build 3x3 display
  const lines = [
    `  ${grid[0]} | ${grid[1]} | ${grid[2]}`,
    ` ----+----+----`,
    `  ${grid[3]} | ${grid[4]} | ${grid[5]}`,
    ` ----+----+----`,
    `  ${grid[6]} | ${grid[7]} | ${grid[8]}`,
  ];

  return lines.join('\n');
}

// ============ TIME FORMATTING ============

/**
 * Format time remaining until a date
 * @param targetDate - Target date/time
 * @returns Formatted time string like "5m 32s", "Ready!", or "Unknown"
 */
export function formatTimeRemaining(targetDate: Date | string | null | undefined): string {
  if (!targetDate) return 'Unknown';

  const target = new Date(targetDate);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return 'Ready!';

  const diffSec = Math.floor(diffMs / 1000);
  const minutes = Math.floor(diffSec / 60);
  const seconds = diffSec % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Get the next slot that will become ready
 * @param slots - Array of training slots
 * @returns Object with slot and timeRemaining, or null if no training slots
 */
export function getNextReadySlot(slots: TrainingSlot[]): NextReadySlot | null {
  const trainingSlots = slots.filter((s) => s.state === 'training' && s.ready_at);

  if (trainingSlots.length === 0) return null;

  // Sort by ready_at ascending
  trainingSlots.sort(
    (a, b) => new Date(a.ready_at!).getTime() - new Date(b.ready_at!).getTime()
  );

  const nextSlot = trainingSlots[0];
  return {
    slot: nextSlot,
    timeRemaining: formatTimeRemaining(nextSlot.ready_at),
  };
}

// ============ STATUS FUNCTIONS ============

/**
 * Get status summary of slots
 * @param slots - Array of training slots
 * @returns Object with counts for each state
 */
export function getStatusSummary(slots: TrainingSlot[]): StatusSummary {
  const summary: StatusSummary = {
    empty: 0,
    prepared: 0,
    hydrated: 0,
    training: 0,
    ready: 0,
    busted: 0,
  };

  for (const slot of slots) {
    if (Object.hasOwn(summary, slot.state)) {
      summary[slot.state as keyof StatusSummary]++;
    }
  }

  return summary;
}

/**
 * Build status text for embed
 * @param slots - Array of training slots
 * @returns Formatted status text
 */
export function buildStatusText(slots: TrainingSlot[]): string {
  const summary = getStatusSummary(slots);
  const lines: string[] = [];

  if (summary.ready > 0) {
    lines.push(`⭐ **${summary.ready}** player${summary.ready > 1 ? 's' : ''} ready to graduate!`);
  }

  if (summary.training > 0) {
    const next = getNextReadySlot(slots);
    const nextText = next ? ` (next: ${next.timeRemaining})` : '';
    lines.push(`🏈 **${summary.training}** in training${nextText}`);
  }

  if (summary.busted > 0) {
    lines.push(`💀 **${summary.busted}** busted (clear to reuse)`);
  }

  if (summary.hydrated > 0) {
    lines.push(`💧 **${summary.hydrated}** ready for drafting`);
  }

  if (summary.prepared > 0) {
    lines.push(`🟫 **${summary.prepared}** prepared (needs hydration)`);
  }

  if (summary.empty > 0) {
    lines.push(`⬛ **${summary.empty}** empty slot${summary.empty > 1 ? 's' : ''}`);
  }

  return lines.length > 0 ? lines.join('\n') : 'All slots empty - set up to get started!';
}

// ============ ACTION FUNCTIONS ============

/**
 * Get slots that can perform a specific action
 * @param slots - Array of training slots
 * @param action - Action type
 * @returns Slots that can perform this action
 */
export function getActionableSlots(slots: TrainingSlot[], action: ActionType): TrainingSlot[] {
  switch (action) {
    case 'setup':
      return slots.filter((s) => s.state === 'empty');
    case 'hydrate':
      return slots.filter((s) => s.state === 'prepared');
    case 'draft':
      return slots.filter((s) => s.state === 'hydrated');
    case 'graduate':
      return slots.filter((s) => s.state === 'ready');
    case 'clear':
      return slots.filter((s) => s.state === 'busted');
    default:
      return [];
  }
}

/**
 * Get slot numbers as display string
 * @param slots - Array of training slots
 * @returns Comma-separated slot numbers (1-indexed) or "none"
 */
export function formatSlotNumbers(slots: TrainingSlot[]): string {
  if (slots.length === 0) return 'none';
  return slots.map((s) => s.slot_index + 1).join(', ');
}
