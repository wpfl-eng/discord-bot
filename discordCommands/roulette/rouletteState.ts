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
  for (const userId of winners) {
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
