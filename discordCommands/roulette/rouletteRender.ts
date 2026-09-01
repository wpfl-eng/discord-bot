// Roulette Rendering
//
// Builds every surface the table shows, as pure functions of a view model so the
// layout can be tested without a Discord client.
//
// THE INSIDE-BET PROBLEM
//
// An American felt carries 146 inside bets. Buttons are impossible, and a
// category-then-instance flow breaks the 25-option select cap on splits alone, of which
// there are 62.
//
// So the panel is anchored on a NUMBER. Pick a pocket and one select lists every bet
// that covers it - its straight up, its splits, its street, its corners, its six lines
// and the outside bets it belongs to. That is never more than about sixteen entries,
// and it matches how a player actually thinks: "I want 17 covered", not "I want the
// corner whose top-left is 13".
//
// BOARD LAYOUT
//
// The shared board carries display plus the one-click outside bets (Container + 5 action
// rows = 6 top-level, 27 components). The pockets and their combinations live on a
// per-player ephemeral panel. Being per-player is what makes that panel safe to
// re-render on every interaction - resetting a select on a shared message would yank it
// out from under everyone else.

import {
  ButtonStyle,
  StringSelectMenuBuilder,
  type APIMessageTopLevelComponent,
} from 'discord.js';
import type { RenderedMessage } from '../../interactions/renderedMessage.js';
import { CASINO_COLORS } from '../../casino/casinoTheme.js';
import { formatAmount, plural, relativeTime } from '../../casino/casinoFormat.js';
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
  LIMITS,
  WHEEL_POSITIONS,
  betDisplayRich,
  betsCovering,
  getBetDisplay,
  getColor,
  getColorEmoji,
  payoutLabel,
  pocketDisplay,
  pocketIcon,
  type CoveringBet,
  type RouletteColor,
} from './rouletteConfig.js';

// ============ CUSTOM ID SCHEME ============

/** Every roulette component id starts with this, claimed once in the router. */
export const ID_PREFIX = 'rl:';

export const IDS = {
  CHIP: 'rl:chip:',
  CHIP_CUSTOM: 'rl:chip:custom',
  CHIP_MODAL: 'rl:chipmodal',
  BET: 'rl:bet:',
  PANEL: 'rl:panel',
  SLIP: 'rl:slip',
  REBET: 'rl:rebet',
  UNDO: 'rl:undo',
  CLEAR: 'rl:clear',
  /** Pick which pocket the panel is focused on */
  SELECT_LOW: 'rl:sel:na',
  SELECT_HIGH: 'rl:sel:nb',
  /** Place one of the bets covering the focused pocket */
  SELECT_COVER: 'rl:sel:cover',
} as const;

// ============ VIEW MODEL ============

export type TablePhase = 'betting' | 'spinning' | 'result' | 'closed';

export interface RenderBet {
  readonly userId: string;
  readonly betType: string;
  readonly amount: number;
}

export interface RenderPayout {
  readonly userId: string;
  readonly betType: string;
  /** The stake, so the result frame can report what the spin took and returned */
  readonly amount: number;
  readonly profit: number;
  readonly won: boolean;
  readonly paid: boolean;
}

export interface TableView {
  readonly phase: TablePhase;
  /** Epoch milliseconds the betting window closes; null outside the betting phase */
  readonly closesAt: number | null;
  readonly bets: readonly RenderBet[];
  /** Most recent spins, newest first */
  readonly recentSpins: readonly string[];
  /** Pockets the ball is tumbling through, for the spin frames */
  readonly tumbling?: readonly string[];
  readonly result?: { readonly position: string; readonly color: RouletteColor };
  readonly payouts?: readonly RenderPayout[];
  readonly spinCount: number;
  readonly sessionWagered: number;
}

// ============ COLOURS ============

// Roulette's own mapping onto the shared casino palette.
const ACCENT = {
  betting: CASINO_COLORS.blue,
  spinning: CASINO_COLORS.gold,
  win: CASINO_COLORS.green,
  lose: CASINO_COLORS.red,
  closed: CASINO_COLORS.slate,
} as const;

// ============ TEXT SECTIONS ============

/** The strip of recent results, newest on the left. */
function recentStrip(recentSpins: readonly string[]): string {
  if (recentSpins.length === 0) return '_No spins yet_';
  return recentSpins.slice(0, LIMITS.HISTORY_LENGTH).map(pocketDisplay).join(' ');
}

