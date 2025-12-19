/**
 * Training Ground Configuration
 * Central configuration for the football farming game
 */

export const TRAINING_CONFIG = {
  GRID_SIZE: 9, // 3x3 grid

  POSITIONS: {
    TE: {
      emoji: "🤲",
      displayName: "Tight End",
      contractItemType: "contract_te",
      rookieItemType: "rookie_te",
      trainTimeMinutes: 5,
      graduateValueMin: 75,
      graduateValueMax: 100,
      wiltWindowMinutes: 1440, // 24 hours
    },
    RB: {
      emoji: "🏃",
      displayName: "Running Back",
      contractItemType: "contract_rb",
      rookieItemType: "rookie_rb",
      trainTimeMinutes: 10,
      graduateValueMin: 150,
      graduateValueMax: 200,
      wiltWindowMinutes: 1440, // 24 hours
    },
    WR: {
      emoji: "🎯",
      displayName: "Wide Receiver",
      contractItemType: "contract_wr",
      rookieItemType: "rookie_wr",
      trainTimeMinutes: 15,
      graduateValueMin: 225,
      graduateValueMax: 300,
      wiltWindowMinutes: 1440, // 24 hours
    },
    QB: {
      emoji: "🏈",
      displayName: "Quarterback",
      contractItemType: "contract_qb",
      rookieItemType: "rookie_qb",
      trainTimeMinutes: 25,
      graduateValueMin: 375,
      graduateValueMax: 500,
      wiltWindowMinutes: 1440, // 24 hours
    },
  },

  STATES: {
    EMPTY: { emoji: "⬛", name: "empty", description: "Untouched slot" },
    PREPARED: { emoji: "🟫", name: "prepared", description: "Equipment set up" },
    HYDRATED: { emoji: "💧", name: "hydrated", description: "Ready for drafting" },
    TRAINING: { emoji: null, name: "training", description: "Player in development" },
    READY: { emoji: "⭐", name: "ready", description: "Ready to graduate!" },
    BUSTED: { emoji: "💀", name: "busted", description: "Player left (missed window)" },
  },

  TOOLS: {
    SETUP_KIT: {
      itemType: "tool_setup_kit",
      displayName: "Setup Kit",
      emoji: "🔧",
    },
    WATER_COOLER: {
      itemType: "tool_water_cooler",
      displayName: "Water Cooler",
      emoji: "💧",
    },
  },

  STARTER_KIT: [
    { itemType: "tool_setup_kit", quantity: 10 },
    { itemType: "tool_water_cooler", quantity: 10 },
    { itemType: "contract_te", quantity: 2 },
  ],
};

/**
 * Get position configuration by key
 * @param {string} positionKey - QB, RB, WR, TE
 * @returns {object|null}
 */
export function getPosition(positionKey) {
  return TRAINING_CONFIG.POSITIONS[positionKey] || null;
}

/**
 * Get all position keys
 * @returns {string[]}
 */
export function getPositionKeys() {
  return Object.keys(TRAINING_CONFIG.POSITIONS);
}

/**
 * Get state configuration by name
 * @param {string} stateName - empty, prepared, hydrated, training, ready, busted
 * @returns {object|null}
 */
export function getState(stateName) {
  return Object.values(TRAINING_CONFIG.STATES).find((s) => s.name === stateName) || null;
}

/**
 * Get random value between min and max (inclusive)
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate graduation value for a position
 * @param {string} positionKey
 * @returns {number}
 */
export function calculateGraduationValue(positionKey) {
  const position = getPosition(positionKey);
  if (!position) return 0;
  return randomInt(position.graduateValueMin, position.graduateValueMax);
}
