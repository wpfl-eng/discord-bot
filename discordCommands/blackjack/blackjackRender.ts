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

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { APIMessageTopLevelComponent } from 'discord.js';
import type { RenderedMessage } from '../../interactions/renderedMessage.js';
import { formatCurrency } from '../../economy/economyConfig.js';
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

const ACCENT = {
  playing: 0xf1c40f,
  win: 0x2ecc71,
  loss: 0xe74c3c,
  push: 0x3498db,
  prompt: 0x9b59b6,
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

// Shared with the other V2 renderer; re-exported so callers can keep importing it from
// the module that builds their views.
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
    const filled: number = Math.max(0, Math.round((remaining / total) * 10));
    const bar: string = '█'.repeat(filled) + '░'.repeat(10 - filled);
    parts.push(
      view.shoe.justShuffled
        ? `🔄 Cut card reached — shoe reshuffled\n\`${bar}\` ${remaining} cards`
        : `\`${bar}\` ${remaining} cards`
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

function button(
  id: string,
  label: string,
  style: ButtonStyle,
  disabled: boolean = false
): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

function actionRow(view: GameView): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const buttons: ButtonBuilder[] = [
    button(IDS.HIT, 'Hit', ButtonStyle.Primary),
    button(IDS.STAND, 'Stand', ButtonStyle.Secondary),
  ];

  if (view.canDouble) buttons.push(button(IDS.DOUBLE, 'Double', ButtonStyle.Success));
  if (view.canSplit) buttons.push(button(IDS.SPLIT, 'Split', ButtonStyle.Primary));
  if (view.canSurrender) buttons.push(button(IDS.SURRENDER, 'Surrender', ButtonStyle.Danger));

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons);
}

/**
 * The stake and table ride in the customId rather than being read back out of the
 * label, so rewording the button cannot change what it deals.
 */
export function playAgainId(originalBet: number, table: string): string {
  return `${IDS.PLAY_AGAIN}:${originalBet}:${table}`;
}

function playAgainRow(
  originalBet: number,
  table: string
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents([
    button(
      playAgainId(originalBet, table),
      `Play again (${formatCurrency(originalBet)})`,
      ButtonStyle.Success
    ),
  ]);
}

// ============ GAME VIEW ============

function container(view: GameView): ContainerBuilder {
  const builder = new ContainerBuilder()
    .setAccentColor(accentFor(view))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(title(view)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealerBlock(view)))
    .addSeparatorComponents(new SeparatorBuilder());

  // Four hands is the maximum, so this stays within the container's 10-child budget:
  // title, separator, dealer, separator, up to 4 hands, footer = 9.
  const handText: string = view.hands
    .map((hand, i) => handBlock(view, hand, i, view.results?.[i]))
    .join('\n\n');

  builder.addTextDisplayComponents(new TextDisplayBuilder().setContent(handText));
  builder.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer(view)));

  return builder;
}

export function buildGameMessage(view: GameView): RenderedMessage {
  const components: APIMessageTopLevelComponent[] = [container(view).toJSON()];

  if (view.results) {
    if (view.canPlayAgain)
      components.push(playAgainRow(view.originalBet, view.table.name).toJSON());
  } else {
    components.push(actionRow(view).toJSON());
  }

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components,
    allowedMentions: { parse: [] },
  };
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
  buttons: ButtonBuilder[]
): RenderedMessage {
  const builder = new ContainerBuilder()
    .setAccentColor(ACCENT.prompt)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${title(view)}\n### ${heading}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealerBlock(view)))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(handBlock(view, view.hands[0], 0, undefined))
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(explain));

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [
      builder.toJSON(),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons).toJSON(),
    ],
    allowedMentions: { parse: [] },
  };
}

export function buildInsurancePrompt(view: GameView, insuranceCost: number): RenderedMessage {
  return promptMessage(
    view,
    'Insurance?',
    `Dealer shows an Ace. Insurance costs ${formatCurrency(insuranceCost)} and pays 2:1 if the dealer has blackjack.`,
    [
      button(
        IDS.INSURANCE_YES,
        `Take insurance (${formatCurrency(insuranceCost)})`,
        ButtonStyle.Primary
      ),
      button(IDS.INSURANCE_NO, 'No insurance', ButtonStyle.Secondary),
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
      button(IDS.EVEN_MONEY_YES, 'Even money (1:1)', ButtonStyle.Success),
      button(IDS.EVEN_MONEY_NO, 'Risk it (3:2)', ButtonStyle.Danger),
    ]
  );
}
