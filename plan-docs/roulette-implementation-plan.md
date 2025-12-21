# Roulette Lounge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a roulette casino game with automatic 2-minute spins, multiple bet types, and database history.

**Architecture:** In-memory active round state with timer-based auto-spin. Bets deducted immediately, payouts on spin completion. Completed rounds logged to PostgreSQL for stats.

**Tech Stack:** TypeScript, discord.js v14 (slash commands, embeds, autocomplete), @vercel/postgres, existing economy/nflmon services.

---

## Task 1: Database Schema

**Files:**
- Create: `sql/roulette.sql`

**Step 1: Create the SQL schema file**

```sql
-- Roulette History Tables
-- Run: psql $DATABASE_URL -f sql/roulette.sql

-- Completed rounds history
CREATE TABLE IF NOT EXISTS roulette_rounds (
    id SERIAL PRIMARY KEY,
    result_number VARCHAR(2) NOT NULL,
    result_color VARCHAR(5) NOT NULL,
    total_wagered INTEGER NOT NULL,
    total_paid INTEGER NOT NULL,
    bet_count INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    spun_at TIMESTAMP DEFAULT NOW()
);

-- Individual bet history
CREATE TABLE IF NOT EXISTS roulette_bets (
    id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES roulette_rounds(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    bet_type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    won BOOLEAN NOT NULL,
    returned INTEGER NOT NULL DEFAULT 0,
    placed_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_roulette_rounds_spun_at ON roulette_rounds(spun_at DESC);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_user_id ON roulette_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_round_id ON roulette_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_user_bet ON roulette_bets(user_id, bet_type);
```

**Step 2: Commit**

```bash
git add sql/roulette.sql
git commit -m "feat(roulette): add database schema for round history"
```

---

## Task 2: Add NFLmon XP Source

**Files:**
- Modify: `nflmon/nflmonConfig.ts:9` (XpSourceId type)
- Modify: `nflmon/nflmonConfig.ts:167-172` (XP_SOURCES object)

**Step 1: Update XpSourceId type**

In `nflmon/nflmonConfig.ts`, line 9, change:
```typescript
export type XpSourceId = 'wordle_win' | 'wordle_first' | 'trivia_correct' | 'blackjack_win';
```

To:
```typescript
export type XpSourceId = 'wordle_win' | 'wordle_first' | 'trivia_correct' | 'blackjack_win' | 'roulette_win';
```

**Step 2: Add roulette_win to XP_SOURCES**

In `nflmon/nflmonConfig.ts`, around line 167-172, change:
```typescript
export const XP_SOURCES: Record<XpSourceId, XpRange> = {
  wordle_win: { min: 10, max: 20 },
  wordle_first: { min: 25, max: 35 },
  trivia_correct: { min: 5, max: 15 },
  blackjack_win: { min: 3, max: 8 },
} as const;
```

To:
```typescript
export const XP_SOURCES: Record<XpSourceId, XpRange> = {
  wordle_win: { min: 10, max: 20 },
  wordle_first: { min: 25, max: 35 },
  trivia_correct: { min: 5, max: 15 },
  blackjack_win: { min: 3, max: 8 },
  roulette_win: { min: 3, max: 8 },
} as const;
```

**Step 3: Commit**

```bash
git add nflmon/nflmonConfig.ts
git commit -m "feat(roulette): add roulette_win XP source"
```

---

## Task 3: Add Environment Variable

**Files:**
- Modify: `.env.sample`

**Step 1: Add ROULETTE_CHANNEL_ID**

Add at end of `.env.sample`:
```bash
# Roulette
ROULETTE_CHANNEL_ID=
```

**Step 2: Commit**

```bash
git add .env.sample
git commit -m "feat(roulette): add ROULETTE_CHANNEL_ID env var"
```

---

## Task 4: Roulette Configuration

**Files:**
- Create: `discordCommands/roulette/rouletteConfig.ts`

**Step 1: Create configuration file**

