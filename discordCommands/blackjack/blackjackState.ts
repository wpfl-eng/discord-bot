// Blackjack Game State
//
// Owns live hands, the per-player shoe, and every button handler.
//
// Interactions are routed rather than collected. Each click arrives with its own
// token and drives update(), so a Play Again streak never expires - the previous
// version replayed through a spoofed interaction that reused the ORIGINAL token and
// silently died after 15 minutes, stacking a fresh collector on the message each time.

import { randomUUID } from 'node:crypto';
import {
  ChatInputCommandInteraction,
  TextChannel,
  type ButtonInteraction,
  type MessageComponentInteraction,
} from 'discord.js';

/**
 * Everything blackjack presents through. Discord's RepliableInteraction union does not
 * admit the abstract MessageComponentInteraction, and the game only ever uses buttons,
 * so this is the precise set rather than a cast.
 */
type HandInteraction = ChatInputCommandInteraction | ButtonInteraction;
import * as economyDb from '../../economy/economyDb.js';
import * as escrowDb from '../../economy/escrowDb.js';
import type { EconomyUser } from '../../types/database.js';
import { CONFIG, CHANNELS, formatCurrency } from '../../economy/economyConfig.js';
import * as blackjackDb from '../../blackjack/blackjackDb.js';
import type { BlackjackStats } from '../../blackjack/blackjackDb.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import {
  TABLES,
  DEFAULT_TABLE,
  beginHand,
  calculateInsuranceBet,
  createShoe,
  dealerShowsAce,
  drawFromShoe,
  isBlackjack,
  shouldDealerPeek,
  type Hand,
  type Shoe,
  type TableConfig,
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
  totalStaked,
  type HandResult,
  type PlayerHand,
} from './blackjackEngine.js';
import {
  IDS,
  buildEvenMoneyPrompt,
  buildGameMessage,
  buildInsurancePrompt,
  type GameView,
  type RenderedMessage,
} from './blackjackRender.js';

// ============ TYPES ============

type Phase = 'insurance' | 'even_money' | 'playing' | 'finished';

interface GameState {
  readonly userId: string;
  readonly username: string;
  /** Groups every escrow row for this hand */
  readonly sessionKey: string;
  readonly table: TableConfig;
  shoe: Shoe;
  dealerHand: Hand;
  hands: PlayerHand[];
  activeHandIndex: number;
  readonly originalBet: number;
  insuranceBet: number;
  evenMoneyTaken: boolean;
  phase: Phase;
  /** Latest interaction, so the timeout can still edit the ephemeral message */
  lastInteraction: HandInteraction;
  timeoutTimer: NodeJS.Timeout | null;
  /**
   * The player's wallet after the most recent money movement, for the footer. Kept on
   * the game so a repaint does not re-read the row on every button click; nothing else
   * moves the wallet while a hand is live.
   */
  balance: number;
}

// ============ STATE ============

const activeGames = new Map<string, GameState>();
const cooldowns = new Map<string, number>();

/**
 * Persistent shoes, keyed by player and table.
 *
 * Only the multi-deck table keeps one. A deeply-dealt single deck is the configuration
 * where counting genuinely beats the house, so Classic re-shuffles every hand.
 */
const shoes = new Map<string, Shoe>();

function shoeKey(userId: string, table: TableConfig): string {
  return `${userId}:${table.name}`;
}

function usesPersistentShoe(table: TableConfig): boolean {
  return table.deckCount > 1;
}

/**
 * The shoe this hand will be dealt from, shuffling if the cut card has come out.
 */
function acquireShoe(userId: string, table: TableConfig): Shoe {
  if (!usesPersistentShoe(table)) {
    const fresh: Shoe = createShoe(table.deckCount);
    fresh.justShuffled = false;
    return fresh;
  }

  const key: string = shoeKey(userId, table);
  let shoe: Shoe | undefined = shoes.get(key);
  if (!shoe) {
    shoe = createShoe(table.deckCount);
    shoes.set(key, shoe);
  }
  beginHand(shoe);
  return shoe;
}

// ============ ACCESSORS ============

