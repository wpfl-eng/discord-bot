// Blackjack Table State
//
// One shared multi-seat table per process, on one six-deck shoe.
//
// SIMULTANEOUS ACTION
//
// Every seat acts at once on a single shared clock, rather than in strict seat order. A
// five-seat round played sequentially at 25 seconds a seat is over three minutes, and
// any idle player stalls everyone behind them - which does not survive contact with how
// people actually pay attention to Discord.
//
// The cost is that cards leave the shoe in click order rather than seat order. That
// costs nothing statistically and counting still works, since every card becomes
// visible by the end of the round, but it is not authentic seat-order play.
//
// RIDING STAKES
//
// A seat's stake stays in the circle round after round until the player changes it or
// stands up. If a wallet cannot cover the next round the seat is stood up with a notice
// rather than having its stake quietly reduced.
//
// MONEY
//
// Every stake is escrow-backed. Coins leave the wallet in the same transaction that
// opens the escrow row, and anything left open when the process dies is refunded by the
// startup sweep.

import { randomUUID } from 'node:crypto';
import { ChannelType, Client, Message, TextChannel } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import * as escrowDb from '../../economy/escrowDb.js';
import * as blackjackDb from '../../blackjack/blackjackDb.js';
import { pacingFor, sleep } from '../../casino/casinoPacing.js';
import { blackjackHeroSvg, renderHero, type Hero } from '../../casino/casinoHero.js';
import { createPainter, reclaimBoard } from '../../casino/casinoPaint.js';
import { createAdvanceGuard, type RecoveryContext } from '../../casino/casinoRecovery.js';
import {
  clearTableState,
  loadTableState,
  saveTableState,
  type BlackjackSnapshot,
} from '../../casino/casinoPersistence.js';
import { formatSigned, plural } from '../../casino/casinoFormat.js';
import {
  DEFAULT_TABLE,
  beginHand,
  calculateHandValue,
  createShoe,
  dealerShowsAce,
  drawFromShoe,
  isBlackjack,
  calculateInsuranceBet,
  type Card,
  type Hand,
  type Shoe,
} from './blackjackUtils.js';
import {
  MAX_HANDS,
  canDoubleHand,
  canSplitHand,
  canSurrenderHand,
  dealerMustPlay,
  doubleHand,
  hitHand,
  newHand,
  nextPlayableHand,
  playDealerTurn,
  resolveHand,
  resolveInsurance,
  splitHand,
  type HandResult,
  type PlayerHand,
} from './blackjackEngine.js';
import {
  resolvePerfectPairs,
  resolveTwentyOnePlusThree,
  type SideBetResult,
} from './blackjackSideBets.js';
import { buildBoard, type SeatView, type TablePhase, type TableView } from './blackjackRender.js';

// ============ TIMING ============

export const TIMING = {
  /** How long seats stay open before the first deal of a session */
  FIRST_WINDOW_SECONDS: 45,
  /** Between rounds, once the table is running */
  NEXT_WINDOW_SECONDS: 30,
  /** How long the table waits on insurance decisions */
  INSURANCE_SECONDS: 15,
  /**
   * The shared action clock. Bounded round length is the whole point of simultaneous
   * play, so this does not scale with seat count.
   */
  ACTION_SECONDS: 45,
  /** How long the settled frame stays up */
  SETTLE_HOLD_MS: 4_000,
  /** How long an empty table stays open before closing */
  GRACE_SECONDS: 45,
} as const;

export const LIMITS = {
  MIN_BET: 10,
  MAX_BET: 100_000,
  /** A side bet may not exceed the main stake, as at any real table */
  MAX_SIDE_RATIO: 1,
} as const;

// ============ TYPES ============

export interface SideBetStakes {
  readonly pairs: number;
  readonly p3: number;
}

interface Seat {
  readonly userId: string;
  username: string;
  /** Riding stake, used again each round until changed */
  stake: number;
  sideBets: SideBetStakes;

  hands: PlayerHand[];
  activeHandIndex: number;
  insuranceBet: number;
  insuranceSettled: boolean;

  /** Escrow rows holding this round's stakes */
  escrowIds: number[];

  results?: HandResult[];
  sideBetResults?: SideBetResult[];
  net?: number;

  /** True once this seat has been dealt in for the current round */
  inRound: boolean;
}

interface Table {
  phase: TablePhase;
  shoe: Shoe;
  dealerHand: Hand;
  hideHole: boolean;
  seats: Seat[];

  sessionKey: string;
  roundCount: number;

  message: Message | null;
  channelId: string;
  client: Client | null;

  deadline: number | null;
  windowTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;

  /** Rendered settle image, set only for a big round */
  hero: Hero | null;

