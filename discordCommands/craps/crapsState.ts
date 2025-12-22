// Craps State Management
// In-memory table state, timer management, and game flow control

import { Client, TextChannel, Message, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import * as crapsDb from '../../craps/crapsDb.js';
import {
  type Roll,
  type BetType,
  type TableStatus,
  type SessionOutcome,
  TIMING,
  LIMITS,
  EMBED_COLORS,
  rollDice,
  formatDiceRoll,
  getRollName,
  getBetDisplay,
  formatAmount,
  getHotStreakMessage,
  getCrapsChannelId,
} from './crapsConfig.js';
import {
  type CrapsBet,
  type RollResolutionResult,
  resolveAllBets,
  aggregateUserResults,
  canPlaceBetType,
  checkDuplicateBet,
  generateBetId,
  getUserExposure,
} from './crapsEngine.js';

// ============ TYPE DEFINITIONS ============

export interface ShooterInfo {
  readonly userId: string;
  readonly username: string;
}

export interface SessionStats {
  rollCount: number;
  startedAt: Date;
  totalWagered: number;
}

export interface CrapsTableState {
  status: TableStatus;
  point: number | null;
  shooter: ShooterInfo | null;
  rollHistory: Roll[];
  bets: CrapsBet[];
  sessionStats: SessionStats;
  tableMessage: Message | null;
  bettingTimer: NodeJS.Timeout | null;
  bettingEndTime: number | null;
  graceTimer: NodeJS.Timeout | null;
  channelId: string;
  client: Client | null;
}

export interface PlaceBetResult {
  success: boolean;
  message: string;
  bet?: CrapsBet;
  tableJustOpened?: boolean;
}

// ============ STATE ============

let tableState: CrapsTableState = createInitialState();

function createInitialState(): CrapsTableState {
  return {
    status: 'idle',
    point: null,
    shooter: null,
    rollHistory: [],
    bets: [],
    sessionStats: {
      rollCount: 0,
      startedAt: new Date(),
      totalWagered: 0,
    },
    tableMessage: null,
    bettingTimer: null,
    bettingEndTime: null,
    graceTimer: null,
    channelId: '',
    client: null,
  };
}

// ============ HELPERS ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearBettingTimer(): void {
  if (tableState.bettingTimer) {
    clearTimeout(tableState.bettingTimer);
    tableState.bettingTimer = null;
    tableState.bettingEndTime = null;
  }
}

function clearGraceTimer(): void {
  if (tableState.graceTimer) {
    clearTimeout(tableState.graceTimer);
    tableState.graceTimer = null;
  }
}

// ============ EMBED BUILDERS ============