export function hasActiveGame(userId: string): boolean {
  return activeGames.has(userId);
}

/** Remaining cooldown in seconds, or 0 when the player may deal. */
export function cooldownRemaining(userId: string): number {
  const last: number | undefined = cooldowns.get(userId);
  if (last === undefined) return 0;

  const elapsed: number = Date.now() - last;
  const cooldownMs: number = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
  return elapsed >= cooldownMs ? 0 : Math.ceil((cooldownMs - elapsed) / 1000);
}

/** Test seam: drop all state without touching Discord or the database. */
export function __resetForTesting(): void {
  for (const game of activeGames.values()) {
    if (game.timeoutTimer) clearTimeout(game.timeoutTimer);
  }
  activeGames.clear();
  cooldowns.clear();
  shoes.clear();
}

// ============ VIEW ============

function viewOf(game: GameState, balance: number, extra: Partial<GameView> = {}): GameView {
  const active: PlayerHand | undefined = game.hands[game.activeHandIndex];
  const finished: boolean = game.phase === 'finished';

  return {
    table: game.table,
    shoe: usesPersistentShoe(game.table) ? game.shoe : null,
    dealerHand: game.dealerHand,
    hideHole: !finished,
    hands: game.hands,
    activeHandIndex: game.activeHandIndex,
    insuranceBet: game.insuranceBet,
    balance,
    originalBet: game.originalBet,
    canDouble: !finished && active ? canDoubleHand(active) : false,
    canSplit: !finished && active ? canSplitHand(active, game.hands.length) : false,
    canSurrender: !finished && active ? canSurrenderHand(active, game.hands.length) : false,
    ...extra,
  };
}

/**
 * Push a view to the player's ephemeral message.
 *
 * A component interaction updates the message it came from; anything else edits the
 * original reply. Both keep the hand on a single message rather than accumulating one
 * per action.
 */
async function present(interaction: HandInteraction, message: RenderedMessage): Promise<void> {
  try {
    if (interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
      await interaction.update(message);
    } else {
      await interaction.editReply(message);
    }
  } catch (err) {
    console.error('[BLACKJACK] Failed to present hand:', err);
  }
}

// ============ TIMEOUT ============

/**
 * Auto-stand an abandoned hand.
 *
 * Routed buttons have no collector to expire, so the timer lives on the game. It fires
 * well inside the interaction token's 15-minute life, so the message can still be
 * updated when it does.
 */
function armTimeout(game: GameState): void {
  if (game.timeoutTimer) clearTimeout(game.timeoutTimer);

  game.timeoutTimer = setTimeout(() => {
    void (async () => {
      const current: GameState | undefined = activeGames.get(game.userId);
      if (!current || current !== game || current.phase === 'finished') return;

      for (const hand of current.hands) {
        if (hand.status === 'playing') hand.status = 'stood';
      }
      await finishGame(current, current.lastInteraction, 'Timed out — standing on every hand.');
    })();
  }, CONFIG.BLACKJACK_TIMEOUT_SECONDS * 1000);
}

function disarmTimeout(game: GameState): void {
  if (game.timeoutTimer) {
    clearTimeout(game.timeoutTimer);
    game.timeoutTimer = null;
  }
}

// ============ STAKES ============

/**
 * Take coins and record them as at-risk, in one transaction.
 *
 * Every blackjack debit goes through here so a hand interrupted by a restart leaves
 * rows the startup sweep can refund.
 */
async function takeStake(
  game: GameState,
  amount: number,
  purpose: escrowDb.EscrowPurpose
): Promise<EconomyUser | null> {
  const result: escrowDb.OpenEscrowResult = await escrowDb.openEscrow({
    userId: game.userId,
    username: game.username,
    game: 'blackjack',
    sessionKey: game.sessionKey,
    amount,
    purpose,
  });

  if (!result.ok) return null;

  // openEscrow returns the debited row, so the cached balance stays current without
  // another read.
  if (result.user) game.balance = result.user.wallet;
  return result.user;
}

// ============ DEALING ============

export interface StartGameOptions {
  readonly interaction: ChatInputCommandInteraction;
  readonly amount: number;
  readonly table: TableConfig;
}