/**
 * The live board.
 *
 * Grouped by PLAYER rather than by bet type. Grouping by type was fine for twelve
 * outside bets, but with 146 available a table of five could easily show thirty
 * distinct types and the old eight-row cap would hide most of it. Length now scales
 * with player count, which is bounded in a way bet variety is not.
 *
 * Mentions render as names but never notify - rendered() suppresses them. Without that,
 * a board repainted on every chip and every countdown tick would ping everyone on it,
 * every time.
 */
function betBoard(bets: readonly RenderBet[]): string {
  if (bets.length === 0) return '_No bets yet - first bet starts the clock_';

  const perUser = new Map<string, { total: number; count: number }>();
  for (const bet of bets) {
    const existing = perUser.get(bet.userId) ?? { total: 0, count: 0 };
    existing.total += bet.amount;
    existing.count += 1;
    perUser.set(bet.userId, existing);
  }

  const total: number = bets.reduce((sum, b) => sum + b.amount, 0);
  const lines: string[] = [`**ON THE TABLE**  ·  ${formatAmount(total)}`];

  for (const [userId, agg] of [...perUser.entries()].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`  <@${userId}>  **${formatAmount(agg.total)}**  ·  ${plural(agg.count, 'bet')}`);
  }

  // The drama the per-player rollup would otherwise hide: who has the big money, and on
  // what.
  const biggest = [...bets].sort((a, b) => b.amount - a.amount).slice(0, 3);
  if (biggest.length > 0) {
    lines.push('', '**BIGGEST ACTION**');
    for (const bet of biggest) {
      lines.push(
        `  ${formatAmount(bet.amount)}  <@${bet.userId}>  ${betDisplayRich(bet.betType)}  ` +
          `_(${payoutLabel(bet.betType)})_`
      );
    }
  }

  return lines.join('\n');
}

/** Winner lines for the result frame. */
function winnerBoard(payouts: readonly RenderPayout[]): string {
  const winners = payouts.filter((p) => p.won);
  if (winners.length === 0) return 'House takes it.';

  const perUser = new Map<string, { profit: number; bets: string[] }>();
  for (const win of winners) {
    const existing = perUser.get(win.userId) ?? { profit: 0, bets: [] };
    existing.profit += win.profit;
    existing.bets.push(getBetDisplay(win.betType));
    perUser.set(win.userId, existing);
  }

  const lines = [...perUser.entries()]
    .sort((a, b) => b[1].profit - a[1].profit)
    .slice(0, 10)
    .map(([userId, w]) => {
      // A player covering a number six ways wins on all six; listing every one would
      // swamp the frame.
      const shown: string = w.bets.slice(0, 3).join(', ');
      const more: string = w.bets.length > 3 ? ` +${w.bets.length - 3}` : '';
      return `🏆 <@${userId}> **+${formatAmount(w.profit)}** _(${shown}${more})_`;
    });

  // A won-but-uncredited bet means the payout failed and the stake will be refunded by
  // the startup sweep. Saying so beats letting the player think they were paid.
  if (winners.some((w) => !w.paid)) {
    lines.push('_Some payouts could not be credited and will be refunded._');
  }

  return lines.join('\n');
}

// ============ HEADER ============

function header(view: TableView): string {
  switch (view.phase) {
    case 'betting':
      return view.closesAt
        ? `## 🎰 ROULETTE\nBetting closes ${relativeTime(view.closesAt)}`
        : '## 🎰 ROULETTE\nPlace a bet to start the next spin';
    case 'spinning':
      return '## 🎰 ROULETTE\n🔒 **NO MORE BETS**';
    case 'result': {
      if (!view.result) return '## 🎰 ROULETTE';
      const { position, color } = view.result;
      return `## ${pocketIcon(position)} ${position} ${color.toUpperCase()}`;
    }
    case 'closed':
      return '## 🎰 ROULETTE — TABLE CLOSED';
  }
}

