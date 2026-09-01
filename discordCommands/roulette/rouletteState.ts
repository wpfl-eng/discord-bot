// Roulette Table State
//
// The table runs as a session rather than a series of independent rounds. It opens on
// the first bet, spins repeatedly while people keep betting, and closes after a spin
// nobody joins. One message is created per session and edited in place through every
// phase, so an evening of play leaves one message in the channel instead of one per
// spin.
//
// All state is in memory; the coins are not. Every stake sits in wager_escrow, so a
// restart loses the table but never the money - the startup sweep returns it.

import { randomUUID } from 'node:crypto';
import { Client, TextChannel, Message } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import * as escrowDb from '../../economy/escrowDb.js';
import * as rouletteDb from './rouletteDb.js';
import {
  WHEEL_POSITIONS,
  getColor,
  BET_TYPES,
  TIMING,
  LIMITS,
  type RouletteColor,
} from './rouletteConfig.js';
import {
  buildTableMessage,
  type RenderBet,
  type TableView,
  type TablePhase,
} from './rouletteRender.js';

// ============ TYPES ============

export interface RouletteBet {
  userId: string;
  username: string;
  betType: string;
  amount: number;
  placedAt: Date;
  /** wager_escrow row holding this stake until the wheel resolves it */
  escrowId: number;
}

export interface PayoutResult {
  userId: string;
  username: string;
  betType: string;
  amount: number;
  won: boolean;
  profit: number;
  totalReturn: number;
  /**
   * Whether the coins actually reached the wallet. A won bet that failed to credit is
   * won:true, paid:false - its escrow row stays open so the startup sweep returns the
   * stake rather than the database claiming a payout the player never got.
   */
  paid: boolean;
  escrowId: number;
}

interface TableSession {
  client: Client;
  channelId: string;
  message: Message | null;
  /** Groups the current spin's escrow rows */
  sessionKey: string;
  phase: TablePhase;
  bets: RouletteBet[];
  /** Newest first */
  recentSpins: string[];
  spinCount: number;
  sessionWagered: number;
  openedBy: string;
  /** Epoch ms the betting window closes */
  closesAt: number | null;
  windowTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
  /** Bets from the previous spin, per user, for the Rebet button */
  lastRoundBets: Map<string, { betType: string; amount: number }[]>;
}

// ============ STATE ============

let table: TableSession | null = null;

// Guards table creation. Two players betting at the same moment must not each open a
// table. Installing the lock happens with no intervening await, so the event loop
// cannot interleave a second caller into the gap.
let openLock: Promise<void> | null = null;

// ============ HELPERS ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearTimers(session: TableSession): void {
  if (session.windowTimer) {
    clearTimeout(session.windowTimer);
    session.windowTimer = null;
  }
  if (session.graceTimer) {
    clearTimeout(session.graceTimer);
    session.graceTimer = null;
  }
}

function toRenderBets(bets: readonly RouletteBet[]): RenderBet[] {
  return bets.map((b) => ({ userId: b.userId, betType: b.betType, amount: b.amount }));
}

function viewOf(session: TableSession, overrides: Partial<TableView> = {}): TableView {
  return {
    phase: session.phase,
    closesAt: session.closesAt,
    bets: toRenderBets(session.bets),
    recentSpins: session.recentSpins,
    spinCount: session.spinCount,
    sessionWagered: session.sessionWagered,
    openedBy: session.openedBy,
    ...overrides,
  };
}

/**
 * Push the table's current state to its message.
 *
 * Rendering is best effort throughout: a deleted message, a permissions change or a
 * rate limit must never stop the wheel or the payouts.
 */
async function paint(session: TableSession, overrides: Partial<TableView> = {}): Promise<void> {
  if (!session.message) return;
  lastPaintAt = Date.now();
  try {
    await session.message.edit(buildTableMessage(viewOf(session, overrides)) as never);
  } catch (err) {
    console.error('[ROULETTE] Failed to paint table:', err);
  }
}

/**
 * Minimum gap between board repaints.
 *
 * Discord rate limits message edits per channel, and a busy table repaints on every
 * bet. Coalescing keeps a flurry of chips to one edit instead of one each - the board
 * can lag by up to this long, which nobody notices against a 30-second window.
 *
 * The spin frames call paint() directly and deliberately bypass this: they are three
 * edits spaced 800ms apart, and no bets are landing to compete with them.
 */
const MIN_PAINT_INTERVAL_MS = 1200;

let lastPaintAt = 0;
let pendingPaint: NodeJS.Timeout | null = null;

/**
 * Request a repaint, collapsing rapid requests into a single edit.
 */
