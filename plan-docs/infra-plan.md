# Discord Bot Infrastructure Improvement Plan

A comprehensive plan to improve developer experience, reliability, and maintainability while staying with JavaScript (using JSDoc for types).

---

## Current State Analysis

### Critical Issues Found
| Issue | Severity | Location |
|-------|----------|----------|
| No TypeScript/JSDoc types | High | All 41+ commands |
| 1 test file, 2 tests | High | Only `tests/standings.test.js` |
| No ESLint/Prettier | Medium | All files |
| No caching | Medium | Every API call hits live services |
| Hardcoded dates (broken) | Medium | `helpers/utils.js:21-23` (stuck at 2023) |
| Inconsistent error messages | Medium | "You did something stupid" in `closestscores.js:68` |
| Duplicate code | Medium | `validateSeasonRange` in 2 places, `calculateStdDev` in 2 places |
| No request timeouts | Medium | All fetch calls |
| Inconsistent env validation | Low | Some commands check, others crash |

---

## Phase 1: Foundation - Linting & Formatting

**Goal:** Establish consistent code style and catch errors early.

### New Files

#### `eslint.config.js`
```javascript
import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "error",
    },
  },
  { ignores: ["node_modules/", "docs/", "*.cjs"] },
];
```

#### `.prettierrc`
```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

#### `.prettierignore`
```
node_modules/
docs/
*.cjs
data/
```

### Package.json Updates
```json
{
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "eslint": "^9.17.0",
    "globals": "^15.14.0",
    "prettier": "^3.4.2"
  },
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

---

## Phase 2: Core Utilities & Configuration

**Goal:** Consolidate duplicated code and fix hardcoded values.

### New Files

#### `helpers/types.js` - JSDoc Type Definitions
```javascript
/**
 * @typedef {Object} SeasonRange
 * @property {number} seasonMin
 * @property {number} seasonMax
 */

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success
 * @property {Object|Array|null} data
 * @property {string|null} error
 */

/**
 * @typedef {Object} StatsResult
 * @property {number} mean
 * @property {number} variance
 * @property {number} stdDev
 */

/**
 * @typedef {Object} NFLWeekInfo
 * @property {number} week - Current NFL week (1-18)
 * @property {number} season - Current NFL season year
 * @property {boolean} isPreseason
 * @property {boolean} isPostseason
 */

export {};
```

#### `helpers/nflConfig.js` - Dynamic NFL Configuration
```javascript
/**
 * NFL season start dates - update annually after schedule release
 */
export const NFL_SEASON_START_DATES = {
  2023: "2023-09-07",
  2024: "2024-09-05",
  2025: "2025-09-04",
  2026: "2026-09-10",
};

export const LEAGUE_CONFIG = {
  MIN_SEASON: 2010,
  MAX_SEASON: new Date().getFullYear() + 1,
  REGULAR_SEASON_WEEKS: 18,
  AUCTION_START_YEAR: 2016,
};

/**
 * Get current NFL week - replaces broken getCurrentNFLWeek in utils.js
 * @returns {NFLWeekInfo}
 */
export function getCurrentNFLWeek() {
  const today = new Date();
  const currentYear = today.getFullYear();

  for (const season of [currentYear, currentYear - 1]) {
    const startDateStr = NFL_SEASON_START_DATES[season];
    if (!startDateStr) continue;

    const startDate = new Date(startDateStr);
    if (today < startDate) {
      return { week: 1, season, isPreseason: true, isPostseason: false };
    }

    const daysSinceStart = Math.floor((today - startDate) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.floor(daysSinceStart / 7) + 1;

    if (weekNumber <= LEAGUE_CONFIG.REGULAR_SEASON_WEEKS) {
      return { week: weekNumber, season, isPreseason: false, isPostseason: false };
    }
  }

  return { week: 1, season: currentYear, isPreseason: true, isPostseason: false };
}

/**
 * Validate and normalize season range
 * Consolidates clutch.js:49-64 and draftTrendsUtils.js:250-270
 */
export function validateSeasonRange(inputMin, inputMax) {
  let seasonMin = inputMin || LEAGUE_CONFIG.MIN_SEASON;
  let seasonMax = inputMax || LEAGUE_CONFIG.MAX_SEASON;

  if (seasonMin > seasonMax) {
    [seasonMin, seasonMax] = [seasonMax, seasonMin];
  }

  return { seasonMin, seasonMax };
}
```