function body(view: TableView): string {
  switch (view.phase) {
    case 'betting':
      return betBoard(view.bets);
    case 'spinning':
      return view.tumbling && view.tumbling.length > 0
        ? `🎡 ${view.tumbling.map(pocketDisplay).join(' ')}`
        : '🎡 _rolling…_';
    case 'result':
      return view.payouts ? winnerBoard(view.payouts) : '';
    case 'closed':
      return view.spinCount > 0
        ? `${plural(view.spinCount, 'spin')} · ${formatAmount(view.sessionWagered)} wagered`
        : 'No spins this session.';
  }
}

function footer(view: TableView): string {
  if (view.phase === 'closed') {
    return '_Place a bet to open the table again._';
  }

  // On the result frame the table is empty by definition, so reporting "0 on the
  // table" says nothing. Report what the spin actually moved instead.
  if (view.phase === 'result' && view.payouts) {
    const wagered = view.payouts.reduce((sum, p) => sum + p.amount, 0);
    const paid = view.payouts
      .filter((p) => p.won && p.paid)
      .reduce((sum, p) => sum + p.amount + p.profit, 0);
    return `💸 Paid **${formatAmount(paid)}** of **${formatAmount(wagered)}** wagered`;
  }

  const onTable = view.bets.reduce((sum, b) => sum + b.amount, 0);
  return `💰 **${formatAmount(onTable)}** on the table`;
}

function accentFor(view: TableView): number {
  if (view.phase === 'spinning') return ACCENT.spinning;
  if (view.phase === 'closed') return ACCENT.closed;
  if (view.phase === 'result') {
    return view.payouts?.some((p) => p.won) ? ACCENT.win : ACCENT.lose;
  }
  return ACCENT.betting;
}

// ============ CONTROLS ============

/** Outside bets that get a one-click button, in board order. */
const TABLE_BET_ROW_1: readonly string[] = ['red', 'black', 'odd', 'even', 'low'];
const TABLE_BET_ROW_2: readonly string[] = ['high', 'first-dozen', 'second-dozen', 'third-dozen'];
const TABLE_BET_ROW_3: readonly string[] = ['first-column', 'second-column', 'third-column'];

function chipRow(disabled: boolean) {
  const buttons = CHIPS.map((amount) =>
    button({ id: `${IDS.CHIP}${amount}`, label: formatAmount(amount), disabled })
  );
  buttons.push(button({ id: IDS.CHIP_CUSTOM, label: 'Custom…', disabled }));
  return row(buttons);
}

function betRow(betTypes: readonly string[], disabled: boolean) {
  return row(
    betTypes.map((betType) =>
      button({
        id: `${IDS.BET}${betType}`,
        label: getBetDisplay(betType).replace(/^[^\w]+\s*/u, ''),
        style:
          betType === 'red' || betType === 'black' ? ButtonStyle.Primary : ButtonStyle.Secondary,
        emoji: betType === 'red' ? '🔴' : betType === 'black' ? '⚫' : undefined,
        disabled,
      })
    )
  );
}

function actionRow(disabled: boolean) {
  return row([
    button({ id: IDS.PANEL, label: 'Numbers…', style: ButtonStyle.Success, disabled }),
    button({ id: IDS.SLIP, label: 'My Slip' }),
    button({ id: IDS.REBET, label: 'Rebet', disabled }),
    button({ id: IDS.UNDO, label: 'Undo', disabled }),
    button({ id: IDS.CLEAR, label: 'Clear', style: ButtonStyle.Danger, disabled }),
  ]);
}

// ============ TABLE MESSAGE ============

export type { RenderedMessage };

/**
 * The shared table message.
 *
 * Controls are disabled outside the betting phase so a click during the spin cannot
 * land a bet the wheel has already passed.
 */
