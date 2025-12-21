import { describe, test, expect } from '@jest/globals';
import {
  getSlotEmoji,
  renderGrid,
  formatTimeRemaining,
  getNextReadySlot,
  getStatusSummary,
  buildStatusText,
  getActionableSlots,
  formatSlotNumbers,
  TrainingSlot,
  ActionType,
} from '../../training/trainingUtils.js';
import { TRAINING_CONFIG, StateName } from '../../training/trainingConfig.js';

// ============ TEST HELPERS ============

function createSlot(
  index: number,
  state: StateName,
  extras: Partial<TrainingSlot> = {}
): TrainingSlot {
  return {
    id: 1,
    user_id: 'test-user',
    slot_index: index,
    state,
    rookie_type: null,
    planted_at: null,
    ready_at: null,
    wilts_at: null,
    ...extras,
  };
}

describe('trainingUtils', () => {
  // ============ getSlotEmoji TESTS ============

  describe('getSlotEmoji', () => {
    test('returns position emoji for training state with rookie_type', () => {
      const slot = createSlot(0, 'training', { rookie_type: 'QB' });
      const emoji = getSlotEmoji(slot);
      // Should return the QB position emoji
      expect(emoji).toBe(TRAINING_CONFIG.POSITIONS.QB.emoji);
    });

    test('returns star for ready state', () => {
      const slot = createSlot(0, 'ready');
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe(TRAINING_CONFIG.STATES.READY.emoji);
    });

    test('returns skull for busted state', () => {
      const slot = createSlot(0, 'busted');
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe(TRAINING_CONFIG.STATES.BUSTED.emoji);
    });

    test('returns state emoji for empty state', () => {
      const slot = createSlot(0, 'empty');
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe(TRAINING_CONFIG.STATES.EMPTY.emoji);
    });

    test('returns state emoji for prepared state', () => {
      const slot = createSlot(0, 'prepared');
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe(TRAINING_CONFIG.STATES.PREPARED.emoji);
    });

    test('returns state emoji for hydrated state', () => {
      const slot = createSlot(0, 'hydrated');
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe(TRAINING_CONFIG.STATES.HYDRATED.emoji);
    });

    test('returns fallback emoji for unknown state', () => {
      const slot = createSlot(0, 'unknown_state' as StateName);
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe('❓');
    });

    test('returns fallback for training state without rookie_type', () => {
      const slot = createSlot(0, 'training', { rookie_type: undefined });
      const emoji = getSlotEmoji(slot);
      // Should fallback since no rookie_type
      expect(typeof emoji).toBe('string');
    });

    test('returns fallback for training state with unknown rookie_type', () => {
      const slot = createSlot(0, 'training', { rookie_type: 'UNKNOWN' });
      const emoji = getSlotEmoji(slot);
      expect(emoji).toBe('🏈'); // Fallback from getPosition returning null
    });
  });

  // ============ renderGrid TESTS ============

  describe('renderGrid', () => {
    test('returns 3x3 grid format with separators', () => {
      const slots: TrainingSlot[] = [];
      const result = renderGrid(slots);

      expect(result).toContain('|');
      expect(result).toContain('----+----+----');
      expect(result.split('\n')).toHaveLength(5);
    });

    test('fills missing slots with empty emoji', () => {
      const slots: TrainingSlot[] = [];
      const result = renderGrid(slots);

      // Should have 9 black squares for empty
      const blackSquareCount = (result.match(/⬛/g) || []).length;
      expect(blackSquareCount).toBe(9);
    });

    test('handles empty slots array', () => {
      const result = renderGrid([]);
      expect(result).toContain('⬛');
      expect(result.split('\n')).toHaveLength(5);
    });

    test('shows correct emojis for slots with states', () => {
      const slots = [
        createSlot(0, 'ready'),
        createSlot(1, 'busted'),
        createSlot(2, 'empty'),
      ];
      const result = renderGrid(slots);

      expect(result).toContain(TRAINING_CONFIG.STATES.READY.emoji);
      expect(result).toContain(TRAINING_CONFIG.STATES.BUSTED.emoji);
      expect(result).toContain(TRAINING_CONFIG.STATES.EMPTY.emoji);
    });

    test('handles slots at various positions', () => {
      const slots = [
        createSlot(4, 'ready'), // Center slot
        createSlot(8, 'busted'), // Bottom right
      ];
      const result = renderGrid(slots);

      // Verify the grid structure has our emojis
      expect(result).toContain(TRAINING_CONFIG.STATES.READY.emoji);
      expect(result).toContain(TRAINING_CONFIG.STATES.BUSTED.emoji);
    });
  });

  // ============ formatTimeRemaining TESTS ============

  describe('formatTimeRemaining', () => {
    test('returns "Ready!" for past dates', () => {
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      expect(formatTimeRemaining(pastDate)).toBe('Ready!');
    });

    test('returns "Ready!" for current time', () => {
      const now = new Date();
      expect(formatTimeRemaining(now)).toBe('Ready!');
    });

    test('returns seconds for <1 minute', () => {
      const futureDate = new Date(Date.now() + 30000); // 30 seconds
      const result = formatTimeRemaining(futureDate);
      expect(result).toMatch(/^\d+s$/);
    });

    test('returns minutes and seconds for <60 minutes', () => {
      const futureDate = new Date(Date.now() + 150000); // 2.5 minutes
      const result = formatTimeRemaining(futureDate);
      expect(result).toMatch(/^\d+m \d+s$/);
    });

    test('returns hours and minutes for >=60 minutes', () => {
      const futureDate = new Date(Date.now() + 7200000); // 2 hours
      const result = formatTimeRemaining(futureDate);
      expect(result).toMatch(/^\d+h \d+m$/);
    });

    test('returns "Unknown" for null/undefined', () => {
      expect(formatTimeRemaining(null)).toBe('Unknown');
      expect(formatTimeRemaining(undefined)).toBe('Unknown');
    });

    test('handles date strings', () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      const result = formatTimeRemaining(futureDate);
      expect(result).not.toBe('Unknown');
      // Should be around 1m or less
      expect(result).toMatch(/^\d+[msh]/);
    });

    test('handles invalid date strings gracefully', () => {
      // Invalid date results in NaN which is handled
      const result = formatTimeRemaining('not-a-date');
      // The function will create an invalid Date, getTime() returns NaN
      // NaN - now.getTime() = NaN, NaN <= 0 is false
      // So it won't be "Ready!", it'll proceed and may produce weird output
      // Let's check it doesn't throw
      expect(typeof result).toBe('string');
    });
  });

  // ============ getNextReadySlot TESTS ============

  describe('getNextReadySlot', () => {
    test('returns earliest training slot', () => {
      const now = Date.now();
      const slots = [
        createSlot(0, 'training', { ready_at: new Date(now + 60000) }), // 1 min
        createSlot(1, 'training', { ready_at: new Date(now + 30000) }), // 30 sec - earliest
        createSlot(2, 'training', { ready_at: new Date(now + 120000) }), // 2 min
      ];

      const result = getNextReadySlot(slots);
      expect(result).not.toBeNull();
      expect(result!.slot.slot_index).toBe(1);
      expect(typeof result!.timeRemaining).toBe('string');
    });

    test('returns null for no training slots', () => {
      const slots = [
        createSlot(0, 'empty'),
        createSlot(1, 'ready'),
        createSlot(2, 'busted'),
      ];

      const result = getNextReadySlot(slots);
      expect(result).toBeNull();
    });

    test('returns null for empty slots array', () => {
      const result = getNextReadySlot([]);
      expect(result).toBeNull();
    });

    test('ignores training slots without ready_at', () => {
      const slots = [
        createSlot(0, 'training', { ready_at: null }),
        createSlot(1, 'training', { ready_at: undefined }),
      ];

      const result = getNextReadySlot(slots);
      expect(result).toBeNull();
    });

    test('includes timeRemaining in result', () => {
      const futureDate = new Date(Date.now() + 60000);
      const slots = [createSlot(0, 'training', { ready_at: futureDate })];

      const result = getNextReadySlot(slots);
      expect(result).not.toBeNull();
      expect(result!.timeRemaining).toBeDefined();
      expect(typeof result!.timeRemaining).toBe('string');
    });
  });

  // ============ getStatusSummary TESTS ============

  describe('getStatusSummary', () => {
    test('counts each state correctly', () => {
      const slots = [
        createSlot(0, 'empty'),
        createSlot(1, 'empty'),
        createSlot(2, 'prepared'),
        createSlot(3, 'hydrated'),
        createSlot(4, 'training'),
        createSlot(5, 'training'),
        createSlot(6, 'ready'),
        createSlot(7, 'busted'),
        createSlot(8, 'busted'),
      ];

      const summary = getStatusSummary(slots);
      expect(summary.empty).toBe(2);
      expect(summary.prepared).toBe(1);
      expect(summary.hydrated).toBe(1);
      expect(summary.training).toBe(2);
      expect(summary.ready).toBe(1);
      expect(summary.busted).toBe(2);
    });

    test('returns zeros for empty array', () => {
      const summary = getStatusSummary([]);
      expect(summary.empty).toBe(0);
      expect(summary.prepared).toBe(0);
      expect(summary.hydrated).toBe(0);
      expect(summary.training).toBe(0);
      expect(summary.ready).toBe(0);
      expect(summary.busted).toBe(0);
    });

    test('ignores unknown states', () => {
      const slots = [
        createSlot(0, 'empty'),
        createSlot(1, 'unknown_state' as StateName),
      ];

      const summary = getStatusSummary(slots);
      expect(summary.empty).toBe(1);
      // Unknown state is not counted
      const total =
        summary.empty +
        summary.prepared +
        summary.hydrated +
        summary.training +
        summary.ready +
        summary.busted;
      expect(total).toBe(1);
    });
  });

  // ============ buildStatusText TESTS ============

  describe('buildStatusText', () => {
    test('includes ready count with emoji when ready slots exist', () => {
      const slots = [createSlot(0, 'ready'), createSlot(1, 'ready')];
      const text = buildStatusText(slots);
      expect(text).toContain('⭐');
      expect(text).toContain('**2**');
      expect(text).toContain('ready to graduate');
    });

    test('includes training count with next time when training slots exist', () => {
      const futureDate = new Date(Date.now() + 60000);
      const slots = [createSlot(0, 'training', { ready_at: futureDate })];
      const text = buildStatusText(slots);
      expect(text).toContain('🏈');
      expect(text).toContain('**1**');
      expect(text).toContain('in training');
      expect(text).toContain('next:');
    });

    test('shows fallback for empty slots', () => {
      const text = buildStatusText([]);
      expect(text).toContain('All slots empty');
    });

    test('includes busted count when busted slots exist', () => {
      const slots = [createSlot(0, 'busted')];
      const text = buildStatusText(slots);
      expect(text).toContain('💀');
      expect(text).toContain('busted');
    });

    test('includes hydrated count when hydrated slots exist', () => {
      const slots = [createSlot(0, 'hydrated')];
      const text = buildStatusText(slots);
      expect(text).toContain('💧');
      expect(text).toContain('ready for drafting');
    });

    test('includes prepared count when prepared slots exist', () => {
      const slots = [createSlot(0, 'prepared')];
      const text = buildStatusText(slots);
      expect(text).toContain('🟫');
      expect(text).toContain('needs hydration');
    });

    test('includes empty count when empty slots exist', () => {
      const slots = [createSlot(0, 'empty'), createSlot(1, 'empty')];
      const text = buildStatusText(slots);
      expect(text).toContain('⬛');
      expect(text).toContain('empty slot');
    });

    test('uses singular form for 1 item', () => {
      const slots = [createSlot(0, 'ready')];
      const text = buildStatusText(slots);
      expect(text).toContain('player ready'); // singular
      expect(text).not.toContain('players ready');
    });

    test('uses plural form for multiple items', () => {
      const slots = [createSlot(0, 'ready'), createSlot(1, 'ready')];
      const text = buildStatusText(slots);
      expect(text).toContain('players ready'); // plural
    });
  });

  // ============ getActionableSlots TESTS ============

  describe('getActionableSlots', () => {
    const allSlots = [
      createSlot(0, 'empty'),
      createSlot(1, 'prepared'),
      createSlot(2, 'hydrated'),
      createSlot(3, 'training'),
      createSlot(4, 'ready'),
      createSlot(5, 'busted'),
    ];

    test('returns empty slots for "setup"', () => {
      const result = getActionableSlots(allSlots, 'setup');
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe('empty');
    });

    test('returns prepared slots for "hydrate"', () => {
      const result = getActionableSlots(allSlots, 'hydrate');
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe('prepared');
    });

    test('returns hydrated slots for "draft"', () => {
      const result = getActionableSlots(allSlots, 'draft');
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe('hydrated');
    });

    test('returns ready slots for "graduate"', () => {
      const result = getActionableSlots(allSlots, 'graduate');
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe('ready');
    });

    test('returns busted slots for "clear"', () => {
      const result = getActionableSlots(allSlots, 'clear');
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe('busted');
    });

    test('returns empty array for unknown action', () => {
      const result = getActionableSlots(allSlots, 'unknown_action' as ActionType);
      expect(result).toEqual([]);
    });

    test('returns empty array when no matching slots', () => {
      const emptySlots: TrainingSlot[] = [];
      const result = getActionableSlots(emptySlots, 'setup');
      expect(result).toEqual([]);
    });

    test('returns multiple matching slots', () => {
      const slots = [
        createSlot(0, 'empty'),
        createSlot(1, 'empty'),
        createSlot(2, 'empty'),
      ];
      const result = getActionableSlots(slots, 'setup');
      expect(result).toHaveLength(3);
    });
  });

  // ============ formatSlotNumbers TESTS ============

  describe('formatSlotNumbers', () => {
    test('returns comma-separated slot numbers', () => {
      const slots = [createSlot(0, 'empty'), createSlot(1, 'empty'), createSlot(4, 'empty')];
      const result = formatSlotNumbers(slots);
      expect(result).toBe('1, 2, 5');
    });

    test('returns "none" for empty array', () => {
      const result = formatSlotNumbers([]);
      expect(result).toBe('none');
    });

    test('adds 1 to slot_index (0-indexed to 1-indexed)', () => {
      const slots = [createSlot(0, 'empty')];
      const result = formatSlotNumbers(slots);
      expect(result).toBe('1'); // slot_index 0 becomes 1
    });

    test('handles single slot', () => {
      const slots = [createSlot(5, 'empty')];
      const result = formatSlotNumbers(slots);
      expect(result).toBe('6');
    });

    test('preserves slot order', () => {
      const slots = [createSlot(8, 'empty'), createSlot(2, 'empty'), createSlot(5, 'empty')];
      const result = formatSlotNumbers(slots);
      expect(result).toBe('9, 3, 6'); // Order preserved from input
    });
  });
});
