// Blackjack Rendering
//
// Pure view builders for the shared multi-seat table. Nothing here reads state or talks
// to Discord, so every layout can be measured in a test.
//
// TWO ZONES
//
// Seats are unlimited, so the board cannot simply list every hand in full for the whole
// round. Instead it splits: seats still ACTING show their cards and totals, seats that
// are DONE collapse to one result line each, packed several to a line. The board
// therefore shrinks as the round resolves and attention stays on live action.
//
// A shared message renders identically for every viewer, so there is no way to pin a
// player's own seat to the top. That is what the ephemeral slip is for.
//
// CONTROLS ON THE BOARD
//
// Hit / Stand / Double / Split / Surrender sit on the shared board rather than on a
// private panel. Because every seat acts at once, a shared button is unambiguous: the
// handler applies it to whoever clicked, and `activeHandIndex` picks which of their
// split hands is live. This also sidesteps interaction-token lifetime entirely.

import { ButtonStyle, type APIMessageTopLevelComponent } from 'discord.js';
import type { RenderedMessage } from '../../interactions/renderedMessage.js';
import type { Hero } from '../../casino/casinoHero.js';
import { CASINO_COLORS, bar, resultAccent } from '../../casino/casinoTheme.js';
import { formatAmount, formatSigned, plural, relativeTime } from '../../casino/casinoFormat.js';
import {
  assertWithinBudget,
  button,
  frame,
  rendered,
  row,
  separator,
  text,
} from '../../casino/casinoRender.js';
import {
  calculateHandValue,
  getVisibleDealerValue,
  isSoft,
  renderHand,
  shoeRemaining,
  shoeSize,
  type Hand,
  type Shoe,
} from './blackjackUtils.js';
import type { HandOutcome, HandResult, PlayerHand } from './blackjackEngine.js';
import type { SideBetResult } from './blackjackSideBets.js';

// ============ CUSTOM IDS ============

export const ID_PREFIX = 'bj:';

export const IDS = {
  CHIP: 'bj:chip:',
  CHIP_CUSTOM: 'bj:chip:custom',
  SIT: 'bj:sit',
  SIT_MODAL: 'bj:sitmodal',
  LEAVE: 'bj:leave',
  SLIP: 'bj:slip',
  HIT: 'bj:hit',
  STAND: 'bj:stand',
  DOUBLE: 'bj:double',
  SPLIT: 'bj:split',
  SURRENDER: 'bj:surrender',
  INSURANCE_YES: 'bj:ins:yes',
  INSURANCE_NO: 'bj:ins:no',
} as const;

/** Modal field ids for the Sit dialog. */
export const SIT_STAKE_FIELD = 'stake';
export const SIT_SIDEBETS_FIELD = 'sidebets';

// ============ VIEW MODEL ============

export type TablePhase =
  | 'idle'
  | 'betting'
  | 'dealing'
  | 'insurance'
  | 'acting'
  | 'dealer'
  | 'settled';

export interface SeatView {
  readonly userId: string;
  readonly username: string;
  /** The riding stake for this seat */
  readonly stake: number;
  readonly hands: readonly PlayerHand[];
  readonly activeHandIndex: number;
  readonly insuranceBet: number;
  readonly sideBets: { readonly pairs: number; readonly p3: number };
  /** Present once the round settles */
  readonly results?: readonly HandResult[];
  readonly sideBetResults?: readonly SideBetResult[];
  readonly net?: number;
  /** True while the seat still has a hand to play */
  readonly acting: boolean;
}

export interface TableView {
  readonly phase: TablePhase;
  readonly shoe: Shoe | null;
  readonly dealerHand: Hand;
  readonly hideHole: boolean;
  readonly seats: readonly SeatView[];
  /** Epoch ms the current window closes */
  readonly deadline: number | null;
  readonly roundCount: number;
  /** Total staked this round across every seat */
  readonly roundStake: number;
  /**
   * A rendered settle image, present only on a big round. Null everywhere else, and the
   * text frame is complete without it.
   */
  readonly hero?: Hero | null;
}

export type { RenderedMessage };

// ============ COLOURS ============

const ACCENT = {
  idle: CASINO_COLORS.grey,
  betting: CASINO_COLORS.blue,
  live: CASINO_COLORS.gold,
  prompt: CASINO_COLORS.purple,
} as const;

