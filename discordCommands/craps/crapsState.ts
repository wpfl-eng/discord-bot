// Craps State Management
//
// One shared table per process, driven by timers and by the shooter's own ROLL button.
//
// SHOOTER
//
// The dice genuinely belong to one player. They keep them until they seven out, at
// which point the dice pass to the next player in the queue. A shooter who goes quiet
// does not freeze the table: after a short grace the house throws for them.
//
// This only works because the engine now distinguishes a line DECISION from the end of
// a SESSION. Previously every come-out 7 or 11 was treated as the end of the session,
// so the shooter changed constantly and the role meant nothing.
//
// MONEY
//
// Every stake is escrow-backed. Coins leave the wallet in the same transaction that
// opens the escrow row, so the two can never disagree, and anything left open when the
// process dies is refunded by the startup sweep.

import { randomUUID } from 'node:crypto';
import { ChannelType, Client, TextChannel, Message } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import * as escrowDb from '../../economy/escrowDb.js';
import * as crapsDb from '../../craps/crapsDb.js';
import { pacingFor, sleep, type Pacing } from '../../casino/casinoPacing.js';
import { crapsHeroSvg, renderHero, type Hero } from '../../casino/casinoHero.js';
import { createPainter, reclaimBoard } from '../../casino/casinoPaint.js';
import { createAdvanceGuard, type RecoveryContext } from '../../casino/casinoRecovery.js';
import {
  clearTableState,
  loadTableState,
  saveTableState,
  type CrapsSnapshot,
} from '../../casino/casinoPersistence.js';
import {
  type Roll,
  type BetType,
  type TableStatus,
  type SessionOutcome,
  TIMING,
  LIMITS,
  BET_TYPES,
  rollDice,
  getRollName,
  getBetDisplay,
  formatAmount,
  getCrapsChannelId,
} from './crapsConfig.js';
import {
  type CrapsBet,
  type RollResolutionResult,
  canPlaceBetType,
  canPlaceOdds,
  canTakeDown,
  checkDuplicateBet,
  generateBetId,
  getUserExposure,
  resolveAllBets,
} from './crapsEngine.js';
import {
  buildBoard,
  type BoardPhase,
  type BoardView,
  type RenderBet,
  type RenderResult,
} from './crapsRender.js';

// ============ TYPE DEFINITIONS ============

export interface ShooterInfo {
  readonly userId: string;
  readonly username: string;
}

interface TableSession {
  phase: BoardPhase;
  point: number | null;
  shooter: ShooterInfo | null;
  /** Everyone who has had action this table, in arrival order - the rotation queue */
  queue: ShooterInfo[];
  bets: CrapsBet[];
  rollHistory: Roll[];
  lastRoll: Roll | null;
  rollName: string | undefined;
  results: RenderResult[] | undefined;
  sevenOut: boolean;
  nextShooter: string | null;
  tumbling: Roll[] | undefined;
  /** Rendered result image, set only for a big roll */
  hero: Hero | null;

  /**
   * True once this roll has begun crediting wallets.
   *
   * Between a credit and its escrow row being marked settled the row is paid but still
   * 'open'. Recovery must not void one, or the stake is returned on top of the payout.
   */
  settlementStarted: boolean;

  /** Groups every escrow row for this shooter's turn */
  sessionKey: string;
  sessionWagered: number;
  sessionPaid: number;
  rollCount: number;
  startedAt: Date;
  /**
   * Every settled bet this shooter session, accumulated for one write at the end.
   *
   * craps_sessions is per shooter turn, so writing per roll would fragment a single
   * turn across many rows.
   */
  betLog: crapsDb.LogBetData[];

  message: Message | null;
  channelId: string;
  client: Client | null;

  deadline: number | null;
  windowTimer: NodeJS.Timeout | null;
  shooterTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
}

export interface PlaceBetResult {
  readonly success: boolean;
  readonly message: string;
  readonly bet?: CrapsBet;
  readonly tableJustOpened?: boolean;
}

// ============ STATE ============

let table: TableSession | null = null;

