// Roulette Rendering
//
// Builds every surface the table shows, as pure functions of a view model so the
// layout can be tested without a Discord client.
//
// LAYOUT CONSTRAINTS (measured, not assumed)
//
// A Container holds at most 10 direct children, a message at most 10 top-level
// components and 40 in total, and a StringSelect at most 25 options. The 38 pockets
// therefore need two selects, which will not fit alongside the outside-bet buttons in
// one container.
//
// So the shared table message carries display plus the high-frequency one-click bets
// (5 top-level, 4 action rows, 29 components), and the straight-up numbers and columns
// live on a per-player ephemeral panel. Being per-player is what makes that panel
// safe to re-render on every interaction - resetting a select on a shared message
// would yank it out from under everyone else.

import { ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import type { RenderedMessage } from '../../interactions/renderedMessage.js';
import { CASINO_COLORS } from '../../casino/casinoTheme.js';
import { formatAmount } from '../../casino/casinoFormat.js';
import { button, frame, rendered, row, separator, text } from '../../casino/casinoRender.js';
import {
  BET_TYPES,
  CHIPS,
  LIMITS,
  WHEEL_POSITIONS,
  betDisplayRich,
  getBetDisplay,
  getColor,
  getColorEmoji,
  pocketDisplay,
  pocketIcon,
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
  SELECT_COLUMN: 'rl:sel:col',
  SELECT_LOW: 'rl:sel:na',
  SELECT_HIGH: 'rl:sel:nb',
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
 * The live board: one line per bet type, listing who is on it.
 *
 * Mentions render as names but never notify - buildTableMessage sets allowedMentions
 * to suppress them. Without that, a board re-rendered on every chip and every
 * countdown tick would notify everyone on it, every time.
 */
function betBoard(bets: readonly RenderBet[]): string {
  if (bets.length === 0) return '_No bets yet - first bet starts the clock_';

  const byType = new Map<string, RenderBet[]>();
  for (const bet of bets) {
    const existing = byType.get(bet.betType) ?? [];
    existing.push(bet);
    byType.set(bet.betType, existing);
  }

  // Biggest money first, so the interesting action is at the top.
  const ordered = [...byType.entries()].sort(
    (a, b) => b[1].reduce((s, x) => s + x.amount, 0) - a[1].reduce((s, x) => s + x.amount, 0)
  );

  const lines: string[] = [];
  for (const [betType, typeBets] of ordered.slice(0, 8)) {
    // Collapse a player's repeated bets on one type into a single total.
    const perUser = new Map<string, number>();
    for (const bet of typeBets) {
      perUser.set(bet.userId, (perUser.get(bet.userId) ?? 0) + bet.amount);
    }
    const who = [...perUser.entries()]
      .map(([userId, amount]) => `<@${userId}> ${formatAmount(amount)}`)
      .join(' · ');
    lines.push(`${betDisplayRich(betType)}  ${who}`);
  }

  if (ordered.length > 8) lines.push(`_+${ordered.length - 8} more bet types_`);

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
    .map(
      ([userId, w]) => `🏆 <@${userId}> **+${formatAmount(w.profit)}** _(${w.bets.join(', ')})_`
    );

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
        ? `## 🎰 ROULETTE\nBetting closes <t:${Math.floor(view.closesAt / 1000)}:R>`
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
        ? `${view.spinCount} spin${view.spinCount === 1 ? '' : 's'} · ${formatAmount(view.sessionWagered)} wagered`
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

/** Bets that get a one-click button: every even-money and dozen bet. */
const TABLE_BET_ROW_1: readonly string[] = ['red', 'black', 'odd', 'even', 'low'];
const TABLE_BET_ROW_2: readonly string[] = ['high', 'first-dozen', 'second-dozen', 'third-dozen'];

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
    button({ id: IDS.SLIP, label: 'My Slip', disabled }),
    button({ id: IDS.REBET, label: 'Rebet', disabled }),
    button({ id: IDS.UNDO, label: 'Undo', disabled }),
    button({ id: IDS.CLEAR, label: 'Clear', style: ButtonStyle.Danger, disabled }),
  ]);
}

// ============ TABLE MESSAGE ============

// Shared with the other V2 renderer; re-exported so callers can keep importing it from
// the module that builds their views.
export type { RenderedMessage };

/**
 * The shared table message.
 *
 * Controls are disabled outside the betting phase so a click during the spin cannot
 * land a bet that the wheel has already passed.
 */
export function buildTableMessage(view: TableView): RenderedMessage {
  const locked: boolean = view.phase !== 'betting';

  const container = frame(accentFor(view))
    .addTextDisplayComponents(text(header(view)))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(`**Last spins**\n${recentStrip(view.recentSpins)}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(`${body(view)}\n\n${footer(view)}`));

  // rendered() suppresses mentions unconditionally. Without that the board would notify
  // every player listed on it, on every edit.
  return rendered([
    container.toJSON(),
    chipRow(locked).toJSON(),
    betRow(TABLE_BET_ROW_1, locked).toJSON(),
    betRow(TABLE_BET_ROW_2, locked).toJSON(),
    actionRow(locked).toJSON(),
  ]);
}

// ============ EPHEMERAL BET PANEL ============

function pocketOptions(positions: readonly string[]): { label: string; value: string }[] {
  return positions.map((position) => ({
    label: `${position}  ${getColorEmoji(getColor(position))}`,
    value: position,
  }));
}

/**
 * The per-player panel carrying the bets that will not fit on the shared table:
 * the three columns and all 38 straight-up pockets.
 *
 * Split across two selects because a StringSelect caps at 25 options.
 */
export function buildBetPanel(chip: number, slipText: string): RenderedMessage {
  const lowPockets: string[] = WHEEL_POSITIONS.slice(0, 25);
  const highPockets: string[] = WHEEL_POSITIONS.slice(25);

  const columnSelect = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT_COLUMN)
    .setPlaceholder('Column bet (2:1)')
    .addOptions([
      { label: '1st Column', value: 'first-column' },
      { label: '2nd Column', value: 'second-column' },
      { label: '3rd Column', value: 'third-column' },
    ]);

  const lowSelect = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT_LOW)
    .setPlaceholder(`Straight up  ${lowPockets[0]}–${lowPockets[lowPockets.length - 1]}  (35:1)`)
    .addOptions(pocketOptions(lowPockets));

  const highSelect = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT_HIGH)
    .setPlaceholder(`Straight up  ${highPockets[0]}–${highPockets[highPockets.length - 1]}  (35:1)`)
    .addOptions(pocketOptions(highPockets));

  const container = frame(ACCENT.betting).addTextDisplayComponents(
    text(`### Your bets\nChip: **${formatAmount(chip)}** — change it on the table.\n\n${slipText}`)
  );

  return rendered(
    [
      container.toJSON(),
      row([columnSelect]).toJSON(),
      row([lowSelect]).toJSON(),
      row([highSelect]).toJSON(),
    ],
    { ephemeral: true }
  );
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

  const lines = [...byType.entries()].map(
    ([betType, amount]) =>
      `• **${formatAmount(amount)}** on ${betDisplayRich(betType)} _(${BET_TYPES[betType]?.payout ?? '?'}:1)_`
  );

  const total = bets.reduce((sum, b) => sum + b.amount, 0);
  lines.push(`\n**Total: ${formatAmount(total)}**`);

  return lines.join('\n');
}
