# JavaScript to TypeScript Refactoring Plan

## Summary
Sequential refactoring order for 87 JavaScript files to TypeScript, organized by dependency tiers from leaf nodes to core systems.

## Current State
- **TypeScript**: Configured (ES2022, strict mode, ESM)
- **ESLint**: Dual-tier approach (relaxed JS, strict TS)
- **Test Coverage**: Minimal (1 test file)
- **Missing @types**: `express`, `node-cron`

---

## Pre-Refactoring Tasks

Before starting, install missing type definitions:
```bash
npm install -D @types/express @types/node-cron
```

---

## Sequential Refactoring Order

### Tier 0: Pure Utilities (No Local Dependencies)
*Start here - zero risk of breaking other files*

| Order | File | LOC | Notes |
|-------|------|-----|-------|
| 1 | `helpers/utils.js` | 39 | General utilities (formatNumber, getCurrentNFLWeek) |
| 2 | `helpers/draftTrendsUtils.js` | 276 | Draft constants and calculations |
| 3 | `trivia/answerMatcher.js` | 21 | Pure function, no imports |
| 4 | `constants/espnMembers.js` | ~20 | Static member mapping |
| 5 | `constants/sleeperMembers.js` | ~20 | Static member mapping |
| 6 | `constants/insults.js` | ~30 | String array constant |
| 7 | `constants/cached.js` | ~20 | Cached data constant |

### Tier 1: Config Modules (No Database, No Services)
*Configuration constants used by database and service layers*

| Order | File | LOC | Notes |
|-------|------|-----|-------|
| 8 | `economy/economyConfig.js` | 214 | Currency formatting, cooldowns, job definitions |
| 9 | `nflmon/nflmonConfig.js` | 426 | Rarities, IVs, stat calculations |
| 10 | `training/trainingConfig.js` | 126 | Positions, states, graduation values |
| 11 | `inventory/inventoryConfig.js` | 198 | Item definitions, categories |
| 12 | `wordle/wordleConfig.js` | 89 | Game config, rewards, emojis |
| 13 | `stock/stockConfig.js` | ~50 | Stock formatting config |
| 14 | `achievements/achievementConfig.js` | ~80 | Achievement definitions |

### Tier 2: Utility Modules (Depend on Config Only)
*Utility functions that use configs but not databases*

| Order | File | LOC | Notes |
|-------|------|-----|-------|
| 15 | `training/trainingUtils.js` | ~100 | Grid rendering, time formatting |
| 16 | `wordle/wordleUtils.js` | ~150 | Feedback calculation, board rendering |
| 17 | `wordle/wordleWords.js` | ~100 | Word lists, validation |
| 18 | `stock/stockApi.js` | ~80 | External API wrapper (Finnhub) |
| 19 | `api/sleeper/sleeper.js` | 52 | External API wrapper |
| 20 | `discordCommands/blackjack/blackjackUtils.js` | ~200 | Game logic utilities |

### Tier 3: Database Modules (Core Infrastructure)
*Critical - many commands depend on these. Refactor in dependency order.*

| Order | File | LOC | Depends On | Used By |
|-------|------|-----|------------|---------|
| 21 | `achievements/achievementDb.js` | 78 | @vercel/postgres | achievementService |
| 22 | `redzone/redzoneDb.js` | 265 | @vercel/postgres | redzone commands |
| 23 | `blackjack/blackjackDb.js` | 313 | @vercel/postgres | blackjack commands |
| 24 | `trivia/triviaDb.js` | 179 | @vercel/postgres | triviaService |
| 25 | `economy/economyDb.js` | 416 | economyConfig | 33+ commands |
| 26 | `wordle/wordleDb.js` | 408 | wordleWords, wordleConfig | wordle, achievementService |
| 27 | `stock/stockDb.js` | 204 | economyDb | stock command |
| 28 | `inventory/inventoryDb.js` | 306 | economyDb, inventoryConfig | train, shop, inventory |
| 29 | `nflmon/nflmonDb.js` | 879 | economyDb, nflmonConfig | nflmonService, train |
| 30 | `training/trainingDb.js` | 455 | inventoryDb, trainingConfig | train, trainingService |