function createSession(channelId: string, client: Client): TableSession {
  return {
    phase: 'idle',
    point: null,
    shooter: null,
    queue: [],
    bets: [],
    rollHistory: [],
    lastRoll: null,
    rollName: undefined,
    results: undefined,
    sevenOut: false,
    nextShooter: null,
    tumbling: undefined,
    hero: null,
    settlementStarted: false,
    sessionKey: randomUUID(),
    sessionWagered: 0,
    sessionPaid: 0,
    rollCount: 0,
    startedAt: new Date(),
    betLog: [],
    message: null,
    channelId,
    client,
    deadline: null,
    windowTimer: null,
    shooterTimer: null,
    graceTimer: null,
  };
}

// ============ RENDERING ============

function toRenderBets(bets: readonly CrapsBet[]): RenderBet[] {
  return bets
    .filter((b) => b.status === 'active')
    .map((b) => ({
      userId: b.userId,
      betType: b.betType,
      amount: b.amount,
      oddsPoint: b.oddsPoint,
    }));
}

function viewOf(session: TableSession): BoardView {
  return {
    phase: session.phase,
    point: session.point,
    shooter: session.shooter,
    bets: toRenderBets(session.bets),
    recentRolls: session.rollHistory.map((r) => r.total),
    lastRoll: session.lastRoll,
    rollName: session.rollName,
    results: session.results,
    deadline: session.deadline,
    rollCount: session.rollCount,
    sessionWagered: session.sessionWagered,
    tumbling: session.tumbling,
    sevenOut: session.sevenOut,
    nextShooter: session.nextShooter,
    hero: session.hero,
  };
}

const painter = createPainter<TableSession>({
  label: 'CRAPS',
  getMessage: (session) => session.message,
  build: (session) => buildBoard(viewOf(session)),
  isCurrent: (session) => table === session,
});

/** Current board payload, for a handler acknowledging a click with update(). */
export function currentBoard(): ReturnType<typeof buildBoard> | null {
  return table ? buildBoard(viewOf(table)) : null;
}

/**
 * Id of the board the table is actually driving, or null when there is none.
 *
 * A click carries the message it came from, and a board left behind by an earlier run
 * still has working buttons. Comparing against this is how a handler tells a live click
 * apart from one on a board nobody is painting any more.
 */
export function getBoardMessageId(): string | null {
  return table?.message?.id ?? null;
}

/** Request a coalesced repaint. Safe to call on every bet. */
export function refresh(): void {
  if (table) painter.schedulePaint(table);
}

// ============ TIMERS ============

function clearTimers(session: TableSession): void {
  for (const key of ['windowTimer', 'shooterTimer', 'graceTimer'] as const) {
    const timer = session[key];
    if (timer) {
      clearTimeout(timer);
      session[key] = null;
    }
  }
  painter.cancelPending();
}

/**
 * Open the betting window.
 *
 * The come-out window is longer than a between-rolls window: a new shooter is a moment
 * people want time to react to, while a point-phase roll should keep the game moving.
 */
function startBettingWindow(session: TableSession): void {
  clearTimers(session);

  session.phase = 'betting';
  session.results = undefined;
  session.tumbling = undefined;
  session.hero = null;
  session.sevenOut = false;
  session.nextShooter = null;
  session.settlementStarted = false;

  const seconds: number =
    session.point === null ? TIMING.COMEOUT_BETTING_SECONDS : TIMING.POINT_BETTING_SECONDS;

  session.deadline = Date.now() + seconds * 1000;
  session.windowTimer = setTimeout(
    () => void guard.run('closeBetting', closeBetting),
    seconds * 1000
  );

  // The rotation is stable between rolls, which is what is worth persisting.
  void saveState();
}

