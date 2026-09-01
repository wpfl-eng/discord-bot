// Craps Rendering
//
// Pure view builders for the shared table board. Nothing here reads state or talks to
// Discord, so every layout can be measured in a test.
//
// PHASE-CONTEXTUAL LAYOUT
//
// Craps is the one game whose legal bets change under you: pass line and don't pass are
// come-out only, odds and place bets need a point. Rather than showing twenty buttons
// and greying most of them out, the board swaps its rows with the phase, so an illegal
// bet is unreachable rather than merely rejected.
//
// BUDGET (Container + 5 action rows = 6 top-level, ~22 components)
//
// The point phase is the fuller of the two and still fits comfortably inside Discord's
// 10 top-level / 40 total caps. Place numbers and the prop list ride in selects because
// six and nine options respectively will not fit in five-button rows.

import {
  ButtonStyle,
  StringSelectMenuBuilder,
  type APIMessageTopLevelComponent,
} from 'discord.js';
import type { RenderedMessage } from '../../interactions/renderedMessage.js';
import { CASINO_COLORS } from '../../casino/casinoTheme.js';
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
  BET_TYPES,
  CHIPS,
  PLACE_TARGET,
  betsInFamily,
  formatDiceRoll,
  getBetDisplay,
  getBetShort,
  getHotStreakMessage,
  payoutLabel,
  puckDisplay,
  type BetType,
  type Roll,
} from './crapsConfig.js';

// ============ CUSTOM ID SCHEME ============

/** Every craps component id starts with this, claimed once in the router. */
export const ID_PREFIX = 'cr:';

export const IDS = {
  CHIP: 'cr:chip:',
  CHIP_CUSTOM: 'cr:chip:custom',
  CHIP_MODAL: 'cr:chipmodal',
  BET: 'cr:bet:',
  ODDS: 'cr:odds',
  ODDS_MODAL: 'cr:oddsmodal',
  SELECT_PLACE: 'cr:sel:place',
  SELECT_PROPS: 'cr:sel:props',
  SLIP: 'cr:slip',
  REBET: 'cr:rebet',
  UNDO: 'cr:undo',
  CLEAR: 'cr:clear',
  ROLL: 'cr:roll',
} as const;

/** Field of the odds modal that carries the chosen multiple. */
export const ODDS_MULTIPLE_FIELD = 'multiple';

// ============ VIEW MODEL ============

export type BoardPhase = 'idle' | 'betting' | 'awaiting_roll' | 'rolling' | 'resolved';

export interface RenderBet {
  readonly userId: string;
  readonly betType: BetType;
  readonly amount: number;
  /** Odds bets only, so the slip can say what point they are riding */
  readonly oddsPoint?: number;
}

export interface RenderResult {
  readonly userId: string;
  readonly net: number;
}

export interface BoardView {
  readonly phase: BoardPhase;
  /** null during a come-out roll */
  readonly point: number | null;
  readonly shooter: { readonly userId: string; readonly username: string } | null;
  readonly bets: readonly RenderBet[];
  /** Totals of the last several rolls, newest last */
  readonly recentRolls: readonly number[];
  readonly lastRoll: Roll | null;
  /** Set on the resolved frame */
  readonly rollName?: string;
  readonly results?: readonly RenderResult[];
  /** Epoch ms the betting window closes, or the shooter's grace expires */
  readonly deadline: number | null;
  readonly rollCount: number;
  readonly sessionWagered: number;
  /** Dice tumbling through the animation frames */
  readonly tumbling?: readonly Roll[];
  /** True when the session just ended and the dice are passing on */
  readonly sevenOut?: boolean;
  readonly nextShooter?: string | null;
}

// ============ COLOURS ============

// Craps' own mapping onto the shared casino palette. Note push is purple here and blue
// at the blackjack table; the games were never reconciled on that and this preserves it.
const ACCENT = {
  idle: CASINO_COLORS.grey,
  comeout: CASINO_COLORS.blue,
  point: CASINO_COLORS.orange,
  rolling: CASINO_COLORS.gold,
  win: CASINO_COLORS.green,
  lose: CASINO_COLORS.red,
  hot: CASINO_COLORS.coral,
} as const;