/**
 * Deal a new hand. The bet must already have been validated against the wallet.
 */
export async function startGame(options: StartGameOptions): Promise<void> {
  const { interaction, amount, table } = options;
  await dealHand(interaction, interaction.user.id, interaction.user.username, amount, table);
}

async function dealHand(
  interaction: HandInteraction,
  userId: string,
  username: string,
  amount: number,
  table: TableConfig
): Promise<void> {
  const sessionKey: string = randomUUID();
  const shoe: Shoe = acquireShoe(userId, table);

  const game: GameState = {
    userId,
    username,
    sessionKey,
    table,
    shoe,
    dealerHand: [],
    hands: [],
    activeHandIndex: 0,
    originalBet: amount,
    insuranceBet: 0,
    evenMoneyTaken: false,
    phase: 'playing',
    lastInteraction: interaction,
    timeoutTimer: null,
    balance: 0,
  };

  const staked: EconomyUser | null = await takeStake(game, amount, 'bet');
  if (!staked) {
    const cleared: RenderedMessage = {
      flags: 64,
      components: [],
      allowedMentions: { parse: [] },
    };
    await present(interaction, cleared);
    await interaction.editReply({ content: 'Could not place that bet. Please try again.' });
    return;
  }

  cooldowns.set(userId, Date.now());

  game.hands = [newHand([drawFromShoe(shoe), drawFromShoe(shoe)], amount)];
  game.dealerHand = [drawFromShoe(shoe), drawFromShoe(shoe)];

  activeGames.set(userId, game);

  const playerNatural: boolean = isBlackjack(game.hands[0].cards);

  // Dealer peek. Offering insurance or even money first is what stops a player
  // committing a double or split against a hole card the dealer has already seen.
  if (shouldDealerPeek(game.dealerHand)) {
    if (dealerShowsAce(game.dealerHand)) {
      if (playerNatural) {
        game.phase = 'even_money';
        armTimeout(game);
        await present(interaction, buildEvenMoneyPrompt(viewOf(game, staked.wallet)));
        return;
      }

      const insuranceCost: number = calculateInsuranceBet(amount);
      if (staked.wallet >= insuranceCost && insuranceCost > 0) {
        game.phase = 'insurance';
        armTimeout(game);
        await present(
          interaction,
          buildInsurancePrompt(viewOf(game, staked.wallet), insuranceCost)
        );
        return;
      }
    }

    // Showing a ten: peek silently, and settle immediately either way if it matters.
    if (isBlackjack(game.dealerHand) || playerNatural) {
      await finishGame(game, interaction);
      return;
    }
  } else if (playerNatural) {
    await finishGame(game, interaction);
    return;
  }

  armTimeout(game);
  await present(interaction, buildGameMessage(viewOf(game, staked.wallet)));
}

// ============ RESOLUTION ============

/**
 * Play out the dealer, settle every hand, and present the result.
 *
 * @param note optional line explaining an automatic resolution, such as a timeout
 */
