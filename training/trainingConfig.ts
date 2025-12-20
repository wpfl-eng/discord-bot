/**
 * Training Ground Configuration
 * Central configuration for the football farming game
 */

// ============ TYPE DEFINITIONS ============

export type PositionKey = 'TE' | 'RB' | 'WR' | 'QB';
export type StateName = 'empty' | 'prepared' | 'hydrated' | 'training' | 'ready' | 'busted';
export type StateKey = 'EMPTY' | 'PREPARED' | 'HYDRATED' | 'TRAINING' | 'READY' | 'BUSTED';
export type ToolKey = 'SETUP_KIT' | 'WATER_COOLER';

export interface TrainingPosition {
  readonly emoji: string;
  readonly displayName: string;
  readonly contractItemType: string;
  readonly rookieItemType: string;
  readonly trainTimeMinutes: number;
  readonly graduateValueMin: number;
  readonly graduateValueMax: number;
  readonly wiltWindowMinutes: number;
}

export interface TrainingState {
  readonly emoji: string | null;
  readonly name: StateName;
  readonly description: string;
}

export interface TrainingTool {
  readonly itemType: string;
  readonly displayName: string;
  readonly emoji: string;
}

export interface StarterKitItem {
  readonly itemType: string;
  readonly quantity: number;
}

export interface TrainingConfigType {
  readonly GRID_SIZE: number;
  readonly POSITIONS: Record<PositionKey, TrainingPosition>;
  readonly STATES: Record<StateKey, TrainingState>;
  readonly TOOLS: Record<ToolKey, TrainingTool>;
  readonly STARTER_KIT: readonly StarterKitItem[];
}

// ============ TRAINING_CONFIG ============

export const TRAINING_CONFIG: TrainingConfigType = {
  GRID_SIZE: 9, // 3x3 grid

  POSITIONS: {
    TE: {
      emoji: '🤲',
      displayName: 'Tight End',
      contractItemType: 'contract_te',
      rookieItemType: 'rookie_te',
      trainTimeMinutes: 5,
      graduateValueMin: 75,
      graduateValueMax: 100,
      wiltWindowMinutes: 1440, // 24 hours
    },
    RB: {
      emoji: '🏃',
      displayName: 'Running Back',
      contractItemType: 'contract_rb',
      rookieItemType: 'rookie_rb',
      trainTimeMinutes: 10,
      graduateValueMin: 150,
      graduateValueMax: 200,
      wiltWindowMinutes: 1440, // 24 hours
    },
    WR: {
      emoji: '🎯',
      displayName: 'Wide Receiver',
      contractItemType: 'contract_wr',
      rookieItemType: 'rookie_wr',
      trainTimeMinutes: 15,
      graduateValueMin: 225,
      graduateValueMax: 300,
      wiltWindowMinutes: 1440, // 24 hours
    },
    QB: {
      emoji: '🏈',
      displayName: 'Quarterback',
      contractItemType: 'contract_qb',
      rookieItemType: 'rookie_qb',
      trainTimeMinutes: 25,
      graduateValueMin: 375,
      graduateValueMax: 500,
      wiltWindowMinutes: 1440, // 24 hours
    },
  },

  STATES: {
    EMPTY: { emoji: '⬛', name: 'empty', description: 'Untouched slot' },
    PREPARED: { emoji: '🟫', name: 'prepared', description: 'Equipment set up' },
    HYDRATED: { emoji: '💧', name: 'hydrated', description: 'Ready for drafting' },
    TRAINING: { emoji: null, name: 'training', description: 'Player in development' },
    READY: { emoji: '⭐', name: 'ready', description: 'Ready to graduate!' },
    BUSTED: { emoji: '💀', name: 'busted', description: 'Player left (missed window)' },
  },

  TOOLS: {
    SETUP_KIT: {
      itemType: 'tool_setup_kit',
      displayName: 'Setup Kit',
      emoji: '🔧',
    },
    WATER_COOLER: {
      itemType: 'tool_water_cooler',
      displayName: 'Water Cooler',
      emoji: '💧',
    },
  },

  STARTER_KIT: [
    { itemType: 'tool_setup_kit', quantity: 10 },
    { itemType: 'tool_water_cooler', quantity: 10 },
    { itemType: 'contract_te', quantity: 2 },
  ],
} as const;

// ============ HELPER FUNCTIONS ============

/**
 * Get position configuration by key
 */
export function getPosition(positionKey: string | null | undefined): TrainingPosition | null {
  if (!positionKey) return null;
  return TRAINING_CONFIG.POSITIONS[positionKey as PositionKey] || null;
}

/**
 * Get all position keys
 */
export function getPositionKeys(): PositionKey[] {
  return Object.keys(TRAINING_CONFIG.POSITIONS) as PositionKey[];
}

/**
 * Get state configuration by name
 */
export function getState(stateName: string | null | undefined): TrainingState | null {
  if (!stateName) return null;
  return Object.values(TRAINING_CONFIG.STATES).find((s) => s.name === stateName) || null;
}

/**
 * Get random value between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate graduation value for a position
 */
export function calculateGraduationValue(positionKey: string | null | undefined): number {
  const position = getPosition(positionKey);
  if (!position) return 0;
  return randomInt(position.graduateValueMin, position.graduateValueMax);
}
