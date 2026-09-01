// Blackjack Rendering
//
// Pure view builders. Nothing here reads state or talks to Discord, so every layout
// can be measured in a test.
//
// LAYOUT NOTE
//
// The plan called for an action row beneath each hand. A Section accepts only a single
// button accessory, and four hands each needing Hit/Stand/Double would exceed both the
// Container's 10-child budget and the conservative 5-action-row cap.
//
// So the container frames the dealer and every hand, and one action row sits below it.
// That is still unambiguous - exactly one hand is ever live, and it is marked - and it
// is a clear improvement on the previous shared row plus an arrow buried in the
// description.
//
// Colours, formatting and the component builders come from casino/, so this table and
// the other two stay visually identical as all three grow.

import { ButtonStyle, type APIMessageTopLevelComponent } from 'discord.js';
import type { RenderedMessage } from '../../interactions/renderedMessage.js';
import { CASINO_COLORS, bar } from '../../casino/casinoTheme.js';
import { formatCurrency } from '../../casino/casinoFormat.js';
import { button, frame, rendered, row, separator, text } from '../../casino/casinoRender.js';
import {
  calculateHandValue,
  getVisibleDealerValue,
  isSoft,
  renderHand,
  shoeRemaining,
  shoeSize,
  type Hand,
  type Shoe,
  type TableConfig,
} from './blackjackUtils.js';
import type { HandOutcome, HandResult, PlayerHand } from './blackjackEngine.js';

// ============ CUSTOM IDS ============

export const ID_PREFIX = 'bj:';

export const IDS = {
  HIT: 'bj:hit',
  STAND: 'bj:stand',
  DOUBLE: 'bj:double',
  SPLIT: 'bj:split',
  SURRENDER: 'bj:surrender',
  INSURANCE_YES: 'bj:ins:yes',
  INSURANCE_NO: 'bj:ins:no',
  EVEN_MONEY_YES: 'bj:em:yes',
  EVEN_MONEY_NO: 'bj:em:no',
  PLAY_AGAIN: 'bj:again',
} as const;

// ============ COLOURS ============

// Blackjack's own mapping onto the shared palette. Note push is blue here and purple at
// the craps table - preserved as-is; unifying that is a design change, not a refactor.
const ACCENT = {
  playing: CASINO_COLORS.gold,
  win: CASINO_COLORS.green,
  loss: CASINO_COLORS.red,
  push: CASINO_COLORS.blue,
  prompt: CASINO_COLORS.purple,
} as const;

// ============ VIEW MODEL ============

export interface GameView {
  readonly table: TableConfig;
  readonly shoe: Shoe | null;
  readonly dealerHand: Hand;
  readonly hideHole: boolean;
  readonly hands: readonly PlayerHand[];
  readonly activeHandIndex: number;
  readonly insuranceBet: number;
  readonly balance: number;
  /** Present once the hand is settled */
  readonly results?: readonly HandResult[];
  readonly insurancePayout?: number;
  readonly netProfit?: number;
  readonly canDouble?: boolean;
  readonly canSplit?: boolean;
  readonly canSurrender?: boolean;
  readonly canPlayAgain?: boolean;
  readonly originalBet: number;
  readonly streakNote?: string;
}

export type { RenderedMessage };

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

function title(view: GameView): string {
  const parts: string[] = [`## 🃏 Blackjack — ${view.table.displayName}`];

  // The shoe indicator only means anything where the shoe persists.
  if (view.shoe) {
    const remaining: number = shoeRemaining(view.shoe);
    const total: number = shoeSize(view.shoe);
    const strip: string = bar(remaining / total);
    parts.push(
      view.shoe.justShuffled
        ? `🔄 Cut card reached — shoe reshuffled\n\`${strip}\` ${remaining} cards`
        : `\`${strip}\` ${remaining} cards`
    );
  }

  return parts.join('\n');
}