function buildTableEmbed(): EmbedBuilder {
  const { status, point, shooter, bets, sessionStats, bettingEndTime } = tableState;
  const isComeout = point === null;

  // Determine color
  let color: number = EMBED_COLORS.COLD;
  if (status === 'betting') {
    color = isComeout ? EMBED_COLORS.BETTING : EMBED_COLORS.POINT;
  } else if (status === 'rolling') {
    color = EMBED_COLORS.ROLLING;
  }

  // Title with point indicator
  let title = 'CRAPS TABLE';
  if (point !== null) {
    title += ` | POINT IS ${point}`;
  }

  // Build description
  const lines: string[] = [];

  // Shooter info
  if (shooter) {
    lines.push(`<@${shooter.userId}> has the dice!`);
  }

  // Timer info
  if (status === 'betting' && bettingEndTime) {
    const spinTime = Math.floor(bettingEndTime / 1000);
    lines.push(`Rolling <t:${spinTime}:R>`);
  }

  // Hot streak
  const hotMessage = getHotStreakMessage(sessionStats.rollCount);
  if (hotMessage) {
    lines.push(hotMessage);
  }

  // Last roll
  if (tableState.rollHistory.length > 0) {
    const lastRoll = tableState.rollHistory[tableState.rollHistory.length - 1];
    lines.push(
      `\nLast Roll: ${formatDiceRoll(lastRoll.die1, lastRoll.die2)} = ${lastRoll.total}`
    );
  }

  lines.push('');

  // Group bets by type
  const activeBets = bets.filter((b) => b.status === 'active');
  const betsByType = new Map<BetType, CrapsBet[]>();
  for (const bet of activeBets) {
    const existing = betsByType.get(bet.betType) || [];
    existing.push(bet);
    betsByType.set(bet.betType, existing);
  }

  // Display each bet type
  const betOrder: BetType[] = ['pass_line', 'dont_pass', 'field', 'place_6', 'place_8'];
  for (const betType of betOrder) {
    const typeBets = betsByType.get(betType);
    if (!typeBets || typeBets.length === 0) continue;

    const totalAmount = typeBets.reduce((sum, b) => sum + b.amount, 0);
    const display = getBetDisplay(betType);
    const bettors = typeBets
      .slice(0, 6)
      .map((b) => `<@${b.userId}> ${formatAmount(b.amount)}`)
      .join(', ');
    const overflow = typeBets.length > 6 ? ` +${typeBets.length - 6} more` : '';

    lines.push(`**${display}** | ${formatAmount(totalAmount)}`);
    lines.push(`${bettors}${overflow}`);
    lines.push('');
  }

  if (activeBets.length === 0) {
    lines.push('_No active bets_');
    lines.push('');
  }

  // Roll history (point phase only)
  if (tableState.rollHistory.length > 1) {
    const rolls = tableState.rollHistory.slice(-8).map((r) => r.total).join(' ');
    lines.push(`Rolls: ${rolls}`);
  }

  // Total wagered
  lines.push(`Total Action: ${formatAmount(sessionStats.totalWagered)}`);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

function buildRollingEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.ROLLING)
    .setTitle('CRAPS TABLE')
    .setDescription('\n\nThe dice are out!\n\n')
    .setTimestamp();
}

function buildRollResultEmbed(roll: Roll): EmbedBuilder {
  const rollName = getRollName(roll.total, tableState.point);
  const diceDisplay = formatDiceRoll(roll.die1, roll.die2);

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.ROLLING)
    .setTitle('CRAPS TABLE')
    .setDescription(`\n\n${diceDisplay}\n\n**${rollName}**\n\n`)
    .setTimestamp();
}