function accentFor(view: BoardView): number {
  if (view.phase === 'idle') return ACCENT.idle;
  if (view.phase === 'rolling' || view.phase === 'awaiting_roll') return ACCENT.rolling;
  if (view.phase === 'resolved') {
    if (view.sevenOut) return ACCENT.lose;
    const net: number = (view.results ?? []).reduce((sum, r) => sum + r.net, 0);
    return net >= 0 ? ACCENT.win : ACCENT.lose;
  }
  if (getHotStreakMessage(view.rollCount)) return ACCENT.hot;
  return view.point === null ? ACCENT.comeout : ACCENT.point;
}

// ============ TEXT SECTIONS ============

function header(view: BoardView): string {
  const lines: string[] = [`## 🎲 CRAPS  ·  ${puckDisplay(view.point)}`];

  if (view.shooter) {
    lines.push(`<@${view.shooter.userId}> has the dice`);
  }

  switch (view.phase) {
    case 'idle':
      lines.push('_Table is cold. Place a bet to open it._');
      break;
    case 'betting':
      if (view.deadline) lines.push(`Bets close ${relativeTime(view.deadline)}`);
      break;
    case 'awaiting_roll':
      lines.push('🔒 **NO MORE BETS** — shooter, throw the dice');
      break;
    case 'rolling':
      lines.push('🎲 **The dice are out!**');
      break;
    case 'resolved':
      break;
  }

  const hot: string | null = getHotStreakMessage(view.rollCount);
  if (hot && view.phase !== 'idle') lines.push(`🔥 ${hot}`);

  return lines.join('\n');
}

/** The dice themselves, sized to the moment. */
function diceBlock(view: BoardView): string {
  if (view.phase === 'rolling') {
    const frames = view.tumbling ?? [];
    if (frames.length === 0) return '🎲 _tumbling…_';
    return frames.map((r) => formatDiceRoll(r.die1, r.die2)).join('   ');
  }

  if (!view.lastRoll) return '_No rolls yet._';

  const { die1, die2, total } = view.lastRoll;
  const name: string = view.rollName ?? String(total);
  return `${formatDiceRoll(die1, die2)}  **${total}**  ·  ${name}`;
}

/** Recent roll totals, oldest first, so a run is readable left to right. */
function rollStrip(recentRolls: readonly number[]): string {
  if (recentRolls.length === 0) return '';
  return `\`${recentRolls.slice(-12).join(' ')}\``;
}

/**
 * Who is on the table and for how much, then the biggest individual bets.
 *
 * Length scales with player count rather than with bet variety, which matters once a
 * player can hold a line bet, odds, six place numbers, four hardways and five props.
 */
function betBoard(bets: readonly RenderBet[]): string {
  if (bets.length === 0) return '_No bets down — first bet opens the table._';

  const perUser = new Map<string, { total: number; count: number }>();
  for (const bet of bets) {
    const existing = perUser.get(bet.userId) ?? { total: 0, count: 0 };
    existing.total += bet.amount;
    existing.count += 1;
    perUser.set(bet.userId, existing);
  }

  const lines: string[] = ['**ON THE TABLE**'];
  for (const [userId, agg] of [...perUser.entries()].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`  <@${userId}>  **${formatAmount(agg.total)}**  ·  ${plural(agg.count, 'bet')}`);
  }

  const biggest = [...bets].sort((a, b) => b.amount - a.amount).slice(0, 3);
  if (biggest.length > 0) {
    lines.push('', '**BIGGEST ACTION**');
    for (const bet of biggest) {
      const ratio: string = payoutLabel(bet.betType, bet.oddsPoint ?? null);
      lines.push(
        `  ${formatAmount(bet.amount)}  <@${bet.userId}>  ${getBetDisplay(bet.betType)}  _(${ratio})_`
      );
    }
  }

  return lines.join('\n');
}