function dealerBlock(view: GameView): string {
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

function statusLabel(hand: PlayerHand, result: HandResult | undefined, isActive: boolean): string {
  if (result) return `**${OUTCOME_LABEL[result.outcome]}**`;
  if (hand.status === 'busted') return '**BUST**';
  if (hand.status === 'surrendered') return '_surrendered_';
  if (hand.status === 'stood') return '_stood_';
  return isActive ? '▶ **your turn**' : '_waiting_';
}

function handBlock(
  view: GameView,
  hand: PlayerHand,
  index: number,
  result: HandResult | undefined
): string {
  const isActive: boolean = index === view.activeHandIndex && !view.results;
  const label: string = view.hands.length > 1 ? `HAND ${index + 1}` : 'YOUR HAND';

  const extras: string[] = [];
  if (hand.doubled) extras.push('doubled');
  if (hand.fromSplitAces) extras.push('split aces');
  else if (hand.fromSplit) extras.push('split');

  const meta: string = extras.length > 0 ? `  _(${extras.join(', ')})_` : '';

  return (
    `**${label}**  ·  ${formatCurrency(hand.bet)}${meta}  ·  ${statusLabel(hand, result, isActive)}\n` +
    `${renderHand(hand.cards)}  ·  _${valueLabel(hand.cards)}_`
  );
}

function footer(view: GameView): string {
  const lines: string[] = [];

  if (view.insuranceBet > 0) {
    const settled: string =
      view.insurancePayout !== undefined
        ? view.insurancePayout > 0
          ? ` — paid ${formatCurrency(view.insurancePayout)}`
          : ' — lost'
        : '';
    lines.push(`🛡️ Insurance ${formatCurrency(view.insuranceBet)}${settled}`);
  }

  if (view.results && view.netProfit !== undefined) {
    const sign: string = view.netProfit > 0 ? '+' : view.netProfit < 0 ? '-' : '';
    lines.push(
      `**Net ${sign}${formatCurrency(Math.abs(view.netProfit))}**  ·  Balance ${formatCurrency(view.balance)}`
    );
    if (view.streakNote) lines.push(`_${view.streakNote}_`);
  } else {
    lines.push(`Balance ${formatCurrency(view.balance)}`);
  }

  return lines.join('\n');
}

function accentFor(view: GameView): number {
  if (!view.results || view.netProfit === undefined) return ACCENT.playing;
  if (view.netProfit > 0) return ACCENT.win;
  if (view.netProfit < 0) return ACCENT.loss;
  return ACCENT.push;
}

// ============ CONTROLS ============

function actionRow(view: GameView) {
  const buttons = [
    button({ id: IDS.HIT, label: 'Hit', style: ButtonStyle.Primary }),
    button({ id: IDS.STAND, label: 'Stand', style: ButtonStyle.Secondary }),
  ];

  if (view.canDouble)
    buttons.push(button({ id: IDS.DOUBLE, label: 'Double', style: ButtonStyle.Success }));
  if (view.canSplit)
    buttons.push(button({ id: IDS.SPLIT, label: 'Split', style: ButtonStyle.Primary }));
  if (view.canSurrender)
    buttons.push(button({ id: IDS.SURRENDER, label: 'Surrender', style: ButtonStyle.Danger }));

  return row(buttons);
}

/**
 * The stake and table ride in the customId rather than being read back out of the
 * label, so rewording the button cannot change what it deals.
 */
export function playAgainId(originalBet: number, table: string): string {
  return `${IDS.PLAY_AGAIN}:${originalBet}:${table}`;
}

function playAgainRow(originalBet: number, table: string) {
  return row([
    button({
      id: playAgainId(originalBet, table),
      label: `Play again (${formatCurrency(originalBet)})`,
      style: ButtonStyle.Success,
    }),
  ]);
}

// ============ GAME VIEW ============

function container(view: GameView) {
  const builder = frame(accentFor(view))
    .addTextDisplayComponents(text(title(view)))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(dealerBlock(view)))
    .addSeparatorComponents(separator());

  // Four hands is the maximum, so this stays within the container's 10-child budget:
  // title, separator, dealer, separator, up to 4 hands, footer = 9.
  const handText: string = view.hands
    .map((hand, i) => handBlock(view, hand, i, view.results?.[i]))
    .join('\n\n');

  builder.addTextDisplayComponents(text(handText));
  builder.addTextDisplayComponents(text(footer(view)));

  return builder;
}

export function buildGameMessage(view: GameView): RenderedMessage {
  const components: APIMessageTopLevelComponent[] = [container(view).toJSON()];

  if (view.results) {
    if (view.canPlayAgain) components.push(playAgainRow(view.originalBet, view.table.name).toJSON());
  } else {
    components.push(actionRow(view).toJSON());
  }

  return rendered(components, { ephemeral: true });
}

// ============ PROMPTS ============

/**
 * Insurance and even money are the two moments the hand pauses on a question, so they
 * get their own two-button view rather than being folded into the action row.
 */
function promptMessage(
  view: GameView,
  heading: string,
  explain: string,
  buttons: ReturnType<typeof button>[]
): RenderedMessage {
  const builder = frame(ACCENT.prompt)
    .addTextDisplayComponents(text(`${title(view)}\n### ${heading}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(dealerBlock(view)))
    .addTextDisplayComponents(text(handBlock(view, view.hands[0], 0, undefined)))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(explain));

  return rendered([builder.toJSON(), row(buttons).toJSON()], { ephemeral: true });
}

export function buildInsurancePrompt(view: GameView, insuranceCost: number): RenderedMessage {
  return promptMessage(
    view,
    'Insurance?',
    `Dealer shows an Ace. Insurance costs ${formatCurrency(insuranceCost)} and pays 2:1 if the dealer has blackjack.`,
    [
      button({
        id: IDS.INSURANCE_YES,
        label: `Take insurance (${formatCurrency(insuranceCost)})`,
        style: ButtonStyle.Primary,
      }),
      button({ id: IDS.INSURANCE_NO, label: 'No insurance', style: ButtonStyle.Secondary }),
    ]
  );
}

export function buildEvenMoneyPrompt(view: GameView): RenderedMessage {
  const bet: number = view.hands[0]?.bet ?? view.originalBet;
  return promptMessage(
    view,
    'Even money?',
    `You have blackjack and the dealer shows an Ace.\n` +
      `Take a guaranteed ${formatCurrency(bet)}, or risk it for ${formatCurrency(Math.floor(bet * 1.5))} — ` +
      `a push if the dealer also has blackjack.`,
    [
      button({ id: IDS.EVEN_MONEY_YES, label: 'Even money (1:1)', style: ButtonStyle.Success }),
      button({ id: IDS.EVEN_MONEY_NO, label: 'Risk it (3:2)', style: ButtonStyle.Danger }),
    ]
  );
}