  /**
   * True once this round has begun crediting wallets.
   *
   * Between that point and the escrow rows being marked settled, a row is paid but
   * still 'open'. Recovery must not void one, or the stake is handed back on top of
   * the payout.
   */
  settlementStarted: boolean;
}

// ============ STATE ============

let table: Table | null = null;

function createTable(channelId: string, client: Client): Table {
  return {
    phase: 'idle',
    // One persistent shoe for the whole table. This is what makes counting mean
    // anything, and why the single-deck table was dropped.
    shoe: createShoe(DEFAULT_TABLE.deckCount),
    dealerHand: [],
    hideHole: true,
    seats: [],
    sessionKey: randomUUID(),
    roundCount: 0,
    message: null,
    channelId,
    client,
    deadline: null,
    windowTimer: null,
    graceTimer: null,
    hero: null,
    settlementStarted: false,
  };
}

// ============ RENDERING ============

function seatView(seat: Seat, phase: TablePhase): SeatView {
  const stillPlaying: boolean = seat.hands.some((h) => h.status === 'playing');
  const acting: boolean =
    phase === 'acting' || phase === 'insurance' ? stillPlaying : phase === 'dealing';

  return {
    userId: seat.userId,
    username: seat.username,
    stake: seat.stake,
    hands: seat.hands,
    activeHandIndex: seat.activeHandIndex,
    insuranceBet: seat.insuranceBet,
    sideBets: seat.sideBets,
    results: seat.results,
    sideBetResults: seat.sideBetResults,
    net: seat.net,
    acting,
  };
}

function viewOf(t: Table): TableView {
  return {
    phase: t.phase,
    shoe: t.shoe,
    dealerHand: t.dealerHand,
    hideHole: t.hideHole,
    seats: t.seats.map((s) => seatView(s, t.phase)),
    deadline: t.deadline,
    roundCount: t.roundCount,
    roundStake: t.seats.reduce(
      (sum, s) => sum + s.hands.reduce((h, hand) => h + hand.bet, 0) + s.insuranceBet,
      0
    ),
    hero: t.hero,
  };
}

const painter = createPainter<Table>({
  label: 'BLACKJACK',
  getMessage: (t) => t.message,
  build: (t) => buildBoard(viewOf(t)),
  isCurrent: (t) => table === t,
});

/** Current board payload, for a handler acknowledging a click with update(). */
export function currentBoard(): ReturnType<typeof buildBoard> | null {
  return table ? buildBoard(viewOf(table)) : null;
}

/** Id of the board this table is driving, or null when there is none. See `repaintVia`. */
export function getBoardMessageId(): string | null {
  return table?.message?.id ?? null;
}

export function refresh(): void {
  if (table) painter.schedulePaint(table);
}

// ============ TIMERS ============

function clearTimers(t: Table): void {
  for (const key of ['windowTimer', 'graceTimer'] as const) {
    const timer = t[key];
    if (timer) {
      clearTimeout(timer);
      t[key] = null;
    }
  }
  painter.cancelPending();
}

function armWindow(t: Table, seconds: number, next: () => Promise<void>): void {
  if (t.windowTimer) clearTimeout(t.windowTimer);
  t.deadline = Date.now() + seconds * 1000;
  t.windowTimer = setTimeout(() => void next(), seconds * 1000);
}

// ============ RECOVERY ============

/**
 * Put the table back together after an advance threw.
 *
 * Order matters: the stakes are returned against the session key the failed round was
 * using, and only then does a new window rotate that key.
 */
async function recoverTable(context: RecoveryContext): Promise<void> {
  const t = table;
  if (!t) return;

  clearTimers(t);

  if (!t.settlementStarted) {
    try {
      await escrowDb.voidSession('blackjack', t.sessionKey);
    } catch (error: unknown) {
      console.error('[BLACKJACK] Could not return stakes after a failed advance:', error);
    }

    for (const seat of t.seats) {
      seat.escrowIds = [];
      seat.inRound = false;
    }
  }

  // The fault is still there. Re-arming would only fail again on the next window.
  if (context.exhausted) {
    await closeTable();
    return;
  }

  await armNextRound(t);
}

/**
 * Put the table into whatever comes after a round leaves the felt.
 *
 * Seats still down means another betting window; an empty table waits on the grace
 * timer instead. Both the end of a round and a recovered failure land here.
 */
async function armNextRound(t: Table): Promise<void> {
  if (t.seats.length > 0) {
    startBettingWindow(t, false);
    await painter.paintNow(t);
  } else {
    startGrace(t);
  }
}

const guard = createAdvanceGuard('BLACKJACK', recoverTable);

// ============ LOOKUP ============

function seatOf(userId: string): Seat | undefined {
  return table?.seats.find((s) => s.userId === userId);
}