function accentFor(view: TableView): number {
  if (view.phase === 'idle') return ACCENT.idle;
  if (view.phase === 'betting') return ACCENT.betting;
  if (view.phase === 'insurance') return ACCENT.prompt;
  if (view.phase === 'settled') {
    const net: number = view.seats.reduce((sum, s) => sum + (s.net ?? 0), 0);
    return resultAccent(net);
  }
  return ACCENT.live;
}

// ============ TEXT ============

/**
 * Hand value, marking soft totals so a soft 17 is not mistaken for a hard one.
 *
 * 21 is never labelled soft: the distinction only matters where another card could
 * still be drawn, and "soft 21" next to a BLACKJACK marker just reads as noise.
 */
function valueLabel(cards: Hand): string {
  const value: number = calculateHandValue(cards);
  if (value > 21) return `${value} BUST`;
  if (value === 21) return '21';
  return isSoft(cards) ? `soft ${value}` : `${value}`;
}

function header(view: TableView): string {
  const lines: string[] = ['## 🃏 BLACKJACK'];

  // One shoe for the whole table is what makes counting mean anything, so its depth is
  // permanent furniture rather than a detail.
  if (view.shoe) {
    const remaining: number = shoeRemaining(view.shoe);
    const total: number = shoeSize(view.shoe);
    const strip: string = bar(remaining / total);
    lines.push(
      view.shoe.justShuffled
        ? `🔄 Cut card reached — shoe reshuffled\n\`${strip}\` ${remaining} cards`
        : `\`${strip}\` ${remaining} cards`
    );
  }

  switch (view.phase) {
    case 'idle':
      lines.push('_Table is closed. Take a seat to open it._');
      break;
    case 'betting':
      lines.push(
        view.deadline
          ? `Seats close ${relativeTime(view.deadline)}`
          : 'Take a seat to start the next round'
      );
      break;
    case 'dealing':
      lines.push('🎴 **Dealing…**');
      break;
    case 'insurance':
      lines.push(
        view.deadline
          ? `🛡️ **Dealer shows an Ace** — insurance closes ${relativeTime(view.deadline)}`
          : '🛡️ **Insurance?**'
      );
      break;
    case 'acting':
      lines.push(view.deadline ? `⏱️ Hands close ${relativeTime(view.deadline)}` : 'Your move');
      break;
    case 'dealer':
      lines.push('🎩 **Dealer plays**');
      break;
    case 'settled':
      break;
  }

  return lines.join('\n');
}

function dealerBlock(view: TableView): string {
  if (view.dealerHand.length === 0) return '**DEALER**\n_waiting_';

  // An ace upcard is named rather than counted: "showing 11" is technically its value
  // but every player thinks of it as the dealer showing an Ace.
  const upcard = view.dealerHand[0];
  const showing: string =
    upcard?.rank === 'A' ? 'an Ace' : String(getVisibleDealerValue(view.dealerHand, true));

  const value: string = view.hideHole ? `showing ${showing}` : valueLabel(view.dealerHand);

  return `**DEALER**\n${renderHand(view.dealerHand, view.hideHole)}  ·  _${value}_`;
}

const OUTCOME_LABEL: Record<HandOutcome, string> = {
  blackjack: 'BLACKJACK',
  win: 'WON',
  push: 'PUSH',
  loss: 'LOST',
  surrender: 'SURRENDERED',
};

/** One line per hand for a seat that is still deciding. */
function actingSeatBlock(seat: SeatView): string {
  const lines: string[] = [];

  for (let i = 0; i < seat.hands.length; i++) {
    const hand = seat.hands[i];
    const isActive: boolean = i === seat.activeHandIndex && hand.status === 'playing';

    const extras: string[] = [];
    if (hand.doubled) extras.push('doubled');
    if (hand.fromSplitAces) extras.push('split aces');
    else if (hand.fromSplit) extras.push('split');

    const meta: string = extras.length > 0 ? `  _(${extras.join(', ')})_` : '';
    const which: string = seat.hands.length > 1 ? `  _hand ${i + 1} of ${seat.hands.length}_` : '';

    const status: string =
      hand.status === 'busted'
        ? '**BUST**'
        : hand.status === 'surrendered'
          ? '_surrendered_'
          : hand.status === 'stood'
            ? '_stood_'
            : isActive
              ? '▶ **deciding**'
              : '_waiting_';

    lines.push(
      `  <@${seat.userId}>  ${formatAmount(hand.bet)}${meta}${which}\n` +
        `  ${renderHand(hand.cards)}  ·  _${valueLabel(hand.cards)}_  ·  ${status}`
    );
  }

  if (seat.insuranceBet > 0) {
    lines.push(`  🛡️ insurance ${formatAmount(seat.insuranceBet)}`);
  }

  return lines.join('\n');
}