```typescript
// Roulette Configuration
// American roulette wheel with Vegas standard payouts

// ============ WHEEL LAYOUT ============

export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

export const BLACK_NUMBERS: readonly number[] = [
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
];

export const GREEN_NUMBERS: readonly string[] = ['0', '00'];

// All 38 positions on American roulette wheel
export const WHEEL_POSITIONS: readonly string[] = [
  '0',
  '00',
  ...Array.from({ length: 36 }, (_, i) => String(i + 1)),
];

// ============ COLORS ============

export type RouletteColor = 'red' | 'black' | 'green';

export function getColor(num: string): RouletteColor {
  if (num === '0' || num === '00') return 'green';
  const n = parseInt(num, 10);
  return RED_NUMBERS.includes(n) ? 'red' : 'black';
}

export function getColorEmoji(color: RouletteColor): string {
  switch (color) {
    case 'red':
      return '🔴';
    case 'black':
      return '⚫';
    case 'green':
      return '🟢';
  }
}

// ============ BET TYPES ============

export interface BetType {
  readonly name: string;
  readonly display: string;
  readonly payout: number; // Profit multiplier (1:1 = 1, 35:1 = 35)
  readonly matches: (result: string, color: RouletteColor) => boolean;
}

// Column definitions
const FIRST_COLUMN = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
const SECOND_COLUMN = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
const THIRD_COLUMN = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

export const BET_TYPES: Record<string, BetType> = {
  // Outside bets - 1:1 payout
  red: {
    name: 'red',
    display: '🔴 Red',
    payout: 1,
    matches: (_r, color) => color === 'red',
  },
  black: {
    name: 'black',
    display: '⚫ Black',
    payout: 1,
    matches: (_r, color) => color === 'black',
  },
  odd: {
    name: 'odd',
    display: 'Odd',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n % 2 === 1;
    },
  },
  even: {
    name: 'even',
    display: 'Even',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n % 2 === 0;
    },
  },
  low: {
    name: 'low',
    display: '1-18',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 1 && n <= 18;
    },
  },
  high: {
    name: 'high',
    display: '19-36',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 19 && n <= 36;
    },
  },

  // Dozen bets - 2:1 payout
  'first-dozen': {
    name: 'first-dozen',
    display: '1st 12',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 1 && n <= 12;
    },
  },
  'second-dozen': {
    name: 'second-dozen',
    display: '2nd 12',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 13 && n <= 24;
    },
  },
  'third-dozen': {
    name: 'third-dozen',
    display: '3rd 12',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 25 && n <= 36;
    },
  },

  // Column bets - 2:1 payout
  'first-column': {
    name: 'first-column',
    display: '1st Col',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      return FIRST_COLUMN.includes(parseInt(r, 10));
    },
  },
  'second-column': {
    name: 'second-column',
    display: '2nd Col',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      return SECOND_COLUMN.includes(parseInt(r, 10));
    },
  },
  'third-column': {
    name: 'third-column',
    display: '3rd Col',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      return THIRD_COLUMN.includes(parseInt(r, 10));
    },
  },
};

// Add straight-up number bets (0, 00, 1-36) - 35:1 payout
for (const pos of WHEEL_POSITIONS) {
  BET_TYPES[pos] = {
    name: pos,
    display: pos,
    payout: 35,
    matches: (r) => r === pos,
  };
}

// ============ AUTOCOMPLETE OPTIONS ============

export const ALL_BET_TYPES: readonly string[] = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'first-dozen',
  'second-dozen',
  'third-dozen',
  'first-column',
  'second-column',
  'third-column',
  ...WHEEL_POSITIONS,
];

// ============ TIMING ============

export const ROUND_DURATION_MS = 2 * 60 * 1000; // 2 minutes
export const SPIN_SUSPENSE_MS = 2500; // 2.5 seconds

// ============ EMBED COLORS ============

export const EMBED_COLORS = {
  ACTIVE: 0x3498db, // Blue
  SPINNING: 0xf1c40f, // Gold
  WIN: 0x2ecc71, // Green
  LOSE: 0xe74c3c, // Red
} as const;

// ============ FORMATTING ============

/**
 * Format amount with abbreviation (1000 -> 1K)
 */
export function formatAmount(amount: number): string {
  if (amount >= 10000) {
    return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(amount);
}

/**
 * Get display name for a bet type
 */
export function getBetDisplay(betType: string): string {
  const bet = BET_TYPES[betType];
  return bet?.display ?? betType;
}
```