export function getSeatView(userId: string): SeatView | null {
  const seat = seatOf(userId);
  if (!seat || !table) return null;
  return seatView(seat, table.phase);
}

export function isTableOpen(): boolean {
  return table !== null;
}

export function getPhase(): TablePhase {
  return table?.phase ?? 'idle';
}

export function isSeatingOpen(): boolean {
  return table?.phase === 'betting' || table?.phase === 'idle';
}

export function getBlackjackChannelId(): string | undefined {
  return process.env.BLACKJACK_CHANNEL_ID;
}

// ============ TABLE LIFECYCLE ============

export async function ensureTable(channel: TextChannel, client: Client): Promise<void> {
  if (table) {
    if (table.phase === 'idle' && table.graceTimer) {
      clearTimers(table);
      startBettingWindow(table, false);
      await painter.paintNow(table);
    }
    return;
  }

  const t = createTable(channel.id, client);
  table = t;

  t.message = await channel.send(buildBoard(viewOf(t)));
  startBettingWindow(t, true);
  await painter.paintNow(t);
}

function startBettingWindow(t: Table, firstOfSession: boolean): void {
  clearTimers(t);

  t.phase = 'betting';
  t.dealerHand = [];
  t.hideHole = true;
  t.hero = null;
  t.settlementStarted = false;
  t.sessionKey = randomUUID();

  for (const seat of t.seats) {
    seat.hands = [];
    seat.activeHandIndex = 0;
    seat.insuranceBet = 0;
    seat.insuranceSettled = false;
    seat.escrowIds = [];
    seat.results = undefined;
    seat.sideBetResults = undefined;
    seat.net = undefined;
    seat.inRound = false;
  }

  armWindow(t, firstOfSession ? TIMING.FIRST_WINDOW_SECONDS : TIMING.NEXT_WINDOW_SECONDS, () =>
    guard.run('closeSeating', closeSeating)
  );

  // Seats are stable between rounds, which is exactly what is worth persisting.
  void saveState();
}

function startGrace(t: Table): void {
  clearTimers(t);
  t.phase = 'idle';
  t.deadline = null;
  t.graceTimer = setTimeout(
    () => void guard.run('closeTable', closeTable),
    TIMING.GRACE_SECONDS * 1000
  );
  void painter.paintNow(t);
}

export async function closeTable(): Promise<void> {
  const t = table;
  if (!t) return;

  clearTimers(t);
  table = null;

  try {
    await escrowDb.voidSession('blackjack', t.sessionKey);
  } catch (error: unknown) {
    console.error('[BLACKJACK] Failed to void escrow on close:', error);
  }

  t.phase = 'idle';
  t.seats = [];

  // A closed table must not reopen itself on the next boot.
  await clearTableState('blackjack');

  try {
    if (t.message) await t.message.edit(buildBoard(viewOf(t)));
  } catch {
    // Board deleted or permissions changed. Nothing to recover.
  }
}

// ============ SEATING ============

export interface SitRequest {
  readonly userId: string;
  readonly username: string;
  readonly stake: number;
  readonly sideBets: SideBetStakes;
  readonly channel: TextChannel;
  readonly client: Client;
}

export interface SitResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Take a seat, or change the stake on one already held.
 *
 * No money moves here. Stakes are only charged when the round is dealt, which is what
 * lets a seat ride from round to round without the player clicking.
 */
export async function sit(request: SitRequest): Promise<SitResult> {
  const { userId, username, stake, sideBets, channel, client } = request;

  if (!Number.isInteger(stake) || stake < LIMITS.MIN_BET || stake > LIMITS.MAX_BET) {
    return {
      ok: false,
      message: `Stakes run from ${LIMITS.MIN_BET} to ${LIMITS.MAX_BET}.`,
    };
  }

  const sideTotal: number = sideBets.pairs + sideBets.p3;
  if (sideBets.pairs < 0 || sideBets.p3 < 0) {
    return { ok: false, message: 'Side bets cannot be negative.' };
  }
  if (sideBets.pairs > stake || sideBets.p3 > stake) {
    return { ok: false, message: 'A side bet cannot exceed your main stake.' };
  }

  const user = await economyDb.getOrCreateUser(userId, username);
  if (user.wallet < stake + sideTotal) {
    return {
      ok: false,
      message: `You need ${stake + sideTotal} in your wallet to sit for that.`,
    };
  }

  await ensureTable(channel, client);

  const t = table;
  if (!t) return { ok: false, message: 'The table just closed. Try again in a moment.' };

  if (t.phase !== 'betting') {
    return { ok: false, message: 'Seats are closed for this round — you are in for the next.' };
  }

  const existing = seatOf(userId);
  if (existing) {
    existing.stake = stake;
    existing.sideBets = sideBets;
    existing.username = username;
    painter.schedulePaint(t);
    return { ok: true, message: `Stake changed to ${stake}.` };
  }

  t.seats.push({
    userId,
    username,
    stake,
    sideBets,
    hands: [],
    activeHandIndex: 0,
    insuranceBet: 0,
    insuranceSettled: false,
    escrowIds: [],
    inRound: false,
  });

  painter.schedulePaint(t);
  return { ok: true, message: `Seated for ${stake}.` };
}