### Tier 4: Service Modules (Business Logic Layer)
*Orchestrate database operations and contain complex logic*

| Order | File | LOC | Depends On |
|-------|------|-----|------------|
| 31 | `achievements/achievementService.js` | ~150 | achievementDb, economyDb, wordleDb |
| 32 | `training/trainingNotificationService.js` | 82 | trainingDb |
| 33 | `nflmon/nflmonService.js` | 851 | nflmonDb, nflmonConfig |
| 34 | `trivia/triviaService.js` | 447 | triviaDb, answerMatcher, economyDb, nflmonService |

### Tier 5: Simple Commands (Minimal Dependencies)
*Easiest commands - most have <100 LOC*

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 35 | `discordCommands/ping/ping.js` | 7 | None |
| 36 | `discordCommands/flip/flip.js` | 8 | None |
| 37 | `discordCommands/roll/roll.js` | 45 | None |
| 38 | `discordCommands/image/image.js` | 35 | External API only |
| 39 | `discordCommands/median/median.js` | 105 | ESPN API only |
| 40 | `discordCommands/draft/draft.js` | 52 | External API only |
| 41 | `discordCommands/namecolor/namecolor.js` | ~50 | Discord.js only |

### Tier 6: Economy Commands (Single System)
*Depend only on economy system*

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 42 | `discordCommands/balance/balance.js` | ~60 | economyDb |
| 43 | `discordCommands/deposit/deposit.js` | 102 | economyDb |
| 44 | `discordCommands/withdraw/withdraw.js` | 90 | economyDb |
| 45 | `discordCommands/daily/daily.js` | ~100 | economyDb |
| 46 | `discordCommands/work/work.js` | ~80 | economyDb, economyConfig |
| 47 | `discordCommands/eleaderboard/eleaderboard.js` | ~80 | economyDb |
| 48 | `discordCommands/economyhelp/economyhelp.js` | ~40 | None (static help) |
| 49 | `discordCommands/betcreate/betcreate.js` | 45 | economyDb |
| 50 | `discordCommands/betlist/betlist.js` | 67 | economyDb |

### Tier 7: Gambling Commands
*Economy + achievements integration*

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 51 | `discordCommands/slots/slots.js` | ~150 | economyDb, economyConfig |
| 52 | `discordCommands/gamble/gamble.js` | ~200 | economyDb, achievementService |
| 53 | `discordCommands/rob/rob.js` | ~150 | economyDb, achievementService |

### Tier 8: Fantasy Football Commands
*External API focused*

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 54 | `discordCommands/standings/standings.js` | ~100 | ESPN API |
| 55 | `discordCommands/activity/activity.js` | ~120 | ESPN API |
| 56 | `discordCommands/ewins/ewins.js` | ~100 | WPFL API |
| 57 | `discordCommands/optimal/optimal.js` | ~150 | WPFL API |
| 58 | `discordCommands/clutch/clutch.js` | ~150 | WPFL API |
| 59 | `discordCommands/closestscores/closestscores.js` | ~100 | WPFL API |
| 60 | `discordCommands/trophies/trophies.js` | ~100 | ESPN API |
| 61 | `discordCommands/cursed/cursed.js` | 482 | ESPN API |
| 62 | `discordCommands/drafttrends/drafttrends.js` | 913 | WPFL API, draftTrendsUtils |

### Tier 9: Subsystem Commands
*Depend on specific subsystems*

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 63 | `discordCommands/wordle/wordle.js` | 408 | wordleDb, wordleUtils |
| 64 | `discordCommands/stock/stock.js` | 493 | stockDb, stockApi |
| 65 | `discordCommands/inventory/inventory.js` | 373 | inventoryDb |
| 66 | `discordCommands/shop/shop.js` | 523 | inventoryDb, economyDb |

### Tier 10: Blackjack Commands

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 67 | `discordCommands/blackjack/blackjack.js` | 861 | blackjackDb, blackjackUtils, economyDb |
| 68 | `discordCommands/blackjackstats/blackjackstats.js` | ~100 | blackjackDb |
| 69 | `discordCommands/blackjackleaderboard/blackjackleaderboard.js` | ~100 | blackjackDb |