/** Push the window out when a bet lands, capped so a busy table still rolls. */
function extendWindow(session: TableSession): void {
  if (session.phase !== 'betting' || !session.deadline) return;

  const ceiling: number = Date.now() + TIMING.MAX_BETTING_SECONDS * 1000;
  const extended: number = Math.min(session.deadline + TIMING.BET_EXTENDS_TIMER_BY * 1000, ceiling);
  if (extended <= session.deadline) return;

  session.deadline = extended;
  if (session.windowTimer) clearTimeout(session.windowTimer);
  session.windowTimer = setTimeout(
    () => void guard.run('closeBetting', closeBetting),
    extended - Date.now()
  );
}

// ============ RECOVERY ============

/**
 * Whether this turn's stakes can still be handed back.
 *
 * False from the moment `settleResolution` starts crediting wallets: between a credit
 * and its escrow row being marked settled the row is paid but still 'open', so voiding
 * it would return a stake the player has already been paid.
 *
 * Exported as a plain predicate so the rule is testable without driving a whole roll.
 */
export function canVoidTurn(settlementStarted: boolean): boolean {
  return !settlementStarted;
}

/**
 * Put the table back together after an advance threw.
 *
 * A voided turn takes the point with it. The point belongs to a shooter's turn whose
 * bets have just been returned, so leaving it up would show a contract nobody is on.
 */
async function recoverTable(context: RecoveryContext): Promise<void> {
  const session = table;
  if (!session) return;

  clearTimers(session);

  if (canVoidTurn(session.settlementStarted)) {
    try {
      await escrowDb.voidSession('craps', session.sessionKey);
    } catch (error: unknown) {
      console.error('[CRAPS] Could not return stakes after a failed advance:', error);
    }

    session.bets = [];
    session.point = null;
    // A fresh key, so a later void can never reach the rows just returned.
    session.sessionKey = randomUUID();
  }

  // The fault is still there. Re-arming would only fail again on the next window.
  if (context.exhausted) {
    await closeTable();
    return;
  }

  if (session.queue.length > 0) {
    startBettingWindow(session);
    await painter.paintNow(session);
  } else {
    startGracePeriod(session);
  }
}

const guard = createAdvanceGuard('CRAPS', recoverTable);

/**
 * Lock betting and hand the dice to the shooter.
 *
 * The grace timer is what keeps the shooter role meaningful without letting one absent
 * player hold everyone else up.
 */
async function closeBetting(): Promise<void> {
  const session = table;
  if (!session || session.phase !== 'betting') return;

  clearTimers(session);

  if (activeBets(session).length === 0) {
    // Nothing at risk. Do not spend a roll on an empty table.
    startGracePeriod(session);
    return;
  }

  session.phase = 'awaiting_roll';
  session.deadline = Date.now() + TIMING.SHOOTER_GRACE_SECONDS * 1000;
  session.shooterTimer = setTimeout(
    () => void executeRoll(true),
    TIMING.SHOOTER_GRACE_SECONDS * 1000
  );

  await painter.paintNow(session);
}

function startGracePeriod(session: TableSession): void {
  clearTimers(session);
  session.phase = 'idle';
  session.deadline = null;
  session.graceTimer = setTimeout(
    () => void guard.run('closeTable', closeTable),
    TIMING.GRACE_PERIOD_SECONDS * 1000
  );
  void painter.paintNow(session);
}

// ============ ROLLING ============

function activeBets(session: TableSession): CrapsBet[] {
  return session.bets.filter((b) => b.status === 'active');
}

/** Random dice for the tumble frames - decoration only, never the result. */
function tumbleFrames(count: number): Roll[] {
  return Array.from({ length: count }, () => rollDice());
}

/**
 * Throw the dice, resolve everything, then either keep the shooter going or pass the
 * dice on.
 *
 * @param automatic - true when the grace timer fired rather than the shooter clicking
 */
export async function executeRoll(automatic: boolean = false): Promise<void> {
  // Guarded here rather than at the shooter timer, because the ROLL button reaches this
  // from a component handler too and that path needs the same recovery.
  await guard.run('executeRoll', () => runRoll(automatic));
}