/** A settled seat, compressed to a single clause so several fit on one line. */
function doneSeatClause(seat: SeatView): string {
  if (!seat.results || seat.results.length === 0) {
    const hand = seat.hands[0];
    if (!hand) return `<@${seat.userId}> out`;
    return `<@${seat.userId}> ${valueLabel(hand.cards)} ${hand.status}`;
  }

  const outcomes: string = seat.results.map((r) => OUTCOME_LABEL[r.outcome]).join(' / ');
  const net: string = seat.net !== undefined ? ` ${formatSigned(seat.net)}` : '';
  return `<@${seat.userId}> ${outcomes}${net}`;
}

/**
 * The two-zone body.
 *
 * ACTING keeps full cards; DONE collapses. With unlimited seats this is what keeps the
 * board from growing without bound as a round progresses.
 */
function seatsBlock(view: TableView): string {
  if (view.seats.length === 0) {
    return '_No seats taken — take one to open the table._';
  }

  if (view.phase === 'betting') {
    const lines: string[] = ['**SEATED**'];
    for (const seat of view.seats) {
      const sides: string[] = [];
      if (seat.sideBets.pairs > 0) sides.push(`pairs ${formatAmount(seat.sideBets.pairs)}`);
      if (seat.sideBets.p3 > 0) sides.push(`21+3 ${formatAmount(seat.sideBets.p3)}`);
      const extra: string = sides.length > 0 ? `  _(${sides.join(', ')})_` : '';
      lines.push(`  <@${seat.userId}>  **${formatAmount(seat.stake)}**${extra}`);
    }
    return lines.join('\n');
  }

  const acting = view.seats.filter((s) => s.acting);
  const done = view.seats.filter((s) => !s.acting);

  const blocks: string[] = [];

  if (acting.length > 0) {
    blocks.push(['**ACTING**', ...acting.map(actingSeatBlock)].join('\n'));
  }

  if (done.length > 0) {
    // Several to a line: a settled seat needs a clause, not a paragraph.
    const clauses: string[] = done.map(doneSeatClause);
    const packed: string[] = [];
    for (let i = 0; i < clauses.length; i += 3) {
      packed.push(`  ${clauses.slice(i, i + 3).join('  ·  ')}`);
    }
    blocks.push(['**DONE**', ...packed].join('\n'));
  }

  return blocks.join('\n\n');
}

/** Side-bet hits, called out because 100:1 deserves more than a line in a slip. */
function sideBetBlock(view: TableView): string {
  const hits: string[] = [];

  for (const seat of view.seats) {
    for (const result of seat.sideBetResults ?? []) {
      if (result.tier === null || result.stake <= 0) continue;
      hits.push(`✨ <@${seat.userId}> **${result.label}** — ${formatSigned(result.net)}`);
    }
  }

  return hits.join('\n');
}

function footer(view: TableView): string {
  const parts: string[] = [];

  if (view.roundStake > 0) parts.push(`💰 **${formatAmount(view.roundStake)}** in action`);
  parts.push(plural(view.seats.length, 'seat'));
  if (view.roundCount > 0) parts.push(`round ${view.roundCount}`);

  return parts.join('  ·  ');
}

// ============ CONTROLS ============

/** Chip denominations, shared with the other two tables. */
const CHIPS: readonly number[] = [100, 1_000, 10_000, 50_000];

function chipRow(disabled: boolean) {
  const buttons = CHIPS.map((amount) =>
    button({ id: `${IDS.CHIP}${amount}`, label: formatAmount(amount), disabled })
  );
  buttons.push(button({ id: IDS.CHIP_CUSTOM, label: 'Custom…', disabled }));
  return row(buttons);
}

function seatRow(disabled: boolean) {
  return row([
    button({ id: IDS.SIT, label: 'Sit', style: ButtonStyle.Success, emoji: '🪑', disabled }),
    button({ id: IDS.SLIP, label: 'My Seat' }),
    button({ id: IDS.LEAVE, label: 'Stand Up', style: ButtonStyle.Danger }),
  ]);
}