/** Per-player net for the frame after a roll resolves. */
function resultBoard(view: BoardView): string {
  const results = view.results ?? [];
  if (results.length === 0) return '_Nobody had action on that one._';

  const lines: string[] = [...results]
    .sort((a, b) => b.net - a.net)
    .slice(0, 12)
    .map((r) => {
      const icon: string = r.net > 0 ? '🏆' : r.net < 0 ? '💸' : '➖';
      return `${icon} <@${r.userId}> **${formatSigned(r.net)}**`;
    });

  if (view.sevenOut) {
    lines.push(
      '',
      view.nextShooter
        ? `🎲 Dice pass to <@${view.nextShooter}> — you're up.`
        : '🎲 Dice are up for grabs. Place a bet to shoot.'
    );
  }

  return lines.join('\n');
}

function footer(view: BoardView): string {
  const onTable: number = view.bets.reduce((sum, b) => sum + b.amount, 0);
  const parts: string[] = [`💰 **${formatAmount(onTable)}** at risk`];

  if (view.rollCount > 0) parts.push(plural(view.rollCount, 'roll'));
  if (view.sessionWagered > 0) parts.push(`${formatAmount(view.sessionWagered)} wagered`);

  return parts.join('  ·  ');
}

// ============ CONTROLS ============

function chipRow(disabled: boolean) {
  const buttons = CHIPS.map((amount) =>
    button({ id: `${IDS.CHIP}${amount}`, label: formatAmount(amount), disabled })
  );
  buttons.push(button({ id: IDS.CHIP_CUSTOM, label: 'Custom…', disabled }));
  return row(buttons);
}

/** Come-out roll: the line is open and nothing else multi-roll is. */
function comeoutBetRow(disabled: boolean) {
  return row([
    button({ id: `${IDS.BET}pass_line`, label: 'Pass Line', style: ButtonStyle.Success, disabled }),
    button({ id: `${IDS.BET}dont_pass`, label: "Don't Pass", style: ButtonStyle.Danger, disabled }),
    button({ id: `${IDS.BET}field`, label: 'Field', style: ButtonStyle.Primary, disabled }),
  ]);
}

/**
 * Point phase: the line is closed, but odds and every number bet are live.
 *
 * Odds gets a button of its own rather than a slot in a select because it is the best
 * bet on the table and should not be buried.
 */
function pointBetRow(disabled: boolean, point: number) {
  return row([
    button({
      id: IDS.ODDS,
      label: `Back the ${point}`,
      style: ButtonStyle.Success,
      emoji: '🎯',
      disabled,
    }),
    button({ id: `${IDS.BET}field`, label: 'Field', style: ButtonStyle.Primary, disabled }),
  ]);
}

function placeSelect(disabled: boolean) {
  const options = betsInFamily('place').map((betType) => ({
    label: `Place ${PLACE_TARGET[betType]}`,
    value: betType,
    description: `Pays ${payoutLabel(betType)} · house edge ${BET_TYPES[betType].houseEdge}%`,
  }));

  return row([
    new StringSelectMenuBuilder()
      .setCustomId(IDS.SELECT_PLACE)
      .setPlaceholder('Place a number  ·  4 5 6 8 9 10')
      .setDisabled(disabled)
      .addOptions(options),
  ]);
}

/**
 * Hardways and one-roll props share a select: nine options together, which is inside the
 * 25-option cap and saves two action rows.
 */
function propSelect(disabled: boolean, includeHardways: boolean) {
  const families: BetType[] = includeHardways
    ? [...betsInFamily('hardway'), ...betsInFamily('prop')]
    : [...betsInFamily('prop')];

  const options = families.map((betType) => ({
    label: getBetDisplay(betType),
    value: betType,
    description: `Pays ${payoutLabel(betType)} · ${BET_TYPES[betType].description}`.slice(0, 100),
  }));

  return row([
    new StringSelectMenuBuilder()
      .setCustomId(IDS.SELECT_PROPS)
      .setPlaceholder(includeHardways ? 'Hardways & props' : 'One-roll props')
      .setDisabled(disabled)
      .addOptions(options),
  ]);
}