async function runRoll(automatic: boolean): Promise<void> {
  const session = table;
  if (!session || session.phase !== 'awaiting_roll') return;

  clearTimers(session);

  const atRisk: number = activeBets(session).reduce((sum, b) => sum + b.amount, 0);
  const pacing: Pacing = pacingFor(atRisk);

  // ---- animate ----
  session.phase = 'rolling';
  session.deadline = null;
  for (let frame = 0; frame < pacing.frames; frame++) {
    session.tumbling = tumbleFrames(2);
    await painter.paintNow(session);
    await sleep(pacing.frameMs);
  }
  session.tumbling = undefined;

  // ---- roll ----
  const roll: Roll = rollDice();
  const pointBefore: number | null = session.point;

  session.lastRoll = roll;
  session.rollHistory.push(roll);
  session.rollCount += 1;
  session.rollName = getRollName(roll.total, pointBefore);

  if (automatic && session.shooter) {
    console.log(`[CRAPS] Rolled for ${session.shooter.username} after the grace period`);
  }

  // ---- resolve ----
  const resolution: RollResolutionResult = resolveAllBets(activeBets(session), roll, pointBefore);
  const paid = await settleResolution(session, resolution);

  session.results = paid;
  session.phase = 'resolved';
  session.sevenOut = resolution.sessionEnded;

  // A big roll earns a rendered result. Null whenever sharp is unavailable, in which
  // case the board simply reads as text.
  session.hero = pacing.hero
    ? await renderHero(
        crapsHeroSvg(roll.die1, roll.die2, session.rollName ?? String(roll.total)),
        `Craps roll: ${roll.die1} and ${roll.die2}, total ${roll.total}`
      )
    : null;

  // Bets that resolved leave the table; multi-roll bets that are still pending ride on.
  session.bets = session.bets.filter((b) => b.status === 'active');

  // ---- advance the table ----
  if (resolution.sessionEnded) {
    const next: ShooterInfo | null = nextInQueue(session);
    session.nextShooter = next?.userId ?? null;
  } else if (resolution.pointEstablished !== null) {
    session.point = resolution.pointEstablished;
  } else if (resolution.sessionOutcome === 'point_hit') {
    // The point is made and the same shooter starts a fresh come-out.
    session.point = null;
  }

  await painter.paintNow(session);
  await sleep(pacing.holdMs);

  if (table !== session) return;

  if (resolution.sessionEnded) {
    await passTheDice(session);
  } else if (activeBets(session).length > 0 || session.queue.length > 0) {
    startBettingWindow(session);
    await painter.paintNow(session);
  } else {
    startGracePeriod(session);
  }
}

/**
 * Credit every winner and close out the escrow rows whose outcome was fully applied.
 *
 * A payout that fails leaves its escrow row open on purpose: the startup sweep then
 * returns the stake, rather than the database claiming a payout the wallet never got.
 */
async function settleResolution(
  session: TableSession,
  resolution: RollResolutionResult
): Promise<RenderResult[]> {
  // Past this line a wallet may have been credited against an escrow row that is still
  // 'open', so recovery must stop offering to hand this turn's stakes back.
  session.settlementStarted = true;

  const settledEscrowIds: number[] = [];
  const netByUser = new Map<string, number>();

  const addNet = (userId: string, net: number): void => {
    netByUser.set(userId, (netByUser.get(userId) ?? 0) + net);
  };

  for (const result of resolution.betResults) {
    const { bet, outcome, payout } = result;
    if (outcome === 'pending') continue;

    if (outcome === 'lose') {
      // The stake was taken when escrow opened; a loss only resolves the row.
      settledEscrowIds.push(...bet.escrowIds);
      addNet(bet.userId, -bet.amount);
      session.betLog.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        outcome: 'lost',
        payout: 0,
      });
      continue;
    }

    // win, push and win_and_stay all move coins back to the player.
    try {
      const credited = await economyDb.addToWallet(bet.userId, payout);
      if (!credited) throw new Error('addToWallet returned null - user row missing?');

      // A place bet that paid and stayed keeps its stake at risk, so its escrow row
      // must stay open. Everything else is done.
      if (outcome !== 'win_and_stay') {
        settledEscrowIds.push(...bet.escrowIds);
      }

      addNet(bet.userId, outcome === 'win' ? payout - bet.amount : outcome === 'push' ? 0 : payout);
      session.sessionPaid += payout;
      session.betLog.push({
        userId: bet.userId,
        username: bet.username,
        betType: bet.betType,
        amount: bet.amount,
        outcome: outcome === 'push' ? 'push' : 'won',
        payout,
      });
    } catch (error: unknown) {
      console.error(
        `[CRAPS] Payout of ${payout} to ${bet.userId} FAILED; ` +
          `escrow ${bet.escrowIds.join(', ')} left open for refund:`,
        error
      );
    }
  }

  if (settledEscrowIds.length > 0) {
    try {
      await escrowDb.settleEscrowIds(settledEscrowIds);
    } catch (error: unknown) {
      // Non-fatal: unsettled rows are refunded by the next sweep, which errs toward
      // giving coins back.
      console.error('[CRAPS] Failed to settle escrow rows:', error);
    }
  }

  return [...netByUser.entries()].map(([userId, net]) => ({ userId, net }));
}