### Tier 11: Trivia Commands

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 70 | `discordCommands/trivia/trivia.js` | ~150 | triviaService |
| 71 | `discordCommands/trivialeaderboard/trivialeaderboard.js` | ~100 | triviaDb |
| 72 | `discordCommands/triviastats/triviastats.js` | ~100 | triviaDb |

### Tier 12: Redzone Commands

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 73 | `discordCommands/redzone/redzone.js` | 595 | redzoneDb, nflmonService |
| 74 | `discordCommands/redzoneleaderboard/redzoneleaderboard.js` | ~100 | redzoneDb |

### Tier 13: NFLmon & Training Commands (Highest Complexity)

| Order | File | LOC | Dependencies |
|-------|------|-----|--------------|
| 75 | `discordCommands/starter/starter.js` | ~150 | nflmonService |
| 76 | `discordCommands/train/train.js` | 801 | trainingDb, nflmonDb, inventoryDb |
| 77 | `discordCommands/nflmon/nflmon.js` | 1391 | nflmonService, economyDb |

### Tier 14: Entry Points (Last)
*Refactor after all dependencies are converted*

| Order | File | LOC | Notes |
|-------|------|-----|-------|
| 78 | `deploy-commands.js` | 95 | Command deployment utility |
| 79 | `index.js` | 223 | Main entry point |

### Additional Files (Scripts/Config)

| Order | File | LOC | Notes |
|-------|------|-----|-------|
| 80 | `scripts/addCuratedTrivia.js` | ~50 | One-time migration script |
| 81 | `scripts/generateNflTrivia.js` | ~100 | Data generation script |
| 82 | `precompute-draft-trends.js` | ~150 | Precomputation script |
| 83 | `eslint.config.js` | ~50 | Keep as .js (ESLint config) |
| 84 | `jest.config.js` | ~30 | Keep as .js (Jest config) |

---

## Per-File Refactoring Checklist

For each file:
1. Rename `.js` to `.ts`
2. Add explicit types to all function parameters
3. Add explicit return types to all functions
4. Replace `any` with proper types
5. Add interfaces for complex objects
6. Fix all TypeScript errors (`npm run typecheck`)
7. Fix all ESLint errors (`npm run lint`)
8. Test the command/module still works
9. Commit with message: `refactor(ts): convert [filename] to TypeScript`

---

## Risk Zones

**HIGH RISK - Test Thoroughly:**
- `economy/economyDb.js` - 33+ commands depend on it
- `nflmon/nflmonDb.js` - Complex trades, real items at stake
- `training/trainingDb.js` - Game balance, inventory integration

**COMPLEX LOGIC - Review Carefully:**
- `nflmon/nflmonConfig.js` - IV generation, stat calculations
- `nflmon/nflmonService.js` - Trade settlement logic
- `discordCommands/nflmon/nflmon.js` - 1391 LOC, many subcommands

---

## Types to Create

Create shared types in `types/` directory:

```typescript
// types/economy.d.ts
interface EconomyUser { ... }

// types/nflmon.d.ts
interface Nflmon { ... }
interface Trade { ... }

// types/training.d.ts
interface TrainingSlot { ... }

// types/inventory.d.ts
interface InventoryItem { ... }
```

---

## Testing Strategy

### Current State
- **Test Files**: 1 (`tests/standings.test.js`)
- **Framework**: Jest with ESM support
- **Coverage**: <1% of codebase

### Testing Approach: "Test Before Convert"

For each tier, write tests BEFORE converting to TypeScript. This provides a safety net for the refactor.

#### Priority 1: Database Modules (Tier 3)
These are the highest-risk files. Create integration tests with a test database.

```
tests/
├── db/
│   ├── economyDb.test.ts       # Test all 17+ functions
│   ├── nflmonDb.test.ts        # Test trades, collections
│   ├── trainingDb.test.ts      # Test slot management
│   ├── inventoryDb.test.ts     # Test item operations
│   ├── wordleDb.test.ts        # Test game state
│   └── triviaDb.test.ts        # Test Q&A operations
```