/**
 * Leave the table.
 *
 * Only legal between rounds: once cards are out the stake is committed and the hand has
 * to play through.
 */
export function standUp(userId: string): SitResult {
  const t = table;
  if (!t) return { ok: false, message: 'There is no table right now.' };

  const seat = seatOf(userId);
  if (!seat) return { ok: false, message: 'You are not seated.' };

  if (seat.inRound && t.phase !== 'settled') {
    return { ok: false, message: 'Your hand is live — you can stand up once it settles.' };
  }

  t.seats = t.seats.filter((s) => s.userId !== userId);
  painter.schedulePaint(t);
  return { ok: true, message: 'You have stood up. Your chips are yours.' };
}

/** Change only the riding stake, leaving side bets alone. */
export function setStake(userId: string, stake: number): SitResult {
  const seat = seatOf(userId);
  if (!seat || !table) return { ok: false, message: 'You are not seated.' };

  if (!Number.isInteger(stake) || stake < LIMITS.MIN_BET || stake > LIMITS.MAX_BET) {
    return { ok: false, message: `Stakes run from ${LIMITS.MIN_BET} to ${LIMITS.MAX_BET}.` };
  }

  seat.stake = stake;
  if (seat.sideBets.pairs > stake || seat.sideBets.p3 > stake) {
    seat.sideBets = {
      pairs: Math.min(seat.sideBets.pairs, stake),
      p3: Math.min(seat.sideBets.p3, stake),
    };
  }

  painter.schedulePaint(table);
  return { ok: true, message: `Riding stake is now ${stake}.` };
}

// ============ DEALING ============

/**
 * Charge every seat and deal the round.
 *
 * A seat whose wallet will not cover its riding stake is stood up with a notice rather
 * than being quietly dealt in for less.
 */
async function closeSeating(): Promise<void> {
  const t = table;
  if (!t || t.phase !== 'betting') return;

  clearTimers(t);
  t.phase = 'dealing';
  t.deadline = null;

  const evicted: Seat[] = [];

  for (const seat of t.seats) {
    const charged: boolean = await chargeSeat(t, seat);
    if (!charged) evicted.push(seat);
  }

  if (evicted.length > 0) {
    t.seats = t.seats.filter((s) => !evicted.includes(s));
    void notifyEvicted(t, evicted);
  }

  if (t.seats.length === 0) {
    startGrace(t);
    return;
  }

  t.roundCount += 1;
  beginHand(t.shoe);

  // Two rounds of cards, dealer last, exactly as at a real table.
  for (const seat of t.seats) {
    seat.hands = [newHand([drawFromShoe(t.shoe)], seat.stake)];
  }
  t.dealerHand = [drawFromShoe(t.shoe)];

  for (const seat of t.seats) {
    seat.hands[0].cards.push(drawFromShoe(t.shoe));
  }
  t.dealerHand.push(drawFromShoe(t.shoe));

  t.hideHole = true;
  await painter.paintNow(t);

  await settleSideBets(t);

  // Insurance is offered before anyone acts, only when the upcard is an ace.
  if (dealerShowsAce(t.dealerHand)) {
    t.phase = 'insurance';
    armWindow(t, TIMING.INSURANCE_SECONDS, () => guard.run('beginActing', beginActing));
    await painter.paintNow(t);
    return;
  }

  await beginActing();
}

/**
 * Take a seat's stakes into escrow.
 *
 * @returns false when the wallet could not cover it, meaning the seat is stood up
 */
async function chargeSeat(t: Table, seat: Seat): Promise<boolean> {
  const charges: {
    amount: number;
    purpose: escrowDb.EscrowPurpose;
    detail: Record<string, unknown>;
  }[] = [{ amount: seat.stake, purpose: 'bet', detail: { kind: 'main' } }];
  if (seat.sideBets.pairs > 0) {
    charges.push({ amount: seat.sideBets.pairs, purpose: 'sidebet', detail: { kind: 'pairs' } });
  }
  if (seat.sideBets.p3 > 0) {
    charges.push({ amount: seat.sideBets.p3, purpose: 'sidebet', detail: { kind: 'p3' } });
  }

  const opened: number[] = [];

  for (const charge of charges) {
    const escrow = await escrowDb.openEscrow({
      userId: seat.userId,
      username: seat.username,
      game: 'blackjack',
      sessionKey: t.sessionKey,
      amount: charge.amount,
      purpose: charge.purpose,
      detail: charge.detail,
    });

    if (!escrow.ok || escrow.escrowId === null) {
      // Partially charged. Give back what was taken rather than dealing a half-funded
      // seat in.
      for (const id of opened) {
        try {
          await escrowDb.voidEscrow(id, seat.userId);
        } catch {
          // The sweep will catch it.
        }
      }
      return false;
    }

    opened.push(escrow.escrowId);
  }

  seat.escrowIds = opened;
  seat.inRound = true;
  return true;
}