function schedulePaint(session: TableSession): void {
  if (pendingPaint) return;

  const elapsed: number = Date.now() - lastPaintAt;
  if (elapsed >= MIN_PAINT_INTERVAL_MS) {
    void paint(session);
    return;
  }

  pendingPaint = setTimeout(() => {
    pendingPaint = null;
    // The table may have closed or moved on while the repaint was queued.
    if (table === session) void paint(session);
  }, MIN_PAINT_INTERVAL_MS - elapsed);
}

function cancelPendingPaint(): void {
  if (pendingPaint) {
    clearTimeout(pendingPaint);
    pendingPaint = null;
  }
}

// ============ BETTING WINDOW ============

/**
 * Arm the betting window. The first window of a session is longer, to give people time
 * to notice the table opened.
 */
function startBettingWindow(session: TableSession, firstOfSession: boolean): void {
  clearTimers(session);

  session.phase = 'betting';
  session.sessionKey = randomUUID();
  session.bets = [];

  const seconds: number = firstOfSession ? TIMING.FIRST_WINDOW_SECONDS : TIMING.NEXT_WINDOW_SECONDS;

  session.closesAt = Date.now() + seconds * 1000;
  session.windowTimer = setTimeout(() => {
    void runSpin();
  }, seconds * 1000);
}

/**
 * Push the window out when a bet lands, capped so a busy table still spins.
 */
function extendWindow(session: TableSession): void {
  if (session.phase !== 'betting' || !session.closesAt) return;

  const ceiling: number = Date.now() + TIMING.MAX_WINDOW_SECONDS * 1000;
  const extended: number = Math.min(
    session.closesAt + TIMING.BET_EXTENDS_BY_SECONDS * 1000,
    ceiling
  );

  if (extended <= session.closesAt) return;

  session.closesAt = extended;
  if (session.windowTimer) clearTimeout(session.windowTimer);
  session.windowTimer = setTimeout(() => {
    void runSpin();
  }, extended - Date.now());
}

// ============ PAYOUTS ============

/**
 * Resolve every bet and credit the winners.
 *
 * Exported for testing: this is the function that decides who gets paid, so it is
 * covered directly rather than through the timer-driven spin sequence.
 */
export async function processPayouts(
  bets: readonly RouletteBet[],
  resultNumber: string,
  resultColor: RouletteColor
): Promise<PayoutResult[]> {
  const results: PayoutResult[] = [];

  // Escrow rows whose outcome was fully applied. Anything omitted stays open on
  // purpose, so the startup sweep returns the stake.
  const settledEscrowIds: number[] = [];

  for (const bet of bets) {
    const betDef = BET_TYPES[bet.betType];

    if (!betDef) {
      // We cannot decide the outcome, so we must not keep the stake.
      console.error(
        `[ROULETTE] Unknown bet type "${bet.betType}" for ${bet.userId}; ` +
          `leaving escrow ${bet.escrowId} open for refund`
      );
      results.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        won: false,
        profit: 0,
        totalReturn: 0,
        paid: false,
        escrowId: bet.escrowId,
      });
      continue;
    }

    const won: boolean = betDef.matches(resultNumber, resultColor);

    if (!won) {
      // The stake was taken when escrow opened; a loss just resolves the row.
      settledEscrowIds.push(bet.escrowId);
      results.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        won: false,
        profit: 0,
        totalReturn: 0,
        paid: true,
        escrowId: bet.escrowId,
      });
      continue;
    }

    const profit: number = bet.amount * betDef.payout;
    const totalReturn: number = bet.amount + profit;

    try {
      const credited = await economyDb.addToWallet(bet.userId, totalReturn);

      // addToWallet returns null rather than throwing when the user row is missing,
      // so a null result is just as much a failure as an exception.
      if (!credited) throw new Error('addToWallet returned null - user row missing?');

      settledEscrowIds.push(bet.escrowId);
      results.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        won: true,
        profit,
        totalReturn,
        paid: true,
        escrowId: bet.escrowId,
      });
    } catch (err) {
      // Recording this as paid would have the database claim a payout the wallet never
      // received. Leaving the row open means the sweep returns the stake instead.
      console.error(
        `[ROULETTE] Payout of ${totalReturn} to ${bet.userId} FAILED; ` +
          `escrow ${bet.escrowId} left open for refund:`,
        err
      );
      results.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        won: true,
        profit,
        totalReturn,
        paid: false,
        escrowId: bet.escrowId,
      });
    }
  }

  try {
    await escrowDb.settleEscrowIds(settledEscrowIds);
  } catch (err) {
    // Non-fatal: unsettled rows are refunded by the next sweep, which errs toward
    // giving coins back.
    console.error('[ROULETTE] Failed to settle escrow rows:', err);
  }

  return results;
}