**Per-DB test coverage:**
- All CRUD operations (getUser, addItem, removeItem)
- Edge cases (empty results, duplicates)
- Transaction integrity (multi-step operations)
- Error handling (invalid inputs)

#### Priority 2: Config Modules (Tier 1)
Pure functions are easy to test. Create unit tests.

```
tests/
├── config/
│   ├── economyConfig.test.ts   # formatCurrency, cooldowns
│   ├── nflmonConfig.test.ts    # calculateAllStats, generateIVs
│   ├── trainingConfig.test.ts  # getPosition, calculateGraduationValue
│   └── inventoryConfig.test.ts # getItemDefinition, isItemSellable
```

#### Priority 3: Utility Modules (Tier 2)
```
tests/
├── utils/
│   ├── answerMatcher.test.ts   # checkAnswer edge cases
│   ├── wordleUtils.test.ts     # calculateFeedback, renderBoard
│   ├── trainingUtils.test.ts   # renderGrid, formatTimeRemaining
│   └── blackjackUtils.test.ts  # Game logic
```

#### Priority 4: Service Modules (Tier 4)
Mock database dependencies and test business logic.

```
tests/
├── services/
│   ├── nflmonService.test.ts   # Trade logic, roll mechanics
│   ├── triviaService.test.ts   # Question management
│   └── achievementService.test.ts # Achievement checks
```

### Test Utilities to Create

```typescript
// tests/helpers/dbMock.ts
// Mock @vercel/postgres sql template tag

// tests/helpers/discordMock.ts
// Mock Discord.js interactions, channels, users

// tests/helpers/fixtures.ts
// Test data factories for users, nflmon, items
```

### Minimum Test Requirements Per File

| File Type | Min Coverage | Required Tests |
|-----------|--------------|----------------|
| *Config.ts | 80% | All exported functions |
| *Db.ts | 70% | CRUD + edge cases |
| *Service.ts | 60% | Core business logic |
| *Utils.ts | 90% | All pure functions |
| Commands | 40% | Happy path + error handling |

### Test Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/db/economyDb.test.ts

# Watch mode during refactoring
npm test -- --watch
```

---

## Shared Types Design

### Directory Structure

```
types/
├── global.d.ts          # (exists) Discord.js extensions, env vars
├── economy.d.ts         # Economy system types
├── nflmon.d.ts          # NFLmon system types
├── training.d.ts        # Training system types
├── inventory.d.ts       # Inventory system types
├── wordle.d.ts          # Wordle game types
├── trivia.d.ts          # Trivia system types
├── discord.d.ts         # Discord command types
├── api.d.ts             # External API response types
└── database.d.ts        # Database row types
```

### types/economy.d.ts

```typescript
export interface EconomyUser {
  discord_id: string;
  wallet: number;
  bank: number;
  bank_capacity: number;
  total_earned: number;
  total_gambled: number;
  total_won: number;
  total_lost: number;
  last_daily: Date | null;
  last_work: Date | null;
  last_rob: Date | null;
  created_at: Date;
}

export interface EconomyTransaction {
  type: 'deposit' | 'withdraw' | 'transfer' | 'gamble' | 'work' | 'daily' | 'rob';
  amount: number;
  from_user?: string;
  to_user?: string;
  timestamp: Date;
}

export interface LeaderboardEntry {
  discord_id: string;
  username: string;
  total: number;  // wallet + bank
  rank: number;
}

export type CooldownType = 'daily' | 'work' | 'rob';

export interface CooldownResult {
  onCooldown: boolean;
  remainingMs: number;
  remainingFormatted: string;
}
```

### types/nflmon.d.ts

```typescript
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type EvolutionStage = 'rookie' | 'starter' | 'pro' | 'allpro' | 'hof';
export type NflPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

export interface IVs {
  hp: number;      // 0-31
  attack: number;  // 0-31
  defense: number; // 0-31
  speed: number;   // 0-31
}

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  total: number;
}