async function notifyEvicted(t: Table, evicted: readonly Seat[]): Promise<void> {
  if (!t.client) return;

  for (const seat of evicted) {
    try {
      const user = await t.client.users.fetch(seat.userId);
      await user.send(
        `Your blackjack seat could not be funded for ${seat.stake} this round, ` +
          'so you have been stood up. Top up and sit back in whenever you like.'
      );
    } catch {
      // DMs closed. The board already shows the seat is gone.
    }
  }
}

/**
 * Side bets settle the instant the cards are out, before anyone acts, which is exactly
 * why they cost nothing in turn logic.
 */
async function settleSideBets(t: Table): Promise<void> {
  const upcard: Card | undefined = t.dealerHand[0];

  for (const seat of t.seats) {
    if (seat.sideBets.pairs <= 0 && seat.sideBets.p3 <= 0) continue;

    const results: SideBetResult[] = [
      resolvePerfectPairs(seat.sideBets.pairs, seat.hands[0]?.cards ?? []),
      resolveTwentyOnePlusThree(seat.sideBets.p3, seat.hands[0]?.cards ?? [], upcard),
    ].filter((r) => r.stake > 0);

    seat.sideBetResults = results;

    for (const result of results) {
      if (result.payout <= 0) continue;
      try {
        await economyDb.addToWallet(seat.userId, result.payout);
      } catch (error: unknown) {
        console.error(`[BLACKJACK] Side bet payout to ${seat.userId} failed:`, error);
      }
    }
  }

  if (t.seats.some((s) => s.sideBetResults?.length)) {
    await painter.paintNow(t);
  }
}

// ============ ACTING ============

async function beginActing(): Promise<void> {
  const t = table;
  if (!t || (t.phase !== 'dealing' && t.phase !== 'insurance')) return;

  clearTimers(t);

  // The dealer peeks on an ace. A natural ends the round before anyone acts.
  if (isBlackjack(t.dealerHand)) {
    await finishRound(t);
    return;
  }

  // A seat dealt 21 has nothing to decide.
  for (const seat of t.seats) {
    for (const hand of seat.hands) {
      if (hand.cards.length === 2 && isBlackjack(hand.cards)) hand.status = 'stood';
    }
    seat.activeHandIndex = Math.max(0, nextPlayableHand(seat.hands));
  }

  if (everyoneDone(t)) {
    await finishRound(t);
    return;
  }

  t.phase = 'acting';
  armWindow(t, TIMING.ACTION_SECONDS, () => guard.run('timeOutActing', timeOutActing));
  await painter.paintNow(t);
}

function everyoneDone(t: Table): boolean {
  return t.seats.every((seat) => seat.hands.every((h) => h.status !== 'playing'));
}

/**
 * The shared clock expired. Anyone still deciding is stood, which is the safe default -
 * it never spends more of their money.
 */
async function timeOutActing(): Promise<void> {
  const t = table;
  if (!t || t.phase !== 'acting') return;

  for (const seat of t.seats) {
    for (const hand of seat.hands) {
      if (hand.status === 'playing') hand.status = 'stood';
    }
  }

  await finishRound(t);
}

export type PlayerAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
  /**
   * True when this action finished the round.
   *
   * `finishRound` owns the board from that moment and paints it several times over the
   * settle, so the handler must not also paint through its own interaction - the two
   * edits race and whichever lands last wins.
   */
  readonly roundEnded?: boolean;
}

/**
 * Apply an action to whoever clicked.
 *
 * Every button is shown to everyone because the board cannot know which are legal for
 * a given viewer, so this is where an illegal action is turned into an explanation.
 */