// ============ SHOOTER ROTATION ============

/** The player after the current shooter in the queue, wrapping around. */
function nextInQueue(session: TableSession): ShooterInfo | null {
  if (session.queue.length === 0) return null;
  if (!session.shooter) return session.queue[0];

  const index: number = session.queue.findIndex((p) => p.userId === session.shooter?.userId);
  if (index === -1) return session.queue[0];

  return session.queue[(index + 1) % session.queue.length] ?? null;
}

/**
 * A seven-out ends the shooter's turn. Everything on the table has already resolved, so
 * the point comes off, a new escrow session starts and the next player takes the dice.
 */
async function passTheDice(session: TableSession): Promise<void> {
  await recordSession(session, 'seven_out');

  const next: ShooterInfo | null = nextInQueue(session);

  session.point = null;
  session.shooter = next;
  session.rollCount = 0;
  session.rollHistory = [];
  session.sessionKey = randomUUID();
  session.sessionWagered = 0;
  session.sessionPaid = 0;
  session.betLog = [];
  session.startedAt = new Date();
  session.bets = [];

  if (!next) {
    startGracePeriod(session);
    return;
  }

  startBettingWindow(session);
  await painter.paintNow(session);
}

// ============ PERSISTENCE ============

/**
 * Write the whole shooter session, then roll each player's lifetime stats forward.
 *
 * Called once when the dice pass, not once per roll: `craps_sessions` is keyed to a
 * shooter's turn, and a per-roll write would fragment one turn across many rows.
 *
 * Stats are decoration. A failure here must never interrupt a live table.
 */
async function recordSession(session: TableSession, outcome: SessionOutcome): Promise<void> {
  if (session.betLog.length === 0 && session.rollCount === 0) return;

  try {
    await crapsDb.logCompleteSession(
      {
        channelId: session.channelId,
        shooterUserId: session.shooter?.userId ?? null,
        shooterUsername: session.shooter?.username ?? null,
        point: session.point,
        rollCount: session.rollCount,
        outcome,
        totalWagered: session.sessionWagered,
        totalPaid: session.sessionPaid,
        rollHistory: session.rollHistory,
        startedAt: session.startedAt,
      },
      session.betLog
    );
  } catch (error: unknown) {
    console.error('[CRAPS] Failed to log session:', error);
  }

  // Group the session's bets per player so each gets exactly one stats update.
  const perUser = new Map<string, crapsDb.LogBetData[]>();
  for (const entry of session.betLog) {
    const existing = perUser.get(entry.userId) ?? [];
    existing.push(entry);
    perUser.set(entry.userId, existing);
  }

  for (const [userId, entries] of perUser) {
    try {
      await crapsDb.updatePlayerStats({
        userId,
        username: entries[0]?.username ?? 'unknown',
        wasShooter: session.shooter?.userId === userId,
        sessionOutcome: outcome,
        rollCount: session.rollCount,
        bets: entries.map((e) => ({
          betType: e.betType,
          amount: e.amount,
          outcome: e.outcome,
          payout: e.payout,
        })),
      });
    } catch (error: unknown) {
      console.error(`[CRAPS] Failed to update stats for ${userId}:`, error);
    }
  }
}