export interface Nflmon {
  id: number;
  owner_id: string;
  player_id: number;
  player_name: string;
  nfl_team: string;
  position: NflPosition;
  rarity: Rarity;
  evolution_stage: EvolutionStage;
  level: number;
  xp: number;
  ivs: IVs;
  stats: Stats;
  is_shiny: boolean;
  nickname: string | null;
  acquired_at: Date;
  is_favorite: boolean;
  slot_position: 'bench' | 'training' | 'active';
}

export interface NflmonPlayer {
  id: number;
  name: string;
  team: string;
  position: NflPosition;
  base_stats: Stats;
  rarity_weights: Record<Rarity, number>;
}

export interface Trade {
  id: number;
  initiator_id: string;
  recipient_id: string;
  initiator_nflmon_ids: number[];
  recipient_nflmon_ids: number[];
  initiator_coins: number;
  recipient_coins: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  created_at: Date;
  expires_at: Date;
}

export interface RollResult {
  nflmon: Nflmon;
  isNew: boolean;
  message: string;
}

export interface DropConfig {
  enabled: boolean;
  channel_id: string;
  cooldown_minutes: number;
  rarity_boost: number;
}
```

### types/training.d.ts

```typescript
export type TrainingPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX';
export type SlotState = 'empty' | 'training' | 'ready' | 'locked';

export interface TrainingSlot {
  id: number;
  user_id: string;
  position: TrainingPosition;
  slot_index: number;
  nflmon_id: number | null;
  state: SlotState;
  started_at: Date | null;
  completes_at: Date | null;
  xp_reward: number;
}

export interface TrainingGround {
  user_id: string;
  slots: TrainingSlot[];
  total_graduations: number;
  created_at: Date;
}

export interface GraduationResult {
  nflmon: Nflmon;
  xp_gained: number;
  leveled_up: boolean;
  new_level: number;
  evolved: boolean;
  new_stage: EvolutionStage | null;
}

export interface TrainingConfig {
  POSITIONS: TrainingPosition[];
  STATES: Record<string, SlotState>;
  SLOT_COUNT: number;
  TRAINING_DURATION_MS: number;
  BASE_XP_REWARD: number;
}
```

### types/inventory.d.ts

```typescript
export type ItemCategory = 'consumable' | 'equipment' | 'material' | 'special';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  base_value: number;
  sellable: boolean;
  tradeable: boolean;
  stackable: boolean;
  max_stack: number;
  effects?: ItemEffect[];
}

export interface ItemEffect {
  type: 'xp_boost' | 'shiny_chance' | 'rarity_boost' | 'cooldown_reduce';
  value: number;
  duration_ms?: number;
}

export interface InventoryItem {
  id: number;
  user_id: string;
  item_id: string;
  quantity: number;
  acquired_at: Date;
  metadata?: Record<string, unknown>;
}

export interface Inventory {
  user_id: string;
  items: InventoryItem[];
  capacity: number;
  used_slots: number;
}
```

### types/wordle.d.ts

```typescript
export type FeedbackType = 'correct' | 'present' | 'absent';
export type GameStatus = 'playing' | 'won' | 'lost';

export interface WordleFeedback {
  letter: string;
  type: FeedbackType;
}

export interface WordleGuess {
  word: string;
  feedback: WordleFeedback[];
  timestamp: Date;
}

export interface WordleGame {
  id: number;
  user_id: string;
  word: string;
  guesses: WordleGuess[];
  status: GameStatus;
  started_at: Date;
  completed_at: Date | null;
  reward_claimed: boolean;
}

export interface WordleStats {
  user_id: string;
  games_played: number;
  games_won: number;
  current_streak: number;
  max_streak: number;
  guess_distribution: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  average_guesses: number;
}
```

### types/trivia.d.ts

```typescript
export type TriviaCategory = 'nfl' | 'wpfl' | 'general';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface TriviaQuestion {
  id: number;
  category: TriviaCategory;
  difficulty: Difficulty;
  question: string;
  correct_answer: string;
  acceptable_answers: string[];
  points: number;
  times_asked: number;
  times_correct: number;
}