#### `helpers/discord.js` - Discord Helpers
```javascript
import { EmbedBuilder } from "discord.js";

export const ERROR_MESSAGES = {
  GENERIC: "An error occurred. Please try again later.",
  API_FAILED: "Failed to fetch data from the API. Please try again later.",
  NO_DATA: "No data found for the specified criteria.",
  INVALID_INPUT: "Invalid input provided. Please check your parameters.",
  INSUFFICIENT_FUNDS: "You don't have enough coins for this action.",
  DATABASE_ERROR: "A database error occurred. Please try again later.",
};

export function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export async function safeReply(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(options);
    } else {
      await interaction.reply(options);
    }
  } catch (error) {
    console.error("[Discord Helper] Failed to reply:", error);
  }
}

export function getRankEmoji(rank) {
  switch (rank) {
    case 0: return "👑";
    case 1: return "🥈";
    case 2: return "🥉";
    default: return "";
  }
}
```

#### `config/env.js` - Environment Configuration
```javascript
const ENV_GROUPS = {
  CORE: ['DISCORD_TOKEN', 'BOT_ID', 'PORT'],
  ESPN: ['ESPN_S2', 'SWID', 'LEAGUE_ID'],
  SLEEPER: ['SLEEPER_LEAGUE_ID'],
  DATABASE: ['POSTGRES_URL'],
};

export function validateEnvironment() {
  const missing = [];

  ['CORE', 'DATABASE'].forEach(group => {
    ENV_GROUPS[group].forEach(key => {
      if (!process.env[key]) missing.push(key);
    });
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Warn for optional but commonly used
  if (!process.env.ESPN_S2 || !process.env.SWID || !process.env.LEAGUE_ID) {
    console.warn('[CONFIG] ESPN credentials missing - ESPN commands will fail');
  }

  return true;
}

export const config = {
  espn: {
    s2: () => process.env.ESPN_S2,
    swid: () => process.env.SWID,
    leagueId: () => parseInt(process.env.LEAGUE_ID, 10),
    isConfigured: () => !!(process.env.ESPN_S2 && process.env.SWID && process.env.LEAGUE_ID),
  },
  sleeper: {
    leagueId: () => process.env.SLEEPER_LEAGUE_ID,
    isConfigured: () => !!process.env.SLEEPER_LEAGUE_ID,
  },
};
```

### Files to Modify

#### `helpers/utils.js` - Add Consolidated Utilities
```javascript
// ADD these functions:

/**
 * Calculate statistics for an array of numbers
 * Consolidates clutch.js:626-630 and draftTrendsUtils.js:146-156
 */
export function calculateStats(values) {
  if (!values || values.length === 0) {
    return { mean: 0, variance: 0, stdDev: 0 };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return { mean, variance, stdDev: Math.sqrt(variance) };
}

export function calculateStdDev(numbers) {
  return calculateStats(numbers).stdDev;
}

/**
 * Random integer between min and max (inclusive)
 * Consolidates economyConfig.js:161 and trainingConfig.js:113
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function truncateString(value, maxLength = 1024) {
  if (!value || value.length <= maxLength) return value;
  return value.substring(0, maxLength - 3) + "...";
}

export function formatPercentage(value, total, decimals = 1) {
  if (!total || total === 0) return "0";
  return ((value / total) * 100).toFixed(decimals);
}
```

---

## Phase 3: API Infrastructure

**Goal:** Add caching, timeouts, retries, and centralized API clients.

### New Files

#### `lib/cache.js` - In-Memory Cache with TTL
```javascript
class CacheEntry {
  constructor(value, ttlMs) {
    this.value = value;
    this.expiresAt = Date.now() + ttlMs;
  }
  isExpired() { return Date.now() > this.expiresAt; }
}

class Cache {
  constructor() {
    this.store = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry || entry.isExpired()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = 300000) {
    this.store.set(key, new CacheEntry(value, ttlMs));
  }

  async getOrFetch(key, fetcher, ttlMs = 300000) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  deleteByPrefix(pattern) {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) this.store.delete(key);
    }
  }

  cleanup() {
    for (const [key, entry] of this.store.entries()) {
      if (entry.isExpired()) this.store.delete(key);
    }
  }
}

const cache = new Cache();
export default cache;

export const TTL = {
  HISTORICAL: 24 * 60 * 60 * 1000,  // 24 hours
  SEASON_DATA: 60 * 60 * 1000,       // 1 hour
  REALTIME: 15 * 60 * 1000,          // 15 minutes
  DRAFT: 7 * 24 * 60 * 60 * 1000,    // 1 week
};
```

#### `lib/httpClient.js` - HTTP Utilities with Timeout/Retry
```javascript
import fetch from 'node-fetch';

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;

export async function fetchWithTimeout(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchWithRetry(url, options = {}) {
  const { maxRetries = DEFAULT_MAX_RETRIES, ...rest } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, rest);
      if (response.status >= 500 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export async function fetchJSON(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}
```