// ============ TABLE LIFECYCLE ============

export function isTableOpen(): boolean {
  return table !== null;
}

export function getTableStatus(): TableStatus {
  if (!table) return 'idle';
  if (table.phase === 'betting') return 'betting';
  if (table.phase === 'rolling' || table.phase === 'awaiting_roll') return 'rolling';
  if (table.phase === 'resolved') return 'resolved';
  return 'idle';
}

export function getCurrentPoint(): number | null {
  return table?.point ?? null;
}

export function isBettingOpen(): boolean {
  return table?.phase === 'betting';
}

export function getActiveSessionKey(): string | null {
  return table?.sessionKey ?? null;
}

export function getShooter(): ShooterInfo | null {
  return table?.shooter ?? null;
}

export function getUserBets(userId: string): CrapsBet[] {
  return (table?.bets ?? []).filter((b) => b.userId === userId && b.status === 'active');
}

export function getUserTotalExposure(userId: string): number {
  return getUserExposure(table?.bets ?? [], userId);
}

export { getCrapsChannelId };

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
    status: getTableStatus(),
    point: table?.point ?? null,
    shooter: table?.shooter ?? null,
    rollCount: table?.rollCount ?? 0,
    totalWagered: table?.sessionWagered ?? 0,
    activeBetCount: table ? activeBets(table).length : 0,
    bettingEndsAt: table?.deadline ?? null,
  };
}

/** Open the table if it is not already up. */
export async function ensureTable(channel: TextChannel, client: Client): Promise<void> {
  if (table) {
    // A table in its grace period is still alive; a new bet revives it.
    if (table.phase === 'idle' && table.graceTimer) {
      clearTimers(table);
      startBettingWindow(table);
    }
    return;
  }

  const session = createSession(channel.id, client);
  table = session;

  session.message = await channel.send(buildBoard(viewOf(session)));
  startBettingWindow(session);
  await painter.paintNow(session);
}

/** Shut the table down and record whatever it managed. */
export async function closeTable(): Promise<void> {
  const session = table;
  if (!session) return;

  clearTimers(session);
  table = null;

  // Anything still at risk when the table shuts belongs to nobody. Hand it back.
  try {
    await escrowDb.voidSession('craps', session.sessionKey);
  } catch (error: unknown) {
    console.error('[CRAPS] Failed to void escrow on close:', error);
  }

  session.phase = 'idle';
  session.bets = [];
  session.deadline = null;

  // A closed table must not reopen itself on the next boot.
  await clearTableState('craps');

  try {
    if (session.message) await session.message.edit(buildBoard(viewOf(session)));
  } catch {
    // The board may have been deleted. Nothing to recover.
  }
}

// ============ BETTING ============

export interface BetRequest {
  readonly userId: string;
  readonly username: string;
  readonly betType: BetType;
  readonly amount: number;
  readonly channel: TextChannel;
  readonly client: Client;
}

/**
 * Place a bet.
 *
 * Order matters: the table is opened first so the wager has a session to belong to,
 * then the coins are taken atomically, then the bet joins the table. Because the debit
 * is an await, every precondition is re-checked afterwards - and if the bet cannot be
 * attached the stake is handed straight back rather than waiting for the sweep.
 */