export async function act(userId: string, action: PlayerAction): Promise<ActionResult> {
  const t = table;
  if (!t) return { ok: false, message: 'There is no table right now.' };
  if (t.phase !== 'acting') {
    return { ok: false, message: 'It is not time to act.' };
  }

  const seat = seatOf(userId);
  if (!seat) return { ok: false, message: 'You are not seated. Sit in for the next round.' };

  const index: number = nextPlayableHand(seat.hands);
  if (index === -1) return { ok: false, message: 'Your hands are all done for this round.' };

  seat.activeHandIndex = index;
  const hand: PlayerHand = seat.hands[index];

  let result: ActionResult;

  switch (action) {
    case 'hit':
      hitHand(hand, t.shoe);
      result = { ok: true, message: 'Hit.' };
      break;

    case 'stand':
      hand.status = 'stood';
      result = { ok: true, message: 'Stood.' };
      break;

    case 'double':
      result = await doubleFor(t, seat, hand);
      break;

    case 'split':
      result = await splitFor(t, seat, hand, index);
      break;

    case 'surrender':
      if (!canSurrenderHand(hand, seat.hands.length)) {
        result = { ok: false, message: 'Surrender is only available on your opening hand.' };
      } else {
        hand.status = 'surrendered';
        result = { ok: true, message: 'Surrendered — half your stake comes back.' };
      }
      break;
  }

  if (result.ok) {
    seat.activeHandIndex = Math.max(0, nextPlayableHand(seat.hands));

    // Not waiting for the clock when nobody is left to act is most of what makes the
    // table feel quick.
    if (everyoneDone(t)) {
      void guard.run('finishRound', () => finishRound(t));
      return { ...result, roundEnded: true };
    }

    painter.schedulePaint(t);
  }

  return result;
}

async function doubleFor(t: Table, seat: Seat, hand: PlayerHand): Promise<ActionResult> {
  if (!canDoubleHand(hand)) {
    return { ok: false, message: 'You can only double on your first two cards.' };
  }

  const escrow = await escrowDb.openEscrow({
    userId: seat.userId,
    username: seat.username,
    game: 'blackjack',
    sessionKey: t.sessionKey,
    amount: hand.bet,
    purpose: 'double',
    detail: { kind: 'double' },
  });

  if (!escrow.ok || escrow.escrowId === null) {
    return { ok: false, message: `You need another ${hand.bet} in your wallet to double.` };
  }

  // The debit was an await; re-check the hand is still doubleable before spending it.
  if (t.phase !== 'acting' || !canDoubleHand(hand)) {
    try {
      await escrowDb.voidEscrow(escrow.escrowId, seat.userId);
    } catch {
      // Sweep will catch it.
    }
    return { ok: false, message: 'That hand moved on before the double landed.' };
  }

  seat.escrowIds.push(escrow.escrowId);
  doubleHand(hand, t.shoe, hand.bet);
  return { ok: true, message: 'Doubled.' };
}

async function splitFor(
  t: Table,
  seat: Seat,
  hand: PlayerHand,
  index: number
): Promise<ActionResult> {
  if (!canSplitHand(hand, seat.hands.length)) {
    return {
      ok: false,
      message:
        seat.hands.length >= MAX_HANDS
          ? `You can play at most ${MAX_HANDS} hands.`
          : 'That hand is not a matching pair.',
    };
  }

  const escrow = await escrowDb.openEscrow({
    userId: seat.userId,
    username: seat.username,
    game: 'blackjack',
    sessionKey: t.sessionKey,
    amount: hand.bet,
    purpose: 'split',
    detail: { kind: 'split' },
  });

  if (!escrow.ok || escrow.escrowId === null) {
    return { ok: false, message: `You need another ${hand.bet} in your wallet to split.` };
  }

  if (t.phase !== 'acting' || !canSplitHand(hand, seat.hands.length)) {
    try {
      await escrowDb.voidEscrow(escrow.escrowId, seat.userId);
    } catch {
      // Sweep will catch it.
    }
    return { ok: false, message: 'That hand moved on before the split landed.' };
  }

  seat.escrowIds.push(escrow.escrowId);
  const created: PlayerHand = splitHand(hand, t.shoe, hand.bet);
  seat.hands.splice(index + 1, 0, created);

  return { ok: true, message: 'Split.' };
}

// ============ INSURANCE ============

/**
 * Whether every seat has answered the insurance offer.
 *
 * A seat answers by taking it, which puts money up, or by declining it. Both set
 * `insuranceSettled`, so that flag alone is the answer. The clock is a backstop for a
 * seat that never answers - not a fixed fifteen seconds on every ace-upcard round.
 *
 * Exported as a plain predicate so the rule is testable without driving a round.
 */
export function everyoneAnsweredInsurance(
  seats: readonly { readonly insuranceSettled: boolean }[]
): boolean {
  return seats.length > 0 && seats.every((s) => s.insuranceSettled);
}

/** Move the round on as soon as nobody is left to answer. */
function closeInsuranceIfAnswered(t: Table): void {
  if (!everyoneAnsweredInsurance(t.seats)) return;
  void guard.run('beginActing', beginActing);
}