export function buildTableMessage(view: TableView): RenderedMessage {
  const locked: boolean = view.phase !== 'betting';

  const container = frame(accentFor(view))
    .addTextDisplayComponents(text(header(view)))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(`**Last spins**\n${recentStrip(view.recentSpins)}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(`${body(view)}\n\n${footer(view)}`));

  const payload = rendered([
    container.toJSON(),
    chipRow(locked).toJSON(),
    betRow(TABLE_BET_ROW_1, locked).toJSON(),
    betRow(TABLE_BET_ROW_2, locked).toJSON(),
    betRow(TABLE_BET_ROW_3, locked).toJSON(),
    actionRow(locked).toJSON(),
  ]);

  assertWithinBudget(payload, 'roulette board');
  return payload;
}

// ============ NUMBER-ANCHORED PANEL ============

/**
 * Split the 38 pockets across two selects, because one caps at 25 options.
 *
 * The split is by wheel order rather than numeric value so 0 and 00 sit at the front
 * where a player looks for them.
 */
const LOW_POCKETS: readonly string[] = WHEEL_POSITIONS.slice(0, 25);
const HIGH_POCKETS: readonly string[] = WHEEL_POSITIONS.slice(25);

function pocketOptions(positions: readonly string[], focus: string | null) {
  return positions.map((position) => ({
    label: `${position}  ${getColorEmoji(getColor(position))}`,
    value: position,
    default: position === focus,
  }));
}

function pocketSelect(
  id: string,
  positions: readonly string[],
  focus: string | null,
  disabled: boolean
) {
  return row([
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(`Pick a number  ${positions[0]}–${positions[positions.length - 1]}`)
      .setDisabled(disabled)
      .addOptions(pocketOptions(positions, focus)),
  ]);
}

/**
 * The bets covering the focused pocket.
 *
 * `betsCovering` returns them longest-shot first, so the 35:1 straight up is always the
 * first thing a player sees.
 */
function coverSelect(pocket: string, disabled: boolean) {
  const covering: CoveringBet[] = betsCovering(pocket).slice(0, 25);

  return row([
    new StringSelectMenuBuilder()
      .setCustomId(IDS.SELECT_COVER)
      .setPlaceholder(`Bets covering ${pocket}`)
      .setDisabled(disabled)
      .addOptions(
        covering.map((bet) => ({
          label: `${bet.display}`.slice(0, 100),
          value: bet.key,
          description: `Pays ${bet.payout}:1`,
        }))
      ),
  ]);
}

/**
 * The per-player panel carrying every bet that will not fit on the shared board.
 *
 * @param chip - the player's current stake
 * @param slipText - their own action, from buildSlipText
 * @param focus - the pocket they are looking at, or null before they have picked one
 * @param locked - true outside the betting phase
 */
export function buildBetPanel(
  chip: number,
  slipText: string,
  focus: string | null = null,
  locked: boolean = false
): RenderedMessage {
  const heading: string = focus
    ? `### ${pocketDisplay(focus)}  ${focus}\nEvery bet below covers **${focus}**.`
    : '### Numbers\nPick a number to see every bet that covers it.';

  const container = frame(ACCENT.betting).addTextDisplayComponents(
    text(
      `${heading}\n\nChip: **${formatAmount(chip)}** — change it on the table.\n\n${slipText}`
    )
  );

  const components: APIMessageTopLevelComponent[] = [container.toJSON()];

  if (focus) components.push(coverSelect(focus, locked).toJSON());
  components.push(pocketSelect(IDS.SELECT_LOW, LOW_POCKETS, focus, locked).toJSON());
  components.push(pocketSelect(IDS.SELECT_HIGH, HIGH_POCKETS, focus, locked).toJSON());

  const payload = rendered(components, { ephemeral: true });
  assertWithinBudget(payload, 'roulette panel');
  return payload;
}

// ============ SLIP ============

/**
 * A player's own bets for the round, as text for the panel or an ephemeral reply.
 */
export function buildSlipText(bets: readonly RenderBet[]): string {
  if (bets.length === 0) return '_Nothing on the table yet._';

  const byType = new Map<string, number>();
  for (const bet of bets) {
    byType.set(bet.betType, (byType.get(bet.betType) ?? 0) + bet.amount);
  }

  // A player covering one number six ways has six lines; cap it so the panel stays
  // readable and report the remainder as a total.
  const entries = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, 10);

  const lines = shown.map(
    ([betType, amount]) =>
      `• **${formatAmount(amount)}** on ${betDisplayRich(betType)} _(${BET_TYPES[betType]?.payout ?? '?'}:1)_`
  );

  if (entries.length > shown.length) {
    const rest = entries.slice(shown.length).reduce((sum, [, amount]) => sum + amount, 0);
    lines.push(`• _+${plural(entries.length - shown.length, 'more bet')} · ${formatAmount(rest)}_`);
  }

  const total = bets.reduce((sum, b) => sum + b.amount, 0);
  lines.push(`\n**Total: ${formatAmount(total)}**`);

  return lines.join('\n');
}