// ============ SPIN ============

/** Random pockets for the tumble frames - decoration only, never the result. */
function tumbleFrame(size: number): string[] {
  const frame: string[] = [];
  for (let i = 0; i < size; i++) {
    frame.push(WHEEL_POSITIONS[Math.floor(Math.random() * WHEEL_POSITIONS.length)]);
  }
  return frame;
}

/**
 * Lock betting, animate, pay out, then either open the next window or start the grace
 * timer.
 *
 * Payouts run exactly once and are isolated from every rendering call. An earlier
 * version ran them inside a try whose catch also ran them, so a throw from the result
 * edit credited every winner a second time.
 */
async function runSpin(): Promise<void> {
  const session = table;
  if (!session || session.phase !== 'betting') return;

  clearTimers(session);
  cancelPendingPaint();
  const bets: RouletteBet[] = session.bets;

  // Nobody bet this window: hold the table open briefly, then close it.
  if (bets.length === 0) {
    session.phase = 'betting';
    session.closesAt = null;
    await paint(session);
    startGracePeriod(session);
    return;
  }

  session.phase = 'spinning';
  session.closesAt = null;

  const resultNumber: string = WHEEL_POSITIONS[Math.floor(Math.random() * WHEEL_POSITIONS.length)];
  const resultColor: RouletteColor = getColor(resultNumber);

  // Frame 1: locked.
  await paint(session);
  await sleep(TIMING.SPIN_FRAME_MS);

  // Frame 2: ball tumbling wide.
  await paint(session, { tumbling: tumbleFrame(5) });
  await sleep(TIMING.SPIN_FRAME_MS);

  // Frame 3: slowing.
  await paint(session, { tumbling: tumbleFrame(3) });
  await sleep(TIMING.SPIN_FRAME_MS);

  // THE ONLY PAYOUT PASS.
  const results: PayoutResult[] = await processPayouts(bets, resultNumber, resultColor);

  const totalWagered: number = bets.reduce((sum, b) => sum + b.amount, 0);
  session.spinCount += 1;
  session.sessionWagered += totalWagered;
  session.recentSpins.unshift(resultNumber);
  session.recentSpins = session.recentSpins.slice(0, LIMITS.HISTORY_LENGTH);

  // Remember this round's bets so Rebet can replay them.
  session.lastRoundBets = new Map();
  for (const bet of bets) {
    const existing = session.lastRoundBets.get(bet.userId) ?? [];
    existing.push({ betType: bet.betType, amount: bet.amount });
    session.lastRoundBets.set(bet.userId, existing);
  }

  session.phase = 'result';
  await paint(session, {
    result: { position: resultNumber, color: resultColor },
    payouts: results.map((r) => ({
      userId: r.userId,
      betType: r.betType,
      amount: r.amount,
      profit: r.profit,
      won: r.won,
      paid: r.paid,
    })),
    bets: [],
  });

  void logSpin(session, resultNumber, resultColor, results, totalWagered, bets.length);

  await sleep(TIMING.RESULT_HOLD_MS);

  // The table may have been closed while the result was up.
  if (table !== session) return;

  startBettingWindow(session, false);
  await paint(session);
}

/** Persist the spin. Failure here must never affect play. */
async function logSpin(
  session: TableSession,
  resultNumber: string,
  resultColor: RouletteColor,
  results: readonly PayoutResult[],
  totalWagered: number,
  betCount: number
): Promise<void> {
  try {
    // Only count coins that actually reached a wallet, so history matches reality even
    // when a credit failed.
    const totalPaid: number = results
      .filter((r) => r.won && r.paid)
      .reduce((sum, r) => sum + r.totalReturn, 0);

    await rouletteDb.logCompleteRound(
      {
        resultNumber,
        resultColor,
        totalWagered,
        totalPaid,
        betCount,
        playerCount: new Set(results.map((r) => r.userId)).size,
      },
      results.map((r) => ({
        userId: r.userId,
        username: r.username,
        betType: r.betType,
        amount: r.amount,
        won: r.won,
        returned: r.won && r.paid ? r.totalReturn : 0,
      }))
    );
  } catch (err) {
    console.error('[ROULETTE] Failed to log spin:', err);
  }
  void session;
}

// ============ CLOSING ============

function startGracePeriod(session: TableSession): void {
  clearTimers(session);
  session.graceTimer = setTimeout(() => {
    void closeTable();
  }, TIMING.GRACE_SECONDS * 1000);
}