/**
 * Take insurance.
 *
 * Taking insurance on a natural IS even money - the two settle identically - so the
 * table asks once rather than twice.
 */
export async function takeInsurance(userId: string): Promise<ActionResult> {
  const t = table;
  if (!t || t.phase !== 'insurance') {
    return { ok: false, message: 'Insurance is not on offer right now.' };
  }

  const seat = seatOf(userId);
  if (!seat) return { ok: false, message: 'You are not seated.' };
  if (seat.insuranceBet > 0) return { ok: false, message: 'You already took insurance.' };

  const cost: number = calculateInsuranceBet(seat.hands[0]?.bet ?? seat.stake);

  const escrow = await escrowDb.openEscrow({
    userId: seat.userId,
    username: seat.username,
    game: 'blackjack',
    sessionKey: t.sessionKey,
    amount: cost,
    purpose: 'insurance',
    detail: { kind: 'insurance' },
  });

  if (!escrow.ok || escrow.escrowId === null) {
    return { ok: false, message: `You need ${cost} in your wallet for insurance.` };
  }

  if (t.phase !== 'insurance') {
    try {
      await escrowDb.voidEscrow(escrow.escrowId, seat.userId);
    } catch {
      // Sweep will catch it.
    }
    return { ok: false, message: 'Insurance closed before that went through.' };
  }

  seat.escrowIds.push(escrow.escrowId);
  seat.insuranceBet = cost;
  seat.insuranceSettled = true;

  painter.schedulePaint(t);
  closeInsuranceIfAnswered(t);

  return { ok: true, message: `Insured for ${cost}.` };
}

export function declineInsurance(userId: string): ActionResult {
  const t = table;
  if (!t || t.phase !== 'insurance') {
    return { ok: false, message: 'Insurance is not on offer right now.' };
  }

  const seat = seatOf(userId);
  if (!seat) return { ok: false, message: 'You are not seated.' };

  seat.insuranceSettled = true;
  closeInsuranceIfAnswered(t);

  return { ok: true, message: 'No insurance.' };
}

// ============ SETTLEMENT ============

async function finishRound(t: Table): Promise<void> {
  if (t.phase === 'dealer' || t.phase === 'settled') return;

  clearTimers(t);
  t.phase = 'dealer';
  t.hideHole = false;
  t.deadline = null;

  await painter.paintNow(t);

  const anyoneStanding: boolean = t.seats.some((s) => dealerMustPlay(s.hands));
  if (anyoneStanding) {
    playDealerTurn(t.dealerHand, t.shoe, DEFAULT_TABLE);
    await painter.paintNow(t);
  }

  const settledEscrowIds: number[] = [];

  // Past this line a wallet may have been credited against an escrow row that is still
  // 'open', so recovery must stop offering to hand this round's stakes back.
  t.settlementStarted = true;

  for (const seat of t.seats) {
    if (!seat.inRound) continue;

    seat.results = seat.hands.map((hand) => resolveHand(hand, t.dealerHand));

    const insurancePayout: number = resolveInsurance(seat.insuranceBet, t.dealerHand);
    const handPayout: number = seat.results.reduce((sum, r) => sum + r.payout, 0);
    const totalPayout: number = handPayout + insurancePayout;

    const staked: number = seat.hands.reduce((sum, h) => sum + h.bet, 0) + seat.insuranceBet;

    // Side bets already settled at the deal; fold their net into the round total so the
    // board reports what the seat actually did.
    const sideNet: number = (seat.sideBetResults ?? []).reduce((sum, r) => sum + r.net, 0);
    seat.net = totalPayout - staked + sideNet;

    if (totalPayout > 0) {
      try {
        const credited = await economyDb.addToWallet(seat.userId, totalPayout);
        if (!credited) throw new Error('addToWallet returned null - user row missing?');
        settledEscrowIds.push(...seat.escrowIds);
      } catch (error: unknown) {
        // Leaving the rows open means the sweep returns the stakes, rather than the
        // database claiming a payout the wallet never received.
        console.error(
          `[BLACKJACK] Payout of ${totalPayout} to ${seat.userId} FAILED; ` +
            'escrow left open for refund:',
          error
        );
      }
    } else {
      settledEscrowIds.push(...seat.escrowIds);
    }

    void recordSeatStats(seat);
  }

  if (settledEscrowIds.length > 0) {
    try {
      await escrowDb.settleEscrowIds(settledEscrowIds);
    } catch (error: unknown) {
      console.error('[BLACKJACK] Failed to settle escrow rows:', error);
    }
  }

  t.phase = 'settled';

  const swing: number = t.seats.reduce((sum, s) => sum + Math.abs(s.net ?? 0), 0);
  const pacing = pacingFor(swing);

  // A big round earns a rendered settle. Null whenever sharp is unavailable, in which
  // case the board simply reads as text.
  t.hero = pacing.hero ? await buildSettleHero(t) : null;

  await painter.paintNow(t);
  await sleep(Math.max(TIMING.SETTLE_HOLD_MS, pacing.holdMs));

  if (table !== t) return;

  await armNextRound(t);
}