export async function placeBet(request: BetRequest): Promise<PlaceBetResult> {
  const { userId, username, betType, amount, channel, client } = request;

  if (!BET_TYPES[betType]) {
    return { success: false, message: `Unknown bet type: "${betType}".` };
  }

  if (!Number.isInteger(amount) || amount < LIMITS.MIN_BET || amount > LIMITS.MAX_BET) {
    return {
      success: false,
      message: `Bets run from ${formatAmount(LIMITS.MIN_BET)} to ${formatAmount(LIMITS.MAX_BET)}.`,
    };
  }

  const justOpened: boolean = table === null;
  await ensureTable(channel, client);

  const session = table;
  if (!session) return { success: false, message: 'The table just closed. Try again in a moment.' };

  if (session.phase !== 'betting') {
    return { success: false, message: 'Bets are closed for this roll. Hang on for the next one.' };
  }

  const phaseCheck = canPlaceBetType(betType, session.point);
  if (!phaseCheck.allowed) {
    return { success: false, message: phaseCheck.reason ?? 'That bet is not available now.' };
  }

  const duplicate = checkDuplicateBet(session.bets, userId, betType);
  if (!duplicate.allowed) {
    return { success: false, message: duplicate.reason ?? 'You already have that bet.' };
  }

  // Odds carry rules no other bet does: they need a parent line bet and are capped at a
  // multiple of it that varies by point.
  let oddsPoint: number | undefined;
  let parentBetId: string | undefined;

  if (BET_TYPES[betType].family === 'odds') {
    const check = canPlaceOdds(session.bets, userId, betType, session.point, amount);
    if (!check.allowed) {
      return { success: false, message: check.reason ?? 'You cannot back that.' };
    }
    oddsPoint = session.point ?? undefined;
    parentBetId = check.parent?.id;
  }

  const exposure: number = getUserExposure(session.bets, userId);
  if (exposure + amount > LIMITS.MAX_EXPOSURE) {
    return {
      success: false,
      message:
        `That would put you ${formatAmount(exposure + amount)} in the air; ` +
        `the table caps one player at ${formatAmount(LIMITS.MAX_EXPOSURE)}.`,
    };
  }

  const escrow = await escrowDb.openEscrow({
    userId,
    username,
    game: 'craps',
    sessionKey: session.sessionKey,
    amount,
    purpose: BET_TYPES[betType].family === 'odds' ? 'odds' : 'bet',
    detail: { betType, point: session.point },
  });

  if (!escrow.ok || escrow.escrowId === null) {
    return { success: false, message: `You do not have ${formatAmount(amount)} in your wallet.` };
  }

  // The debit was an await. Re-check the table is still the one we validated against,
  // and still taking bets, before attaching anything to it.
  if (table !== session || session.phase !== 'betting') {
    await refundEscrow([escrow.escrowId], userId);
    return {
      success: false,
      message: 'Bets closed while that was going through — stake returned.',
    };
  }

  const existing = duplicate.aggregate
    ? session.bets.find(
        (b) => b.userId === userId && b.betType === betType && b.status === 'active'
      )
    : undefined;

  let bet: CrapsBet;

  if (existing) {
    // Aggregating keeps one row on the board, but each stake keeps its own escrow row,
    // so the whole thing settles or comes down for exactly what was put up.
    existing.amount += amount;
    existing.escrowIds.push(escrow.escrowId);
    bet = existing;
  } else {
    bet = {
      id: generateBetId(),
      userId,
      username,
      betType,
      amount,
      placedAt: new Date(),
      status: 'active',
      escrowIds: [escrow.escrowId],
      parentBetId,
      oddsPoint,
    };
    session.bets.push(bet);
  }

  session.sessionWagered += amount;

  // First bettor takes the dice; everyone else joins the rotation behind them.
  if (!session.queue.some((p) => p.userId === userId)) {
    session.queue.push({ userId, username });
  }
  if (!session.shooter) session.shooter = { userId, username };

  extendWindow(session);
  painter.schedulePaint(session);

  return {
    success: true,
    message: `${formatAmount(amount)} on ${getBetDisplay(betType)}`,
    bet,
    tableJustOpened: justOpened,
  };
}

async function refundEscrow(escrowIds: readonly number[], userId: string): Promise<void> {
  if (escrowIds.length === 0) return;

  try {
    // One transaction for every row behind the bet, rather than one per row.
    await escrowDb.voidEscrowIds(escrowIds, userId);
  } catch (error: unknown) {
    console.error(
      `[CRAPS] Failed to refund escrow ${escrowIds.join(', ')}; sweep will catch it:`,
      error
    );
  }
}