async function finishGame(
  game: GameState,
  interaction: HandInteraction,
  note?: string
): Promise<void> {
  disarmTimeout(game);
  game.phase = 'finished';

  if (dealerMustPlay(game.hands)) {
    playDealerTurn(game.dealerHand, game.shoe, game.table);
  }

  const results: HandResult[] = game.hands.map((hand) =>
    resolveHand(hand, game.dealerHand, { evenMoney: game.evenMoneyTaken })
  );

  const insurancePayout: number = resolveInsurance(game.insuranceBet, game.dealerHand);
  const handPayout: number = results.reduce((sum, r) => sum + r.payout, 0);
  const totalPayout: number = handPayout + insurancePayout;
  const totalStake: number = totalStaked(game.hands, game.insuranceBet);
  const netProfit: number = totalPayout - totalStake;

  let updatedUser: EconomyUser | null;
  if (totalPayout > 0) {
    updatedUser = await economyDb.gambleWin(game.userId, totalPayout);
  } else {
    updatedUser = await economyDb.getUser(game.userId);
  }

  // Settle only once the payout has landed. A credit that failed leaves the rows open
  // so the startup sweep returns the stakes, rather than recording a hand as settled
  // that the player was never paid for.
  if (totalPayout > 0 && !updatedUser) {
    console.error(
      `[BLACKJACK] Payout of ${totalPayout} to ${game.userId} failed; ` +
        `leaving escrow session ${game.sessionKey} open for refund`
    );
  } else {
    try {
      await escrowDb.settleSession('blackjack', game.sessionKey);
    } catch (err) {
      console.error('[BLACKJACK] Failed to settle escrow:', err);
    }
  }

  const stats: BlackjackStats | null = await recordStats(game, results);

  activeGames.delete(game.userId);
  cooldowns.set(game.userId, Date.now());

  const balance: number = updatedUser?.wallet ?? 0;

  await present(
    interaction,
    buildGameMessage(
      viewOf(game, balance, {
        hideHole: false,
        results,
        insurancePayout: game.insuranceBet > 0 ? insurancePayout : undefined,
        netProfit,
        canPlayAgain: balance >= game.originalBet,
        streakNote: note ?? streakNote(stats),
      })
    )
  );

  void announceNatural(game, results, interaction);
  void fireAchievements(game, netProfit, totalPayout);
}

function streakNote(stats: BlackjackStats | null): string | undefined {
  if (!stats) return undefined;
  if (stats.current_streak > 1) return `${stats.current_streak} win streak`;
  if (stats.current_streak < -1) return `${Math.abs(stats.current_streak)} loss streak`;
  return undefined;
}

/** Record one row per hand, so a four-hand split reads as four results. */
async function recordStats(
  game: GameState,
  results: readonly HandResult[]
): Promise<BlackjackStats | null> {
  let last: BlackjackStats | null = null;

  for (let i = 0; i < game.hands.length; i++) {
    const hand: PlayerHand = game.hands[i];
    const result: HandResult = results[i];

    const outcome: 'win' | 'loss' | 'push' =
      result.outcome === 'push'
        ? 'push'
        : result.outcome === 'win' || result.outcome === 'blackjack'
          ? 'win'
          : 'loss';

    try {
      last = await blackjackDb.recordGameResult({
        userId: game.userId,
        username: game.username,
        outcome,
        bet: hand.bet,
        payout: result.payout,
        wasBlackjack: result.outcome === 'blackjack',
        wasBust: result.isBust,
        wasDouble: hand.doubled,
        wasSplit: hand.fromSplit,
        // Insurance is one side bet on the hand, so it belongs to the first row only.
        wasInsurance: i === 0 && game.insuranceBet > 0,
        wasSurrender: result.outcome === 'surrender',
      });
    } catch (err) {
      console.error('[BLACKJACK] Failed to record stats:', err);
    }
  }

  return last;
}

async function fireAchievements(
  game: GameState,
  netProfit: number,
  totalPayout: number
): Promise<void> {
  if (netProfit === 0) return;

  try {
    await checkForAchievements({
      actionType: netProfit > 0 ? ACTION_TYPES.BLACKJACK_WIN : ACTION_TYPES.BLACKJACK_LOSE,
      userId: game.userId,
      username: game.username,
      client: game.lastInteraction.client,
      amount: netProfit > 0 ? totalPayout : Math.abs(netProfit),
    });
  } catch (err) {
    console.error('[BLACKJACK] Failed to check achievements:', err);
  }
}