/**
 * The shared action row.
 *
 * Every button is always present and always enabled during the acting phase: which of
 * them are legal depends on WHO clicked, and the board cannot know that. The handler
 * refuses an illegal action with an ephemeral note instead.
 */
function actionRow() {
  return row([
    button({ id: IDS.HIT, label: 'Hit', style: ButtonStyle.Primary }),
    button({ id: IDS.STAND, label: 'Stand', style: ButtonStyle.Secondary }),
    button({ id: IDS.DOUBLE, label: 'Double', style: ButtonStyle.Success }),
    button({ id: IDS.SPLIT, label: 'Split', style: ButtonStyle.Primary }),
    button({ id: IDS.SURRENDER, label: 'Surrender', style: ButtonStyle.Danger }),
  ]);
}

/**
 * Insurance.
 *
 * Taking insurance on a natural IS even money - the two settle identically - so one
 * button covers both cases rather than the table asking twice.
 */
function insuranceRow() {
  return row([
    button({ id: IDS.INSURANCE_YES, label: 'Take insurance', style: ButtonStyle.Primary }),
    button({ id: IDS.INSURANCE_NO, label: 'No insurance', style: ButtonStyle.Secondary }),
  ]);
}

// ============ BOARD ============

function container(view: TableView) {
  const builder = frame(accentFor(view))
    .addTextDisplayComponents(text(header(view)))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(dealerBlock(view)))
    .addSeparatorComponents(separator());

  if (view.hero) builder.addMediaGalleryComponents(view.hero.gallery);

  builder.addTextDisplayComponents(text(seatsBlock(view)));

  const sides: string = sideBetBlock(view);
  if (sides) builder.addTextDisplayComponents(text(sides));

  builder.addTextDisplayComponents(text(footer(view)));

  return builder;
}

/**
 * The shared table board.
 *
 * @param view - everything the board shows
 */
export function buildBoard(view: TableView): RenderedMessage {
  const components: APIMessageTopLevelComponent[] = [container(view).toJSON()];

  switch (view.phase) {
    case 'idle':
    case 'betting':
      components.push(chipRow(view.phase !== 'betting').toJSON());
      components.push(seatRow(view.phase !== 'betting').toJSON());
      break;
    case 'insurance':
      components.push(insuranceRow().toJSON());
      break;
    case 'acting':
      components.push(actionRow().toJSON());
      break;
    case 'dealing':
    case 'dealer':
    case 'settled':
      // Nothing to click while the cards are moving or the round is being read out.
      break;
  }

  const payload = rendered(components, view.hero ? { files: [view.hero.file] } : {});
  assertWithinBudget(payload, 'blackjack board');
  return payload;
}

// ============ SLIP ============

/**
 * One player's own seat, for an ephemeral reply.
 *
 * The board is identical for every viewer, so this is the only surface that can speak
 * to one player about their own position.
 */
export function buildSlipText(seat: SeatView | null, chip: number, balance: number): string {
  const lines: string[] = [`### Your seat`, `Chip: **${formatAmount(chip)}**`];

  if (!seat) {
    lines.push('', '_You are not seated. Press Sit to join the next round._');
    lines.push('', `Balance ${formatAmount(balance)}`);
    return lines.join('\n');
  }

  lines.push(`Riding stake: **${formatAmount(seat.stake)}**`);

  const sides: string[] = [];
  if (seat.sideBets.pairs > 0) sides.push(`Perfect Pairs ${formatAmount(seat.sideBets.pairs)}`);
  if (seat.sideBets.p3 > 0) sides.push(`21+3 ${formatAmount(seat.sideBets.p3)}`);
  if (sides.length > 0) lines.push(`Side bets: ${sides.join(' · ')}`);

  if (seat.hands.length > 0) {
    lines.push('');
    for (let i = 0; i < seat.hands.length; i++) {
      const hand = seat.hands[i];
      const marker: string = i === seat.activeHandIndex ? '▶ ' : '  ';
      lines.push(
        `${marker}${renderHand(hand.cards)}  ·  _${valueLabel(hand.cards)}_  ·  ${formatAmount(hand.bet)}`
      );
    }
  }

  if (seat.net !== undefined) {
    lines.push('', `**Net ${formatSigned(seat.net)}**`);
  }

  lines.push('', `Balance ${formatAmount(balance)}`);
  return lines.join('\n');
}
