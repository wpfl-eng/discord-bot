import { TRAINING_CONFIG, getPosition, getState } from './trainingConfig.js';

/**
 * Get the emoji for a slot based on its state
 * @param {object} slot - Slot from database
 * @returns {string} - Emoji to display
 */
export function getSlotEmoji(slot) {
  const state = slot.state;

  // Training state uses position emoji
  if (state === 'training' && slot.rookie_type) {
    const pos = getPosition(slot.rookie_type);
    return pos?.emoji || '🏈';
  }

  // Ready state - could show position or star
  if (state === 'ready') {
    return TRAINING_CONFIG.STATES.READY.emoji;
  }

  // Busted state
  if (state === 'busted') {
    return TRAINING_CONFIG.STATES.BUSTED.emoji;
  }

  // Other states use their defined emoji
  const stateConfig = getState(state);
  return stateConfig?.emoji || '❓';
}

/**
 * Render the 3x3 training grid
 * @param {array} slots - Array of 9 slots (ordered by slot_index)
 * @returns {string} - Grid display string
 */
export function renderGrid(slots) {
  // Ensure we have 9 slots, fill with empty if missing
  const grid = [];
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

/**
 * Format time remaining until a date
 * @param {Date|string} targetDate
 * @returns {string} - "5m 32s", "Ready!", or "Overdue"
 */
export function formatTimeRemaining(targetDate) {
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
 * @param {array} slots
 * @returns {{slot: object, timeRemaining: string}|null}
 */
export function getNextReadySlot(slots) {
  const trainingSlots = slots.filter((s) => s.state === 'training' && s.ready_at);

  if (trainingSlots.length === 0) return null;

  // Sort by ready_at ascending
  trainingSlots.sort((a, b) => new Date(a.ready_at) - new Date(b.ready_at));

  const nextSlot = trainingSlots[0];
  return {
    slot: nextSlot,
    timeRemaining: formatTimeRemaining(nextSlot.ready_at),
  };
}

/**
 * Get status summary of slots
 * @param {array} slots
 * @returns {{empty: number, prepared: number, hydrated: number, training: number, ready: number, busted: number}}
 */
export function getStatusSummary(slots) {
  const summary = {
    empty: 0,
    prepared: 0,
    hydrated: 0,
    training: 0,
    ready: 0,
    busted: 0,
  };

  for (const slot of slots) {
    if (Object.hasOwn(summary, slot.state)) {
      summary[slot.state]++;
    }
  }

  return summary;
}

/**
 * Build status text for embed
 * @param {array} slots
 * @returns {string}
 */
export function buildStatusText(slots) {
  const summary = getStatusSummary(slots);
  const lines = [];

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

/**
 * Get slots that can perform a specific action
 * @param {array} slots
 * @param {string} action - "setup", "hydrate", "draft", "graduate", "clear"
 * @returns {array} - Slots that can perform this action
 */
export function getActionableSlots(slots, action) {
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
 * @param {array} slots
 * @returns {string} - "1, 2, 3" or "none"
 */
export function formatSlotNumbers(slots) {
  if (slots.length === 0) return 'none';
  return slots.map((s) => s.slot_index + 1).join(', ');
}