**Step 2: Commit**

```bash
git add discordCommands/roulette/rouletteConfig.ts
git commit -m "feat(roulette): add roulette configuration with wheel and bet types"
```

---

## Task 5: Database Operations

**Files:**
- Create: `discordCommands/roulette/rouletteDb.ts`

**Step 1: Create database operations file**

```typescript
// Roulette Database Operations
// Logging completed rounds and bets for history/stats

import { sql } from '@vercel/postgres';

// ============ TYPES ============

export interface RouletteRoundRecord {
  id: number;
  result_number: string;
  result_color: string;
  total_wagered: number;
  total_paid: number;
  bet_count: number;
  player_count: number;
  spun_at: Date;
}

export interface RouletteBetRecord {
  id: number;
  round_id: number;
  user_id: string;
  username: string;
  bet_type: string;
  amount: number;
  won: boolean;
  returned: number;
  placed_at: Date;
}

export interface LogRoundData {
  resultNumber: string;
  resultColor: string;
  totalWagered: number;
  totalPaid: number;
  betCount: number;
  playerCount: number;
}

export interface LogBetData {
  userId: string;
  username: string;
  betType: string;
  amount: number;
  won: boolean;
  returned: number;
}

// ============ LOGGING OPERATIONS ============

/**
 * Log a completed round to the database
 * @returns The round ID for linking bets
 */
export async function logRound(data: LogRoundData): Promise<number> {
  const result = await sql<{ id: number }>`
    INSERT INTO roulette_rounds (
      result_number,
      result_color,
      total_wagered,
      total_paid,
      bet_count,
      player_count
    ) VALUES (
      ${data.resultNumber},
      ${data.resultColor},
      ${data.totalWagered},
      ${data.totalPaid},
      ${data.betCount},
      ${data.playerCount}
    )
    RETURNING id
  `;
  return result.rows[0].id;
}

/**
 * Log bets for a completed round
 */
export async function logBets(roundId: number, bets: LogBetData[]): Promise<void> {
  for (const bet of bets) {
    await sql`
      INSERT INTO roulette_bets (
        round_id,
        user_id,
        username,
        bet_type,
        amount,
        won,
        returned
      ) VALUES (
        ${roundId},
        ${bet.userId},
        ${bet.username},
        ${bet.betType},
        ${bet.amount},
        ${bet.won},
        ${bet.returned}
      )
    `;
  }
}

/**
 * Log a complete round with all bets
 */
export async function logCompleteRound(
  roundData: LogRoundData,
  betsData: LogBetData[]
): Promise<number> {
  try {
    const roundId = await logRound(roundData);
    await logBets(roundId, betsData);
    return roundId;
  } catch (error) {
    console.error('[ROULETTE] Failed to log round to database:', error);
    throw error;
  }
}
```

**Step 2: Commit**

```bash
git add discordCommands/roulette/rouletteDb.ts
git commit -m "feat(roulette): add database operations for round logging"
```

---

## Task 6: Round State Management

**Files:**
- Create: `discordCommands/roulette/rouletteState.ts`

**Step 1: Create state management file**