export interface ActiveQuestion {
  question: TriviaQuestion;
  channel_id: string;
  started_at: Date;
  expires_at: Date;
  answered_by: string[];
}

export interface TriviaAnswer {
  id: number;
  user_id: string;
  question_id: number;
  answer: string;
  is_correct: boolean;
  answered_at: Date;
  points_earned: number;
}

export interface TriviaLeaderboardEntry {
  user_id: string;
  username: string;
  total_points: number;
  correct_answers: number;
  total_answers: number;
  accuracy: number;
}
```

### types/discord.d.ts

```typescript
import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ButtonInteraction,
  StringSelectMenuInteraction
} from 'discord.js';

export interface CommandData {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface CommandModule {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export type AnyInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction;

export interface PaginatedEmbed {
  embeds: EmbedBuilder[];
  currentPage: number;
  totalPages: number;
}
```

### types/api.d.ts

```typescript
// WPFL API Response Types
export interface ExpectedWinsResponse {
  owner: string;
  expectedWins: number;
  actualWins: number;
  seasonMin: number;
  seasonMax: number;
  weekMin: number;
  weekMax: number;
}

export interface OptimalCoachingResponse {
  owner: string;
  actualPointsFor: number;
  optimalPointsFor: number;
  season: number;
  week: number;
}

export interface DraftHistoryResponse {
  id: number;
  owner: string;
  player: string;
  playerNflTeam: string;
  playerNflPosition: string;
  averageDraftPosition: number | null;
  league: string;
  draftPosition: number;
  auctionValue: number | null;
  season: number;
}

export interface FantasyMatchupResponse {
  id: number;
  week: string;
  season: string;
  teamA: string;
  teamAPoints: number;
  teamB: string;
  teamBPoints: number;
  homeTeam: string;
  isPlayoffs: boolean;
  fantasyLeague: string;
  margin: number;
}

export interface PlayerScoreResponse {
  playerScoreId: number;
  owner: string;
  player: string;
  week: number;
  season: number;
  playerOpponent: string;
  playerHome: string;
  points: number;
  rosterSlot: string;
  playerNflTeam: string;
  playerNflPosition: string;
  fantasyLeague: string;
}

// Sleeper API Types
export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  reserve: string[];
}

// Stock API Types (Finnhub)
export interface StockQuote {
  c: number;  // current price
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // previous close
  t: number;  // timestamp
}
```

### types/database.d.ts

```typescript
// Raw database row types (as returned by @vercel/postgres)
// Use these in Db modules, convert to domain types in services

export interface EconomyUserRow {
  discord_id: string;
  wallet: string;        // numeric comes as string
  bank: string;
  bank_capacity: string;
  total_earned: string;
  total_gambled: string;
  total_won: string;
  total_lost: string;
  last_daily: string | null;
  last_work: string | null;
  last_rob: string | null;
  created_at: string;
}

export interface NflmonRow {
  id: number;
  owner_id: string;
  player_id: number;
  rarity_id: number;
  evolution_id: number;
  level: number;
  xp: number;
  iv_hp: number;
  iv_attack: number;
  iv_defense: number;
  iv_speed: number;
  is_shiny: boolean;
  nickname: string | null;
  acquired_at: string;
  is_favorite: boolean;
  slot_position: string;
}

export interface TrainingSlotRow {
  id: number;
  user_id: string;
  position: string;
  slot_index: number;
  nflmon_id: number | null;
  state: string;
  started_at: string | null;
  completes_at: string | null;
  xp_reward: number;
}

// Type conversion helpers
export function parseNumeric(value: string): number;
export function parseDate(value: string | null): Date | null;
export function parseNflmonRow(row: NflmonRow): Nflmon;
```

---

## Estimated Scope

- **Total Files**: 84 (excluding config files kept as .js)
- **Total LOC**: ~11,600
- **High-Risk Files**: 3 (economy, nflmon, training DBs)
- **Complex Files**: 5 (>500 LOC commands)
- **New Test Files**: ~15-20
- **New Type Definition Files**: 9