#### `api/wpfl/wpflClient.js` - WPFL API Client
```javascript
import { fetchJSON, buildUrl } from '../../lib/httpClient.js';
import cache, { TTL } from '../../lib/cache.js';

const BASE_URL = 'https://wpflapi.azurewebsites.net/api';
const CURRENT_YEAR = new Date().getFullYear();

function getTTL(seasonMax) {
  return seasonMax < CURRENT_YEAR ? TTL.HISTORICAL : TTL.SEASON_DATA;
}

class WPFLClient {
  async getExpectedWins(params) {
    const url = buildUrl(`${BASE_URL}/expectedwins`, params);
    const key = `wpfl:ewins:${params.seasonMin}-${params.seasonMax}`;
    return cache.getOrFetch(key, () => fetchJSON(url), getTTL(params.seasonMax));
  }

  async getOptimalCoaching(year, week = null) {
    const url = week
      ? `${BASE_URL}/optimalcoaching/pointsfor/${year}?week=${week}`
      : `${BASE_URL}/optimalcoaching/pointsfor/${year}`;
    const key = `wpfl:optimal:${year}:${week || 'all'}`;
    return cache.getOrFetch(key, () => fetchJSON(url), getTTL(year));
  }

  async getMatchupWinners(params) {
    const url = buildUrl(`${BASE_URL}/fantasyMatchupWinners`, params);
    const key = `wpfl:matchups:${params.seasonMin}-${params.seasonMax}`;
    return cache.getOrFetch(key, () => fetchJSON(url), getTTL(params.seasonMax));
  }

  async getDraftHistory(params) {
    const url = buildUrl(`${BASE_URL}/draft/history`, params);
    const key = `wpfl:draft:${params.seasonMin}-${params.seasonMax}`;
    return cache.getOrFetch(key, () => fetchJSON(url), TTL.DRAFT);
  }

  invalidateCache(prefix = 'wpfl:') {
    cache.deleteByPrefix(prefix);
  }
}

export default new WPFLClient();
```

#### `api/espn/espnClientFactory.js` - ESPN Client Singleton
```javascript
import pkg from 'espn-fantasy-football-api/node.js';
const { Client } = pkg;
import { config } from '../../config/env.js';
import cache, { TTL } from '../../lib/cache.js';

let instance = null;

export function getESPNClient() {
  if (!config.espn.isConfigured()) {
    console.warn('[ESPN] Not configured');
    return null;
  }

  if (!instance) {
    instance = new Client({ leagueId: config.espn.leagueId() });
    instance.setCookies({ espnS2: config.espn.s2(), SWID: config.espn.swid() });
  }
  return instance;
}

export function isESPNConfigured() {
  return config.espn.isConfigured();
}

export const espnAPI = {
  async getRecentActivity(seasonId) {
    const client = getESPNClient();
    if (!client) throw new Error('ESPN not configured');
    const key = `espn:activity:${seasonId}`;
    return cache.getOrFetch(key, () => client.getRecentActivity({ seasonId }), TTL.REALTIME);
  },

  async getTeamsAtWeek(seasonId, scoringPeriodId) {
    const client = getESPNClient();
    if (!client) throw new Error('ESPN not configured');
    const key = `espn:standings:${seasonId}:${scoringPeriodId}`;
    const ttl = seasonId < new Date().getFullYear() ? TTL.HISTORICAL : TTL.SEASON_DATA;
    return cache.getOrFetch(key, () => client.getTeamsAtWeek({ seasonId, scoringPeriodId }), ttl);
  },

  invalidateCache() {
    cache.deleteByPrefix('espn:');
  }
};
```

---

## Phase 4: Testing Infrastructure

**Goal:** Comprehensive test coverage with priority on critical paths.

### New Files

#### `jest.config.js`
```javascript
export default {
  transform: {},
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  collectCoverageFrom: [
    "discordCommands/**/*.js",
    "economy/**/*.js",
    "trivia/**/*.js",
    "blackjack/**/*.js",
  ],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  moduleNameMapper: {
    "^@vercel/postgres$": "<rootDir>/tests/__mocks__/@vercel/postgres.js",
  },
  testTimeout: 10000,
  clearMocks: true,
};
```

#### `tests/setup.js`
```javascript
beforeEach(() => {
  process.env.DISCORD_TOKEN = "test-token";
  process.env.LEAGUE_ID = "12345";
  process.env.ESPN_S2 = "test-s2";
  process.env.SWID = "test-swid";
});
```

#### `tests/__mocks__/@vercel/postgres.js`
```javascript
import { jest } from "@jest/globals";

export const sql = jest.fn().mockImplementation(() =>
  Promise.resolve({ rows: [], rowCount: 0 })
);

export const createMockQueryResult = (rows) => ({ rows, rowCount: rows.length });
export const resetSqlMock = () => {
  sql.mockClear();
  sql.mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));
};
```