function actionRow(view: BoardView) {
  const locked: boolean = view.phase !== 'betting';

  const buttons = [
    button({ id: IDS.SLIP, label: 'My Slip', emoji: '🧾' }),
    button({ id: IDS.REBET, label: 'Rebet', disabled: locked }),
    button({ id: IDS.UNDO, label: 'Undo', disabled: locked }),
    button({ id: IDS.CLEAR, label: 'Take Down', style: ButtonStyle.Danger, disabled: locked }),
  ];

  return row(buttons);
}

/** The shooter's own button. Nobody else's click is accepted by the handler. */
function rollRow(view: BoardView) {
  const label: string = view.shooter ? `🎲 ROLL — ${view.shooter.username}` : '🎲 ROLL';
  return row([
    button({
      id: IDS.ROLL,
      label: label.slice(0, 80),
      style: ButtonStyle.Success,
      disabled: view.phase !== 'awaiting_roll',
    }),
  ]);
}

// ============ BOARD ============

function container(view: BoardView) {
  const builder = frame(accentFor(view)).addTextDisplayComponents(text(header(view)));

  builder.addSeparatorComponents(separator());

  const dice: string = diceBlock(view);
  const strip: string = rollStrip(view.recentRolls);
  builder.addTextDisplayComponents(text(strip ? `${dice}\n${strip}` : dice));

  builder.addSeparatorComponents(separator());

  const body: string = view.phase === 'resolved' ? resultBoard(view) : betBoard(view.bets);
  builder.addTextDisplayComponents(text(`${body}\n\n${footer(view)}`));

  return builder;
}

/**
 * The shared table board.
 *
 * @param view - everything the board shows
 */
export function buildBoard(view: BoardView): RenderedMessage {
  const components: APIMessageTopLevelComponent[] = [container(view).toJSON()];

  if (view.phase === 'awaiting_roll') {
    // Bets are closed and everyone is waiting on one person. Nothing else belongs here.
    components.push(rollRow(view).toJSON());
  } else if (view.phase === 'betting' || view.phase === 'idle') {
    const locked: boolean = view.phase !== 'betting';

    components.push(chipRow(locked).toJSON());

    if (view.point === null) {
      components.push(comeoutBetRow(locked).toJSON());
      components.push(propSelect(locked, false).toJSON());
    } else {
      components.push(pointBetRow(locked, view.point).toJSON());
      components.push(placeSelect(locked).toJSON());
      components.push(propSelect(locked, true).toJSON());
    }

    components.push(actionRow(view).toJSON());
  }
  // 'rolling' and 'resolved' show the board alone - no controls while dice are in the
  // air or results are on screen.

  const payload = rendered(components);
  assertWithinBudget(payload, 'craps board');
  return payload;
}

// ============ SLIP ============

/**
 * One player's own action, for an ephemeral reply.
 *
 * Odds are listed with the point they are riding, because the same stake pays
 * differently behind a 6 than behind a 4.
 */
export function buildSlipText(bets: readonly RenderBet[], point: number | null): string {
  if (bets.length === 0) return '_You have nothing on the table._';

  const byType = new Map<string, { amount: number; oddsPoint?: number }>();
  for (const bet of bets) {
    const key: string = bet.oddsPoint ? `${bet.betType}:${bet.oddsPoint}` : bet.betType;
    const existing = byType.get(key) ?? { amount: 0, oddsPoint: bet.oddsPoint };
    existing.amount += bet.amount;
    byType.set(key, existing);
  }

  const lines: string[] = [];
  for (const [key, agg] of byType) {
    const betType = key.split(':')[0] as BetType;
    const ratio: string = payoutLabel(betType, agg.oddsPoint ?? point);
    const behind: string = agg.oddsPoint ? ` behind the ${agg.oddsPoint}` : '';
    lines.push(
      `• **${formatAmount(agg.amount)}** on ${getBetShort(betType)}${behind} _(${ratio})_`
    );
  }

  const total: number = bets.reduce((sum, b) => sum + b.amount, 0);
  lines.push('', `**Total at risk: ${formatAmount(total)}**`);

  return lines.join('\n');
}