/**
 * Close the table and leave the final message as a session recap.
 *
 * Any bet still open at this point is refunded - the wheel is not going to spin for it.
 */
export async function closeTable(): Promise<void> {
  const session = table;
  if (!session) return;

  table = null;
  clearTimers(session);
  cancelPendingPaint();

  if (session.bets.length > 0) {
    try {
      await escrowDb.voidSession('roulette', session.sessionKey);
    } catch (err) {
      console.error('[ROULETTE] Failed to refund bets on table close:', err);
    }
  }

  session.phase = 'closed';
  session.closesAt = null;
  session.bets = [];
  await paint(session);
}

// ============ PUBLIC API ============

export function isTableOpen(): boolean {
  return table !== null;
}

export function getActiveSessionKey(): string | null {
  return table && table.phase === 'betting' ? table.sessionKey : null;
}

export function isBettingOpen(): boolean {
  return table?.phase === 'betting';
}

export function getUserBets(userId: string): RouletteBet[] {
  return table ? table.bets.filter((b) => b.userId === userId) : [];
}

export function getLastRoundBets(userId: string): { betType: string; amount: number }[] {
  return table?.lastRoundBets.get(userId) ?? [];
}

export function getRouletteChannelId(): string | undefined {
  return process.env.ROULETTE_CHANNEL_ID;
}

/**
 * Ensure a table is open, opening one if not.
 *
 * Race-safe: simultaneous first bets queue on a single open rather than each creating
 * a table and a message.
 */
export async function ensureTable(
  client: Client,
  channel: TextChannel,
  openedBy: string
): Promise<void> {
  if (table) return;

  if (openLock) {
    await openLock;
    return;
  }

  const opening: Promise<void> = openTable(client, channel, openedBy);
  openLock = opening;

  try {
    await opening;
  } finally {
    openLock = null;
  }
}

async function openTable(client: Client, channel: TextChannel, openedBy: string): Promise<void> {
  const session: TableSession = {
    client,
    channelId: channel.id,
    message: null,
    sessionKey: randomUUID(),
    phase: 'betting',
    bets: [],
    recentSpins: [],
    spinCount: 0,
    sessionWagered: 0,
    openedBy,
    closesAt: null,
    windowTimer: null,
    graceTimer: null,
    lastRoundBets: new Map(),
  };

  // Seed the strip from history so a fresh table is not blank.
  try {
    const recent = await rouletteDb.getRecentRounds(LIMITS.HISTORY_LENGTH);
    session.recentSpins = recent.map((r) => r.result_number);
  } catch (err) {
    console.error('[ROULETTE] Could not load recent spins:', err);
  }

  table = session;
  startBettingWindow(session, true);

  try {
    session.message = await channel.send(buildTableMessage(viewOf(session)) as never);
  } catch (err) {
    // No message means no table. Tear down rather than leaving timers running against
    // something nobody can see.
    console.error('[ROULETTE] Failed to open table message:', err);
    clearTimers(session);
    table = null;
    throw err;
  }
}

/**
 * Add a bet to the live window.
 *
 * @throws if betting is not open - the caller must void the bet's escrow when this happens
 */
export async function addBet(bet: RouletteBet): Promise<void> {
  const session = table;
  if (!session || session.phase !== 'betting') {
    throw new Error('Betting is closed');
  }

  session.bets.push(bet);
  extendWindow(session);
  schedulePaint(session);
}

/**
 * Remove a player's most recent bet and return its escrow id so the caller can refund it.
 *
 * @returns the removed bet, or null if the player has nothing to undo
 */
export function popLastBet(userId: string): RouletteBet | null {
  const session = table;
  if (!session || session.phase !== 'betting') return null;

  for (let i = session.bets.length - 1; i >= 0; i--) {
    if (session.bets[i].userId === userId) {
      return session.bets.splice(i, 1)[0];
    }
  }
  return null;
}

/**
 * Remove all of a player's bets and return them so the caller can refund each stake.
 */
export function popAllBets(userId: string): RouletteBet[] {
  const session = table;
  if (!session || session.phase !== 'betting') return [];

  const mine: RouletteBet[] = session.bets.filter((b) => b.userId === userId);
  session.bets = session.bets.filter((b) => b.userId !== userId);
  return mine;
}

/** Repaint after an external change, such as an undo. */
export async function refresh(): Promise<void> {
  if (table) schedulePaint(table);
}

/**
 * Test seam: drop the table without touching Discord or the database.
 */
export function __resetTableForTesting(): void {
  if (table) clearTimers(table);
  cancelPendingPaint();
  lastPaintAt = 0;
  table = null;
  openLock = null;
}