#### `tests/__mocks__/discordInteraction.js`
```javascript
import { jest } from "@jest/globals";

export function createMockInteraction(overrides = {}) {
  return {
    user: overrides.user || { id: "123456789", username: "testuser" },
    options: {
      getString: jest.fn((name) => overrides.options?.[name] ?? null),
      getInteger: jest.fn((name) => overrides.options?.[name] ?? null),
      getUser: jest.fn((name) => overrides.options?.[name] ?? null),
    },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue({}),
    deferReply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}
```

### Test Priority Matrix

| Priority | Category | Files | Reason |
|----------|----------|-------|--------|
| P0 | Database | `economyDb.test.js` | Foundation for all tests |
| P1 | Utils | `blackjackUtils.test.js` | Pure functions, no mocking |
| P2 | Gambling | `gamble.test.js`, `slots.test.js` | Financial transactions |
| P3 | Economy | `daily.test.js`, `rob.test.js` | User state management |
| P4 | Fantasy | `standings.test.js`, `ewins.test.js` | API integration |

### Package.json Test Scripts
```json
{
  "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
  "test:watch": "node --experimental-vm-modules node_modules/jest/bin/jest.js --watch",
  "test:coverage": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage"
}
```

---

## Phase 5: Command Refactoring

**Goal:** Update commands to use new infrastructure.

### Migration Checklist

#### WPFL API Commands
- [ ] `discordCommands/ewins/ewins.js` - Use wpflClient
- [ ] `discordCommands/optimal/optimal.js` - Use wpflClient
- [ ] `discordCommands/clutch/clutch.js` - Use wpflClient + remove duplicates
- [ ] `discordCommands/cursed/cursed.js` - Use wpflClient

#### ESPN Commands
- [ ] `discordCommands/activity/activity.js` - Use espnClientFactory
- [ ] `discordCommands/standings/standings.js` - Use espnClientFactory
- [ ] `discordCommands/closestscores/closestscores.js` - Use espnClientFactory

#### Error Message Standardization
- [ ] Replace "You did something stupid" in `closestscores.js:68`
- [ ] Use `ERROR_MESSAGES` constants across all commands

### Example Migration: ewins.js

**Before:**
```javascript
const url = new URL("https://wpflapi.azurewebsites.net/api/expectedwins");
url.searchParams.set("seasonMax", year);
// ... manual fetch and error handling
```

**After:**
```javascript
import wpflClient from "../../api/wpfl/wpflClient.js";

const data = await wpflClient.getExpectedWins({
  seasonMin: year,
  seasonMax: year,
  weekMin: 1,
  weekMax: week
});
```

---

## Implementation Sequence

### Week 1: Foundation
1. Install ESLint + Prettier, create configs
2. Create `helpers/types.js`, `helpers/nflConfig.js`
3. Update `helpers/utils.js` with consolidated functions
4. Create `config/env.js`, update `index.js`

### Week 2: API Infrastructure
5. Create `lib/cache.js`
6. Create `lib/httpClient.js`
7. Create `api/wpfl/wpflClient.js`
8. Create `api/espn/espnClientFactory.js`

### Week 3: Testing
9. Create Jest config and mocks
10. Write `economyDb.test.js` (P0)
11. Write `blackjackUtils.test.js` (P1)
12. Write gambling command tests (P2)

### Week 4: Command Migration
13. Migrate WPFL commands
14. Migrate ESPN commands
15. Standardize error messages

---

## File Reference

| Purpose | File Path | Action |
|---------|-----------|--------|
| ESLint | `/eslint.config.js` | Create |
| Prettier | `/.prettierrc` | Create |
| Types | `/helpers/types.js` | Create |
| NFL Config | `/helpers/nflConfig.js` | Create |
| Discord Helpers | `/helpers/discord.js` | Create |
| Utils | `/helpers/utils.js` | Modify |
| Env Config | `/config/env.js` | Create |
| Cache | `/lib/cache.js` | Create |
| HTTP Client | `/lib/httpClient.js` | Create |
| WPFL Client | `/api/wpfl/wpflClient.js` | Create |
| ESPN Factory | `/api/espn/espnClientFactory.js` | Create |
| Jest Config | `/jest.config.js` | Create |
| Test Setup | `/tests/setup.js` | Create |
| DB Mock | `/tests/__mocks__/@vercel/postgres.js` | Create |

---

## Expected Outcomes

| Metric | Current | After |
|--------|---------|-------|
| Test Coverage | ~2% | 50-70% |
| API Cache Hit Rate | 0% | ~80% for historical data |
| Linting Errors | Unknown | 0 |
| Type Coverage (JSDoc) | 0% | 80%+ on new code |
| Request Timeout | None | 10s |
| Error Consistency | "You did something stupid" | Standardized messages |