/**
 * Pull a player's most recent removable bet back off the table.
 *
 * @returns the amount returned, or null if there was nothing to take down
 */
export async function undoLastBet(userId: string): Promise<number | null> {
  const session = table;
  if (!session || session.phase !== 'betting') return null;

  for (let i = session.bets.length - 1; i >= 0; i--) {
    const bet = session.bets[i];
    if (bet.userId !== userId || bet.status !== 'active') continue;
    if (!canTakeDown(bet.betType, session.point)) continue;

    session.bets.splice(i, 1);
    await refundEscrow(bet.escrowIds, userId);
    session.sessionWagered = Math.max(0, session.sessionWagered - bet.amount);

    painter.schedulePaint(session);
    return bet.amount;
  }

  return null;
}

/**
 * Take down everything a player can legally remove.
 *
 * The pass line stays put once a point is on - it is a contract bet.
 *
 * @returns the total returned
 */
export async function takeDownAll(userId: string): Promise<number> {
  const session = table;
  if (!session || session.phase !== 'betting') return 0;

  const removable = session.bets.filter(
    (b) => b.userId === userId && b.status === 'active' && canTakeDown(b.betType, session.point)
  );

  // Every row behind every removable bet, returned in one transaction, so the total
  // reported back is the total the player actually receives.
  const escrowIds: number[] = removable.flatMap((bet) => bet.escrowIds);
  await refundEscrow(escrowIds, userId);

  const returned: number = removable.reduce((sum, bet) => sum + bet.amount, 0);

  session.bets = session.bets.filter((b) => !removable.includes(b));
  session.sessionWagered = Math.max(0, session.sessionWagered - returned);

  painter.schedulePaint(session);
  return returned;
}

/** Whether this user is the one holding the dice. */
export function isShooter(userId: string): boolean {
  return table?.shooter?.userId === userId;
}

/** Whether the table is waiting on a throw right now. */
export function isAwaitingRoll(): boolean {
  return table?.phase === 'awaiting_roll';
}

// ============ PERSISTENCE ============

/**
 * Save the shooter rotation and the recent roll strip.
 *
 * The POINT is deliberately not saved. It belongs to a shooter's turn whose bets have
 * just been refunded by the escrow sweep, so that turn is void and restoring its point
 * would leave the table mid-hand with nothing on it.
 */
export async function saveState(): Promise<void> {
  const session = table;
  if (!session) return;

  await saveTableState<CrapsSnapshot>('craps', session.channelId, {
    messageId: session.message?.id,
    queue: session.queue.map((player) => ({
      userId: player.userId,
      username: player.username,
    })),
    shooterUserId: session.shooter?.userId ?? null,
    recentRolls: session.rollHistory.map((r) => r.total).slice(-12),
  });
}

/**
 * Bring the table back after a restart, with the same people in the same order.
 *
 * @returns true when a table was restored
 */
export async function restoreState(client: Client): Promise<boolean> {
  const snapshot = await loadTableState<CrapsSnapshot>('craps');
  if (!snapshot || snapshot.state.queue.length === 0) return false;

  try {
    const channel = await client.channels.fetch(snapshot.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    const textChannel = channel as TextChannel;
    const session = createSession(textChannel.id, client);

    session.queue = snapshot.state.queue.map((player) => ({ ...player }));
    session.shooter =
      session.queue.find((p) => p.userId === snapshot.state.shooterUserId) ??
      session.queue[0] ??
      null;

    table = session;
    session.message = await reclaimBoard(
      textChannel,
      snapshot.state.messageId,
      buildBoard(viewOf(session)),
      'CRAPS'
    );
    startBettingWindow(session);
    await painter.paintNow(session);

    console.log(`[CRAPS] Restored table with ${session.queue.length} player(s)`);
    return true;
  } catch (error: unknown) {
    console.error('[CRAPS] Failed to restore table:', error);
    return false;
  }
}

// ============ TEST SEAM ============

export function __resetTableForTesting(): void {
  if (table) clearTimers(table);
  table = null;
  guard.reset();
  painter.reset();
}