```typescript
// Roulette State Management
// In-memory active round tracking with timer management

import { Client, TextChannel, Message, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import * as nflmonService from '../../nflmon/nflmonService.js';
import * as rouletteDb from './rouletteDb.js';
import {
  WHEEL_POSITIONS,
  getColor,
  getColorEmoji,
  BET_TYPES,
  ROUND_DURATION_MS,
  SPIN_SUSPENSE_MS,
  EMBED_COLORS,
  formatAmount,
  getBetDisplay,
  type RouletteColor,
} from './rouletteConfig.js';

// ============ TYPES ============

export interface RouletteBet {
  userId: string;
  username: string;
  betType: string;
  amount: number;
  placedAt: Date;
}

export interface RouletteRound {
  bets: RouletteBet[];
  startedAt: Date;
  timer: NodeJS.Timeout;
  messageId: string;
  channelId: string;
  client: Client;
}

export interface PayoutResult {
  userId: string;
  username: string;
  betType: string;
  amount: number;
  won: boolean;
  profit: number;
  totalReturn: number;
}

// ============ STATE ============

let activeRound: RouletteRound | null = null;

// ============ HELPERS ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ EMBED BUILDERS ============

function buildActiveEmbed(round: RouletteRound): EmbedBuilder {
  const spinTime = Math.floor((round.startedAt.getTime() + ROUND_DURATION_MS) / 1000);

  // Group bets by type
  const betsByType = new Map<string, RouletteBet[]>();
  for (const bet of round.bets) {
    const existing = betsByType.get(bet.betType) || [];
    existing.push(bet);
    betsByType.set(bet.betType, existing);
  }

  // Build bet display
  const betLines: string[] = [];
  for (const [betType, bets] of betsByType) {
    const display = getBetDisplay(betType);
    const bettors = bets
      .slice(0, 8)
      .map((b) => `<@${b.userId}> ${formatAmount(b.amount)}`)
      .join(', ');
    const overflow = bets.length > 8 ? ` +${bets.length - 8} more` : '';
    betLines.push(`${display} — ${bettors}${overflow}`);
  }

  const totalWagered = round.bets.reduce((sum, b) => sum + b.amount, 0);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.ACTIVE)
    .setTitle('🎰 ROULETTE')
    .setDescription(
      `⏱️ Spins <t:${spinTime}:R>\n\n` +
        (betLines.length > 0 ? betLines.join('\n') : '_No bets yet_') +
        `\n\n💰 ${formatAmount(totalWagered)} on the table`
    )
    .setTimestamp();

  return embed;
}

function buildSpinningEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.SPINNING)
    .setTitle('🎰 ROULETTE')
    .setDescription('\n   🎲 Spinning...\n')
    .setTimestamp();
}

function buildResultsEmbed(
  resultNumber: string,
  resultColor: RouletteColor,
  results: PayoutResult[],
  totalWagered: number
): EmbedBuilder {
  const winners = results.filter((r) => r.won);
  const totalPaid = winners.reduce((sum, r) => sum + r.totalReturn, 0);
  const hasWinners = winners.length > 0;

  const colorEmoji = getColorEmoji(resultColor);
  const colorName = resultColor.toUpperCase();

  let description: string;
  if (hasWinners) {
    // Group wins by user
    const winsByUser = new Map<string, PayoutResult[]>();
    for (const win of winners) {
      const existing = winsByUser.get(win.userId) || [];
      existing.push(win);
      winsByUser.set(win.userId, existing);
    }

    const winLines: string[] = [];
    for (const [userId, wins] of winsByUser) {
      const totalProfit = wins.reduce((sum, w) => sum + w.profit, 0);
      const betDetails = wins.map((w) => `${getBetDisplay(w.betType)}`).join(', ');
      winLines.push(`🏆 <@${userId}> +${formatAmount(totalProfit)} (${betDetails})`);
    }

    description =
      winLines.slice(0, 10).join('\n') +
      (winLines.length > 10 ? `\n+${winLines.length - 10} more winners` : '') +
      `\n\n💸 Paid ${formatAmount(totalPaid)} from ${formatAmount(totalWagered)} wagered`;
  } else {
    description = `House wins! 💰 Kept ${formatAmount(totalWagered)}`;
  }

  return new EmbedBuilder()
    .setColor(hasWinners ? EMBED_COLORS.WIN : EMBED_COLORS.LOSE)
    .setTitle(`🎰 ${resultNumber} ${colorEmoji} ${colorName}`)
    .setDescription(description)
    .setTimestamp();
}

// ============ PAYOUT PROCESSING ============

async function processPayouts(
  bets: RouletteBet[],
  resultNumber: string,
  resultColor: RouletteColor
): Promise<PayoutResult[]> {
  const results: PayoutResult[] = [];
  const winners = new Set<string>();

  for (const bet of bets) {
    const betDef = BET_TYPES[bet.betType];
    if (!betDef) {
      console.error(`[ROULETTE] Unknown bet type: ${bet.betType}`);
      results.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        won: false,
        profit: 0,
        totalReturn: 0,
      });
      continue;
    }

    const won = betDef.matches(resultNumber, resultColor);

    if (won) {
      const profit = bet.amount * betDef.payout;
      const totalReturn = bet.amount + profit;

      try {
        await economyDb.addToWallet(bet.userId, totalReturn);
        winners.add(bet.userId);
        results.push({
          userId: bet.userId,
          username: bet.username,
          betType: bet.betType,
          amount: bet.amount,
          won: true,
          profit,
          totalReturn,
        });
      } catch (err) {
        console.error(`[ROULETTE] Payout failed for ${bet.userId}:`, err);
        results.push({
          userId: bet.userId,
          username: bet.username,
          betType: bet.betType,
          amount: bet.amount,
          won: true,
          profit,
          totalReturn,
        });
      }
    } else {
      results.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        won: false,
        profit: 0,
        totalReturn: 0,
      });
    }
  }

  // Award XP to winners (once per user, silent)
  for (const oduserId of winners) {
    try {
      await nflmonService.addXpToTraining(userId, 'roulette_win');
    } catch (err) {
      console.error(`[ROULETTE] XP award failed for ${userId}:`, err);
    }
  }

  return results;
}

// ============ SPIN SEQUENCE ============

async function executeSpinSequence(): Promise<void> {
  // CRITICAL: Capture and clear immediately to prevent race condition
  const round = activeRound;
  activeRound = null;

  if (!round || round.bets.length === 0) {
    return;
  }

  // Generate result
  const resultIndex = Math.floor(Math.random() * WHEEL_POSITIONS.length);
  const resultNumber = WHEEL_POSITIONS[resultIndex];
  const resultColor = getColor(resultNumber);

  try {
    // Fetch channel and message
    const channel = await round.client.channels.fetch(round.channelId);
    if (!channel || !('messages' in channel)) {
      console.error('[ROULETTE] Could not fetch roulette channel');
      await processPayouts(round.bets, resultNumber, resultColor);
      return;
    }

    const message = await (channel as TextChannel).messages.fetch(round.messageId);

    // Step 1: Show spinning embed
    await message.edit({ embeds: [buildSpinningEmbed()] });

    // Step 2: Suspense
    await sleep(SPIN_SUSPENSE_MS);

    // Step 3: Process payouts
    const results = await processPayouts(round.bets, resultNumber, resultColor);

    // Step 4: Show results
    const totalWagered = round.bets.reduce((sum, b) => sum + b.amount, 0);
    await message.edit({
      embeds: [buildResultsEmbed(resultNumber, resultColor, results, totalWagered)],
    });

    // Step 5: Log to database
    try {
      const uniquePlayers = new Set(round.bets.map((b) => b.userId)).size;
      const totalPaid = results.filter((r) => r.won).reduce((sum, r) => sum + r.totalReturn, 0);

      await rouletteDb.logCompleteRound(
        {
          resultNumber,
          resultColor,
          totalWagered,
          totalPaid,
          betCount: round.bets.length,
          playerCount: uniquePlayers,
        },
        results.map((r) => ({
          userId: r.userId,
          username: r.username,
          betType: r.betType,
          amount: r.amount,
          won: r.won,
          returned: r.won ? r.totalReturn : 0,
        }))
      );
    } catch (dbErr) {
      console.error('[ROULETTE] Failed to log round to database:', dbErr);
    }
  } catch (err) {
    console.error('[ROULETTE] Spin sequence error:', err);
    // Still process payouts even if message update fails
    await processPayouts(round.bets, resultNumber, resultColor);
  }
}

// ============ PUBLIC API ============

/**
 * Check if there's an active round
 */
export function hasActiveRound(): boolean {
  return activeRound !== null;
}

/**
 * Get user's bets in the current round
 */
export function getUserBets(userId: string): RouletteBet[] {
  if (!activeRound) return [];
  return activeRound.bets.filter((b) => b.userId === userId);
}

/**
 * Start a new round (called when first bet is placed)
 */
export async function startRound(
  client: Client,
  channel: TextChannel
): Promise<Message> {
  const now = new Date();

  // Create initial embed
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.ACTIVE)
    .setTitle('🎰 ROULETTE')
    .setDescription('⏱️ Round starting...\n\n_No bets yet_\n\n💰 0 on the table')
    .setTimestamp();

  const message = await channel.send({ embeds: [embed] });

  // Set up round with timer
  activeRound = {
    bets: [],
    startedAt: now,
    timer: setTimeout(() => executeSpinSequence(), ROUND_DURATION_MS),
    messageId: message.id,
    channelId: channel.id,
    client,
  };

  return message;
}

/**
 * Add a bet to the current round
 */
export async function addBet(bet: RouletteBet): Promise<void> {
  if (!activeRound) {
    throw new Error('No active round');
  }

  activeRound.bets.push(bet);

  // Update the embed
  try {
    const channel = await activeRound.client.channels.fetch(activeRound.channelId);
    if (channel && 'messages' in channel) {
      const message = await (channel as TextChannel).messages.fetch(activeRound.messageId);
      await message.edit({ embeds: [buildActiveEmbed(activeRound)] });
    }
  } catch (err) {
    console.error('[ROULETTE] Failed to update round embed:', err);
  }
}

/**
 * Get the roulette channel ID from env
 */
export function getRouletteChannelId(): string | undefined {
  return process.env.ROULETTE_CHANNEL_ID;
}
```