/** The settle image: the dealer's final total against how the table did. */
async function buildSettleHero(t: Table): Promise<Hero | null> {
  const dealerTotal: number = calculateHandValue(t.dealerHand);
  const dealerLabel: string = dealerTotal > 21 ? 'BUST' : String(dealerTotal);

  const winners: number = t.seats.filter((s) => (s.net ?? 0) > 0).length;
  const headline: string =
    dealerTotal > 21 ? 'DEALER BUSTS' : winners > 0 ? `${winners} PAID` : 'HOUSE TAKES IT';

  const swing: number = t.seats.reduce((sum, s) => sum + (s.net ?? 0), 0);
  const caption: string = `${plural(t.seats.length, 'seat')} · table ${formatSigned(swing)}`;

  return renderHero(
    blackjackHeroSvg(dealerLabel, headline, caption),
    `Blackjack settle: dealer ${dealerLabel}, ${headline}`
  );
}

/** Roll a seat's round into its lifetime stats. Decoration; never blocks the table. */
async function recordSeatStats(seat: Seat): Promise<void> {
  if (!seat.results) return;

  for (let i = 0; i < seat.results.length; i++) {
    const result = seat.results[i];
    const hand = seat.hands[i];
    if (!hand) continue;

    try {
      await blackjackDb.recordGameResult({
        userId: seat.userId,
        username: seat.username,
        outcome:
          result.outcome === 'blackjack'
            ? 'win'
            : result.outcome === 'surrender'
              ? 'loss'
              : result.outcome,
        bet: hand.bet,
        payout: result.payout,
        wasBlackjack: result.outcome === 'blackjack',
        wasBust: result.isBust,
        wasDouble: hand.doubled,
        wasSplit: hand.fromSplit,
        wasInsurance: seat.insuranceBet > 0,
        wasSurrender: result.outcome === 'surrender',
      });
    } catch (error: unknown) {
      console.error(`[BLACKJACK] Failed to record stats for ${seat.userId}:`, error);
    }
  }
}

// ============ PERSISTENCE ============

/**
 * Save the table's between-round state.
 *
 * Called whenever seats settle into a stable shape: a new betting window, a player
 * sitting or standing. Never called mid-round, because mid-round state is deliberately
 * not persisted.
 */
export async function saveState(): Promise<void> {
  const t = table;
  if (!t) return;

  await saveTableState<BlackjackSnapshot>('blackjack', t.channelId, {
    messageId: t.message?.id,
    seats: t.seats.map((s) => ({
      userId: s.userId,
      username: s.username,
      stake: s.stake,
      sideBets: s.sideBets,
    })),
    shoe: { cards: t.shoe.cards },
    roundCount: t.roundCount,
  });
}

/**
 * Bring a table back after a restart.
 *
 * Seats and the shoe are restored; every hand that was live has already been refunded by
 * the startup escrow sweep, so the table simply reopens for a fresh round.
 *
 * @returns true when a table was restored
 */
export async function restoreState(client: Client): Promise<boolean> {
  const snapshot = await loadTableState<BlackjackSnapshot>('blackjack');
  if (!snapshot || snapshot.state.seats.length === 0) return false;

  try {
    const channel = await client.channels.fetch(snapshot.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    const textChannel = channel as TextChannel;
    const t = createTable(textChannel.id, client);

    // The shoe carries on from where it was. A count that survived the restart is still
    // a valid count.
    if (snapshot.state.shoe.cards.length > 0) {
      t.shoe.cards = snapshot.state.shoe.cards as Card[];
    }
    t.roundCount = snapshot.state.roundCount;

    t.seats = snapshot.state.seats.map((s) => ({
      userId: s.userId,
      username: s.username,
      stake: s.stake,
      sideBets: s.sideBets,
      hands: [],
      activeHandIndex: 0,
      insuranceBet: 0,
      insuranceSettled: false,
      escrowIds: [],
      inRound: false,
    }));

    table = t;
    t.message = await reclaimBoard(
      textChannel,
      snapshot.state.messageId,
      buildBoard(viewOf(t)),
      'BLACKJACK'
    );
    startBettingWindow(t, true);
    await painter.paintNow(t);

    console.log(`[BLACKJACK] Restored ${t.seats.length} seat(s) after restart`);
    return true;
  } catch (error: unknown) {
    console.error('[BLACKJACK] Failed to restore table:', error);
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