/** Announce a natural to the casino channel, as the other games do for big wins. */
async function announceNatural(
  game: GameState,
  results: readonly HandResult[],
  interaction: HandInteraction
): Promise<void> {
  const natural: HandResult | undefined = results.find((r) => r.outcome === 'blackjack');
  if (!natural || !CHANNELS.CASINO) return;

  try {
    const channel = await interaction.client.channels.fetch(CHANNELS.CASINO);
    if (!channel || !('send' in channel)) return;

    await (channel as TextChannel).send({
      content:
        `🃏 **BLACKJACK!** <@${game.userId}> hit a natural for ` +
        `${formatCurrency(natural.payout)} on a ${formatCurrency(game.originalBet)} bet.`,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[BLACKJACK] Failed to announce natural:', err);
  }
}

// ============ TURN ADVANCEMENT ============

/**
 * Move to the next hand still in play, or settle if the player is done.
 */
async function advance(game: GameState, interaction: HandInteraction): Promise<void> {
  const next: number = nextPlayableHand(game.hands);

  if (next === -1) {
    await finishGame(game, interaction);
    return;
  }

  game.activeHandIndex = next;
  game.lastInteraction = interaction;
  armTimeout(game);

  await present(interaction, buildGameMessage(viewOf(game, game.balance)));
}

// ============ BUTTON HANDLERS ============

/**
 * Entry point for every blackjack component interaction.
 */
export async function handleComponent(interaction: MessageComponentInteraction): Promise<void> {
  // The game is button-only; anything else on this prefix is not ours to handle.
  if (!interaction.isButton()) return;

  const userId: string = interaction.user.id;

  if (interaction.customId.startsWith(IDS.PLAY_AGAIN)) {
    await handlePlayAgain(interaction);
    return;
  }

  const game: GameState | undefined = activeGames.get(userId);
  if (!game) {
    await interaction.reply({
      content: 'That hand is no longer active. Start a new one with `/blackjack`.',
      ephemeral: true,
    });
    return;
  }

  game.lastInteraction = interaction;

  switch (interaction.customId) {
    case IDS.INSURANCE_YES:
    case IDS.INSURANCE_NO:
      await handleInsurance(game, interaction, interaction.customId === IDS.INSURANCE_YES);
      return;
    case IDS.EVEN_MONEY_YES:
    case IDS.EVEN_MONEY_NO:
      await handleEvenMoney(game, interaction, interaction.customId === IDS.EVEN_MONEY_YES);
      return;
    case IDS.HIT:
      await handleHit(game, interaction);
      return;
    case IDS.STAND:
      await handleStand(game, interaction);
      return;
    case IDS.DOUBLE:
      await handleDouble(game, interaction);
      return;
    case IDS.SPLIT:
      await handleSplit(game, interaction);
      return;
    case IDS.SURRENDER:
      await handleSurrender(game, interaction);
      return;
    default:
      await interaction.reply({ content: 'That control is no longer active.', ephemeral: true });
  }
}

async function handleInsurance(
  game: GameState,
  interaction: ButtonInteraction,
  take: boolean
): Promise<void> {
  if (game.phase !== 'insurance') {
    await interaction.deferUpdate();
    return;
  }

  if (take) {
    const cost: number = calculateInsuranceBet(game.originalBet);
    const staked: EconomyUser | null = await takeStake(game, cost, 'insurance');

    // The wallet can move between the offer and the confirm. Treating a failed debit
    // as declined is what stops free insurance being granted.
    if (staked) game.insuranceBet = cost;
  }

  game.phase = 'playing';

  // Now the peek matters: a dealer natural ends the hand immediately.
  if (isBlackjack(game.dealerHand)) {
    await finishGame(game, interaction);
    return;
  }

  await advance(game, interaction);
}

async function handleEvenMoney(
  game: GameState,
  interaction: ButtonInteraction,
  take: boolean
): Promise<void> {
  if (game.phase !== 'even_money') {
    await interaction.deferUpdate();
    return;
  }

  game.evenMoneyTaken = take;
  game.phase = 'playing';
  await finishGame(game, interaction);
}

async function handleHit(game: GameState, interaction: ButtonInteraction): Promise<void> {
  const hand: PlayerHand | undefined = game.hands[game.activeHandIndex];
  if (!hand || hand.status !== 'playing') {
    await interaction.deferUpdate();
    return;
  }

  hitHand(hand, game.shoe);
  await advance(game, interaction);
}

async function handleStand(game: GameState, interaction: ButtonInteraction): Promise<void> {
  const hand: PlayerHand | undefined = game.hands[game.activeHandIndex];
  if (!hand || hand.status !== 'playing') {
    await interaction.deferUpdate();
    return;
  }

  hand.status = 'stood';
  await advance(game, interaction);
}

async function handleDouble(game: GameState, interaction: ButtonInteraction): Promise<void> {
  const hand: PlayerHand | undefined = game.hands[game.activeHandIndex];
  if (!hand || !canDoubleHand(hand)) {
    await interaction.reply({
      content: 'You can only double on the first two cards of a hand.',
      ephemeral: true,
    });
    return;
  }

  const staked: EconomyUser | null = await takeStake(game, game.originalBet, 'double');
  if (!staked) {
    await interaction.reply({
      content: `You need ${formatCurrency(game.originalBet)} to double.`,
      ephemeral: true,
    });
    return;
  }

  doubleHand(hand, game.shoe, game.originalBet);
  await advance(game, interaction);
}

async function handleSplit(game: GameState, interaction: ButtonInteraction): Promise<void> {
  const hand: PlayerHand | undefined = game.hands[game.activeHandIndex];
  if (!hand || !canSplitHand(hand, game.hands.length)) {
    await interaction.reply({
      content:
        game.hands.length >= MAX_HANDS
          ? `You can play at most ${MAX_HANDS} hands.`
          : 'That hand cannot be split.',
      ephemeral: true,
    });
    return;
  }

  const staked: EconomyUser | null = await takeStake(game, game.originalBet, 'split');
  if (!staked) {
    await interaction.reply({
      content: `You need ${formatCurrency(game.originalBet)} to split.`,
      ephemeral: true,
    });
    return;
  }

  const created: PlayerHand = splitHand(hand, game.shoe, game.originalBet);
  // Insert directly after its parent so hands read left to right in dealing order.
  game.hands.splice(game.activeHandIndex + 1, 0, created);

  await advance(game, interaction);
}

async function handleSurrender(game: GameState, interaction: ButtonInteraction): Promise<void> {
  const hand: PlayerHand | undefined = game.hands[game.activeHandIndex];
  if (!hand || !canSurrenderHand(hand, game.hands.length)) {
    await interaction.reply({
      content: 'You can only surrender before taking any other action.',
      ephemeral: true,
    });
    return;
  }

  hand.status = 'surrendered';
  await finishGame(game, interaction);
}

/**
 * Deal another hand at the same stake, on the same message.
 *
 * This is the path that used to break: it replayed through a spoofed interaction that
 * reused the original token. Here the click's own token drives the new hand, so the
 * chain never expires.
 */
async function handlePlayAgain(interaction: ButtonInteraction): Promise<void> {
  const userId: string = interaction.user.id;

  if (activeGames.has(userId)) {
    await interaction.reply({ content: 'You already have a hand in progress.', ephemeral: true });
    return;
  }

  const remaining: number = cooldownRemaining(userId);
  if (remaining > 0) {
    await interaction.reply({
      content: `Slow down — you can deal again in ${remaining}s.`,
      ephemeral: true,
    });
    return;
  }

  // The stake and table come from the button's own message, so a stale click cannot
  // resurrect a table the player has since left.
  const parsed = parseReplayContext(interaction);
  const user: EconomyUser | null = await economyDb.getUser(userId);

  if (!user || user.wallet < parsed.amount) {
    await interaction.reply({
      content: `You need ${formatCurrency(parsed.amount)} to play again.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();
  await dealHand(interaction, userId, interaction.user.username, parsed.amount, parsed.table);
}

/**
 * Recover the stake and table from the button's own customId.
 *
 * Carrying them in the id keeps Play Again working across a restart, where an
 * in-memory record of the last hand would be gone, without coupling the deal to how
 * the label happens to be worded.
 */
function parseReplayContext(interaction: ButtonInteraction): {
  amount: number;
  table: TableConfig;
} {
  // `bj:again:<amount>:<table>`
  const [, , rawAmount, rawTable] = interaction.customId.split(':');

  const parsed: number = Number(rawAmount);
  const amount: number = Number.isFinite(parsed) ? parsed : CONFIG.BLACKJACK_MIN;

  return {
    amount: Math.max(amount, CONFIG.BLACKJACK_MIN),
    table: TABLES[rawTable] ?? DEFAULT_TABLE,
  };
}