**Step 2: Fix the userId typo**

In the XP award loop, change `oduserId` to `userId`:

```typescript
for (const userId of winners) {
```

**Step 3: Commit**

```bash
git add discordCommands/roulette/rouletteState.ts
git commit -m "feat(roulette): add in-memory state management with timer"
```

---

## Task 7: Main Command Handler

**Files:**
- Create: `discordCommands/roulette/roulette.ts`

**Step 1: Create command file**

```typescript
// Roulette Command
// American roulette with automatic 2-minute spins

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import {
  ALL_BET_TYPES,
  BET_TYPES,
  getBetDisplay,
  formatAmount,
} from './rouletteConfig.js';
import * as rouletteState from './rouletteState.js';

// ============ COMMAND DEFINITION ============

export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Play roulette in the casino')
  .addSubcommand((sub) =>
    sub
      .setName('bet')
      .setDescription('Place a bet on the roulette table')
      .addIntegerOption((opt) =>
        opt
          .setName('amount')
          .setDescription(`Coins to wager (${CONFIG.GAMBLE_MIN}-${CONFIG.GAMBLE_MAX})`)
          .setRequired(true)
          .setMinValue(CONFIG.GAMBLE_MIN)
          .setMaxValue(CONFIG.GAMBLE_MAX)
      )
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('What to bet on (red, black, 17, first-dozen, etc.)')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

// ============ AUTOCOMPLETE ============

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();

  const filtered = ALL_BET_TYPES.filter((t) => t.toLowerCase().startsWith(focused)).slice(0, 25);

  await interaction.respond(
    filtered.map((t) => ({
      name: getBetDisplay(t),
      value: t,
    }))
  );
}

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'bet') {
    await handleBet(interaction);
  }
}

async function handleBet(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const amount = interaction.options.getInteger('amount', true);
  const betType = interaction.options.getString('type', true).toLowerCase();

  // Check if in roulette channel
  const rouletteChannelId = rouletteState.getRouletteChannelId();
  if (!rouletteChannelId) {
    await interaction.editReply({
      content: 'Roulette is not configured. Contact an admin.',
    });
    return;
  }

  if (interaction.channelId !== rouletteChannelId) {
    await interaction.editReply({
      content: `Head to <#${rouletteChannelId}> to play roulette!`,
    });
    return;
  }

  // Validate bet type
  if (!BET_TYPES[betType]) {
    await interaction.editReply({
      content: `Invalid bet type: "${betType}". Try: red, black, odd, even, 0-36, etc.`,
    });
    return;
  }

  // Get user data
  const userData = await economyDb.getOrCreateUser(userId, username);

  // Check balance
  if (userData.wallet < amount) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🎰 Insufficient Funds')
      .setDescription(
        `You need ${formatCurrency(amount)} but only have ${formatCurrency(userData.wallet)} in your wallet.`
      )
      .setFooter({ text: 'Tip: Use /withdraw to get coins from your bank' });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Deduct coins immediately
  const deductResult = await economyDb.deductFromWallet(userId, amount);
  if (!deductResult) {
    await interaction.editReply({
      content: 'Failed to place bet. Please try again.',
    });
    return;
  }

  // Start round if needed
  if (!rouletteState.hasActiveRound()) {
    const channel = interaction.channel as TextChannel;
    await rouletteState.startRound(interaction.client, channel);
  }

  // Add bet to round
  await rouletteState.addBet({
    userId,
    username,
    betType,
    amount,
    placedAt: new Date(),
  });

  // Build confirmation with user's full bet slate
  const userBets = rouletteState.getUserBets(userId);
  const totalBet = userBets.reduce((sum, b) => sum + b.amount, 0);

  const betLines = userBets.map((b) => `• ${formatAmount(b.amount)} on ${getBetDisplay(b.betType)}`);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✓ Bet Placed')
    .setDescription(
      `${formatAmount(amount)} on ${getBetDisplay(betType)}\n\n` +
        '**Your bets this round:**\n' +
        betLines.join('\n') +
        `\n\nTotal: ${formatCurrency(totalBet)}`
    );

  await interaction.editReply({ embeds: [embed] });
}
```

**Step 2: Commit**

```bash
git add discordCommands/roulette/roulette.ts
git commit -m "feat(roulette): add main command handler with betting"
```

---

## Task 8: Register Command & Test

**Step 1: Deploy commands**

```bash
npx tsx deploy-commands.ts
```

**Step 2: Manual Testing Checklist**

1. Set `ROULETTE_CHANNEL_ID` in `.env` to a test channel
2. Run the bot: `npx tsx index.ts`
3. Test autocomplete: `/roulette bet 100 r` should show "🔴 Red"
4. Test wrong channel: Run `/roulette bet 100 red` in wrong channel
5. Test valid bet: Run in roulette channel, verify:
   - Coins deducted
   - Embed appears with countdown
   - Ephemeral confirmation shows bet
6. Test multiple bets: Place 2-3 bets, verify embed updates
7. Wait for spin: After 2 minutes, verify:
   - "Spinning..." appears
   - Results show after ~2.5s
   - Winners get paid
   - Losers see house wins message
8. Test edge cases:
   - Bet more than wallet
   - Invalid bet type
   - Multiple users betting

**Step 3: Final Commit**

```bash
git add -A
git commit -m "feat(roulette): complete roulette lounge implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database schema | `sql/roulette.sql` |
| 2 | NFLmon XP source | `nflmon/nflmonConfig.ts` |
| 3 | Environment variable | `.env.sample` |
| 4 | Roulette configuration | `discordCommands/roulette/rouletteConfig.ts` |
| 5 | Database operations | `discordCommands/roulette/rouletteDb.ts` |
| 6 | State management | `discordCommands/roulette/rouletteState.ts` |
| 7 | Command handler | `discordCommands/roulette/roulette.ts` |
| 8 | Deploy & test | Command registration |

**Total new files:** 5
**Modified files:** 2