function buildSessionResultsEmbed(
  outcome: SessionOutcome,
  resolution: RollResolutionResult
): EmbedBuilder {
  const userResults = aggregateUserResults(resolution.betResults);

  let title = '';
  let color: number = EMBED_COLORS.COLD;

  switch (outcome) {
    case 'natural':
      title = 'NATURAL!';
      color = EMBED_COLORS.WIN;
      break;
    case 'craps':
      title = 'CRAPS!';
      color = EMBED_COLORS.LOSE;
      break;
    case 'point_hit':
      title = 'POINT HIT!';
      color = EMBED_COLORS.WIN;
      break;
    case 'seven_out':
      title = 'SEVEN OUT!';
      color = EMBED_COLORS.LOSE;
      break;
  }

  const lines: string[] = [];
  lines.push(`Session lasted ${tableState.sessionStats.rollCount} roll${tableState.sessionStats.rollCount !== 1 ? 's' : ''}`);
  lines.push('');

  // Show results by user
  for (const user of userResults) {
    const netStr =
      user.netResult >= 0
        ? `+${formatAmount(user.netResult)}`
        : `-${formatAmount(Math.abs(user.netResult))}`;

    const emoji = user.netResult > 0 ? '🏆' : user.netResult < 0 ? '💸' : '➖';
    lines.push(`${emoji} <@${user.userId}>: ${netStr}`);

    for (const item of user.breakdown) {
      const outcomeEmoji = item.outcome === 'won' ? '✅' : item.outcome === 'lost' ? '❌' : '↩️';
      lines.push(`  ${outcomeEmoji} ${getBetDisplay(item.betType)}: ${item.outcome}`);
    }
  }

  if (userResults.length === 0) {
    lines.push('No bets resolved this session');
  }

  lines.push('');
  lines.push(`Table cooling... Use \`/craps bet\` to continue!`);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

// ============ GAME FLOW ============

async function executeRoll(): Promise<void> {
  clearBettingTimer();

  if (tableState.bets.filter((b) => b.status === 'active').length === 0) {
    // No bets, go to grace period
    startGracePeriod();
    return;
  }

  tableState.status = 'rolling';

  // Update embed to show rolling
  await updateTableMessage(buildRollingEmbed());
  await sleep(TIMING.ROLL_ANIMATION_MS);

  // Generate roll
  const roll = rollDice();
  tableState.rollHistory.push(roll);
  tableState.sessionStats.rollCount++;

  // Show roll result
  await updateTableMessage(buildRollResultEmbed(roll));
  await sleep(TIMING.RESULT_DISPLAY_MS);

  // Resolve all bets
  const resolution = resolveAllBets(
    tableState.bets,
    roll,
    tableState.point
  );

  // Process payouts
  for (const result of resolution.betResults) {
    if (result.payout > 0 && result.outcome !== 'pending') {
      try {
        await economyDb.addToWallet(result.bet.userId, result.payout);
      } catch (err) {
        console.error(`[CRAPS] Payout failed for ${result.bet.userId}:`, err);
      }
    }
  }

  // Check if point was established
  if (resolution.pointEstablished !== null) {
    tableState.point = resolution.pointEstablished;
  }

  // Handle session outcome
  if (resolution.sessionEnded && resolution.sessionOutcome) {
    await endSession(resolution.sessionOutcome, resolution);
  } else {
    // Continue to next betting phase
    tableState.status = 'resolved';
    await updateTableMessage(buildTableEmbed());
    await sleep(1000);
    startBettingPhase();
  }
}

async function endSession(
  outcome: SessionOutcome,
  resolution: RollResolutionResult
): Promise<void> {
  tableState.status = 'resolved';

  // Show session results
  await updateTableMessage(buildSessionResultsEmbed(outcome, resolution));

  // Get resolved bets (bets that are no longer active)
  const resolvedBets = tableState.bets.filter((b) => b.status !== 'active');

  // Log to database
  try {
    await crapsDb.logCompleteSession(
      {
        channelId: tableState.channelId,
        shooterUserId: tableState.shooter?.userId ?? null,
        shooterUsername: tableState.shooter?.username ?? null,
        point: tableState.point,
        rollCount: tableState.sessionStats.rollCount,
        outcome,
        totalWagered: tableState.sessionStats.totalWagered,
        totalPaid: resolution.totalPaid,
        rollHistory: tableState.rollHistory,
        startedAt: tableState.sessionStats.startedAt,
      },
      resolvedBets.map((b) => ({
        userId: b.userId,
        username: b.username,
        betType: b.betType,
        amount: b.amount,
        outcome: b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'push',
        payout: b.payout ?? 0,
      }))
    );
  } catch (err) {
    console.error('[CRAPS] Failed to log session:', err);
  }

  // Update player stats for all participants
  const userBetsMap = new Map<string, {
    username: string;
    bets: Array<{
      betType: BetType;
      amount: number;
      outcome: 'won' | 'lost' | 'push';
      payout: number;
    }>;
  }>();

  for (const bet of resolvedBets) {
    let userData = userBetsMap.get(bet.userId);
    if (!userData) {
      userData = { username: bet.username, bets: [] };
      userBetsMap.set(bet.userId, userData);
    }
    userData.bets.push({
      betType: bet.betType,
      amount: bet.amount,
      outcome: bet.status === 'won' ? 'won' : bet.status === 'lost' ? 'lost' : 'push',
      payout: bet.payout ?? 0,
    });
  }

  for (const [userId, userData] of userBetsMap) {
    try {
      await crapsDb.updatePlayerStats({
        userId,
        username: userData.username,
        wasShooter: userId === tableState.shooter?.userId,
        sessionOutcome: outcome,
        rollCount: tableState.sessionStats.rollCount,
        bets: userData.bets,
      });
    } catch (err) {
      console.error(`[CRAPS] Failed to update stats for ${userId}:`, err);
    }
  }

  // Start grace period
  startGracePeriod();
}

function startGracePeriod(): void {
  // Reset session state but keep channel/client
  const channelId = tableState.channelId;
  const client = tableState.client;
  const message = tableState.tableMessage;

  tableState = createInitialState();
  tableState.channelId = channelId;
  tableState.client = client;
  tableState.tableMessage = message;
  tableState.status = 'idle';

  // Set grace timer
  tableState.graceTimer = setTimeout(() => {
    // Table goes cold - clear message reference
    tableState.tableMessage = null;
  }, TIMING.GRACE_PERIOD_SECONDS * 1000);
}

function startBettingPhase(): void {
  clearGraceTimer();

  tableState.status = 'betting';

  const durationSeconds = tableState.point === null
    ? TIMING.COMEOUT_BETTING_SECONDS
    : TIMING.POINT_BETTING_SECONDS;

  tableState.bettingEndTime = Date.now() + durationSeconds * 1000;
  tableState.bettingTimer = setTimeout(() => executeRoll(), durationSeconds * 1000);

  // Update embed
  updateTableMessage(buildTableEmbed()).catch((err) => {
    console.error('[CRAPS] Failed to update table message:', err);
  });
}

function extendBettingTimer(seconds: number): void {
  if (!tableState.bettingTimer || !tableState.bettingEndTime) return;

  // Cap at MAX_BETTING_SECONDS from now to prevent infinite extension
  const maxEndTime = Date.now() + TIMING.MAX_BETTING_SECONDS * 1000;
  const newEndTime = Math.min(tableState.bettingEndTime + seconds * 1000, maxEndTime);

  if (newEndTime <= tableState.bettingEndTime) return;

  clearTimeout(tableState.bettingTimer);
  tableState.bettingEndTime = newEndTime;
  tableState.bettingTimer = setTimeout(
    () => executeRoll(),
    newEndTime - Date.now()
  );
}

async function updateTableMessage(embed: EmbedBuilder): Promise<void> {
  if (!tableState.tableMessage || !tableState.client) return;

  try {
    await tableState.tableMessage.edit({ embeds: [embed] });
  } catch (err) {
    console.error('[CRAPS] Failed to update table message:', err);
    // Try to send a new message
    try {
      const channel = await tableState.client.channels.fetch(tableState.channelId);
      if (channel && 'send' in channel) {
        tableState.tableMessage = await (channel as TextChannel).send({ embeds: [embed] });
      }
    } catch (sendErr) {
      console.error('[CRAPS] Failed to send new table message:', sendErr);
    }
  }
}

// ============ PUBLIC API ============

/**
 * Check if table is active (not idle)
 */
export function isTableActive(): boolean {
  return tableState.status !== 'idle';
}

/**
 * Get current table status
 */
export function getTableStatus(): TableStatus {
  return tableState.status;
}

/**
 * Get current point (null = come-out phase)
 */
export function getCurrentPoint(): number | null {
  return tableState.point;
}

/**
 * Get user's active bets
 */
export function getUserBets(userId: string): CrapsBet[] {
  return tableState.bets.filter((b) => b.userId === userId && b.status === 'active');
}

/**
 * Get user's total exposure (sum of active bets)
 */
export function getUserTotalExposure(userId: string): number {
  return getUserExposure(tableState.bets, userId);
}

/**
 * Place a bet on the table
 */
export async function placeBet(
  client: Client,
  channel: TextChannel,
  userId: string,
  username: string,
  betType: BetType,
  amount: number
): Promise<PlaceBetResult> {
  // Validate bet type for current phase
  const phaseCheck = canPlaceBetType(betType, tableState.point);
  if (!phaseCheck.allowed) {
    return { success: false, message: phaseCheck.reason ?? 'Invalid bet' };
  }

  // Check for duplicates
  const duplicateCheck = checkDuplicateBet(tableState.bets, userId, betType);
  if (!duplicateCheck.allowed) {
    return { success: false, message: duplicateCheck.reason ?? 'Duplicate bet not allowed' };
  }

  // Check exposure limit
  const currentExposure = getUserTotalExposure(userId);
  if (currentExposure + amount > LIMITS.MAX_EXPOSURE) {
    return {
      success: false,
      message: `You have ${formatAmount(currentExposure)} on the table. Max exposure is ${formatAmount(LIMITS.MAX_EXPOSURE)}.`,
    };
  }

  // Check bet amount limits
  if (amount < LIMITS.MIN_BET) {
    return { success: false, message: `Minimum bet is ${formatAmount(LIMITS.MIN_BET)}` };
  }
  if (amount > LIMITS.MAX_BET) {
    return { success: false, message: `Maximum bet is ${formatAmount(LIMITS.MAX_BET)}` };
  }

  // Check if we're in a valid state to accept bets
  if (tableState.status === 'rolling') {
    return { success: false, message: 'Dice are in the air! Wait for the next betting window.' };
  }

  // Deduct from wallet
  const deductResult = await economyDb.deductFromWallet(userId, amount);
  if (!deductResult) {
    return { success: false, message: 'Insufficient funds' };
  }

  let tableJustOpened = false;

  // Handle aggregation for place bets
  if (duplicateCheck.aggregate) {
    const existingBet = tableState.bets.find(
      (b) => b.userId === userId && b.betType === betType && b.status === 'active'
    );
    if (existingBet) {
      // Add to existing bet
      existingBet.amount += amount;
      tableState.sessionStats.totalWagered += amount;
      extendBettingTimer(TIMING.BET_EXTENDS_TIMER_BY);
      await updateTableMessage(buildTableEmbed());
      return {
        success: true,
        message: `Added ${formatAmount(amount)} to your ${getBetDisplay(betType)} bet`,
        bet: existingBet,
      };
    }
  }

  // Create new bet
  const bet: CrapsBet = {
    id: generateBetId(),
    userId,
    username,
    betType,
    amount,
    placedAt: new Date(),
    status: 'active',
  };

  tableState.bets.push(bet);
  tableState.sessionStats.totalWagered += amount;

  // Check if table was idle - need to open it
  if (tableState.status === 'idle') {
    tableJustOpened = true;
    tableState.channelId = channel.id;
    tableState.client = client;
    tableState.shooter = { userId, username };
    tableState.sessionStats.startedAt = new Date();

    // Clear grace timer if set
    clearGraceTimer();

    // Send opening message
    const openEmbed = new EmbedBuilder()
      .setColor(EMBED_COLORS.BETTING)
      .setTitle('THE CRAPS TABLE IS NOW OPEN!')
      .setDescription(
        `<@${userId}> started the action!\n\n` +
        `Use \`/craps bet <amount> <type>\` to join!\n\n` +
        `Rolling in ${TIMING.COMEOUT_BETTING_SECONDS} seconds...`
      )
      .setTimestamp();

    tableState.tableMessage = await channel.send({ embeds: [openEmbed] });

    // Start betting phase
    startBettingPhase();
  } else {
    // Extend timer and update embed
    extendBettingTimer(TIMING.BET_EXTENDS_TIMER_BY);
    await updateTableMessage(buildTableEmbed());
  }

  return {
    success: true,
    message: `Placed ${formatAmount(amount)} on ${getBetDisplay(betType)}`,
    bet,
    tableJustOpened,
  };
}

/**
 * Get table info for status command
 */
export function getTableInfo(): {
  status: TableStatus;
  point: number | null;
  shooter: ShooterInfo | null;
  rollCount: number;
  totalWagered: number;
  activeBetCount: number;
  bettingEndsAt: number | null;
} {
  return {
    status: tableState.status,
    point: tableState.point,
    shooter: tableState.shooter,
    rollCount: tableState.sessionStats.rollCount,
    totalWagered: tableState.sessionStats.totalWagered,
    activeBetCount: tableState.bets.filter((b) => b.status === 'active').length,
    bettingEndsAt: tableState.bettingEndTime,
  };
}

/**
 * Get the craps channel ID from env
 */
export { getCrapsChannelId };

/**
 * Emergency shutdown - refund all bets
 * Call this on bot shutdown or channel deletion
 */
export async function emergencyShutdown(): Promise<void> {
  console.log('[CRAPS] Emergency shutdown initiated');

  clearBettingTimer();
  clearGraceTimer();

  // Refund all active bets
  for (const bet of tableState.bets) {
    if (bet.status === 'active') {
      try {
        await economyDb.addToWallet(bet.userId, bet.amount);
        console.log(`[CRAPS] Refunded ${bet.amount} to ${bet.userId}`);
      } catch (err) {
        console.error(`[CRAPS] Failed to refund ${bet.userId}:`, err);
      }
    }
  }

  // Reset state
  tableState = createInitialState();
}
