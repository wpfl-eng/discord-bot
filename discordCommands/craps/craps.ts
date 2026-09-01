// Craps Command
//
// American craps at a shared table: pass line, don't pass, free odds, all six place
// numbers, hardways and the one-roll props.
//
// Betting happens through buttons and selects on the table board, routed centrally so
// each click carries its own interaction token. The slash command stays as a power-user
// path and is the only way to bet an arbitrary amount without opening the chip modal.

import {
  SlashCommandBuilder,
  ChannelType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';
import {
  registerComponentHandler,
  type RoutableInteraction,
} from '../../interactions/componentRouter.js';
import { registerGameStatus } from '../../casino/casinoHub.js';
import { ackBoard, ackPrivate, paintViaInteraction, whisper } from '../../casino/casinoPaint.js';
import { amountModal, choiceModal, parseStake } from '../../casino/casinoModal.js';
import { CASINO_COLORS } from '../../casino/casinoTheme.js';
import { formatAmount, formatCurrency, plural } from '../../casino/casinoFormat.js';
import { frame, rendered, text } from '../../casino/casinoRender.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  ALL_BET_TYPES,
  BET_TYPES,
  COMEOUT_BET_TYPES,
  DEFAULT_CHIP,
  LIMITS,
  ODDS_MAX_MULTIPLE,
  POINT_BET_TYPES,
  getBetDisplay,
  maxOdds,
  payoutLabel,
  puckDisplay,
  type BetType,
} from './crapsConfig.js';
import * as crapsState from './crapsState.js';
import { IDS, ID_PREFIX, ODDS_MULTIPLE_FIELD, buildSlipText } from './crapsRender.js';

// ============ TYPE GUARDS ============

function isBetType(value: string): value is BetType {
  return (ALL_BET_TYPES as readonly string[]).includes(value);
}

// ============ COMMAND DEFINITION ============

export const data = new SlashCommandBuilder()
  .setName('craps')
  .setDescription('Play craps at the table')
  .addSubcommand((sub) =>
    sub
      .setName('bet')
      .setDescription('Place a bet on the craps table')
      .addIntegerOption((opt) =>
        opt
          .setName('amount')
          .setDescription(`Coins to wager (${LIMITS.MIN_BET}-${LIMITS.MAX_BET})`)
          .setRequired(true)
          .setMinValue(LIMITS.MIN_BET)
          .setMaxValue(LIMITS.MAX_BET)
      )
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('What to bet on — only bets legal right now are offered')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('View the craps table status'));

// ============ PER-PLAYER CHIP ============

/**
 * The stake each player's next one-click bet will use. In memory only — a restart costs
 * nothing but a reset to the default.
 */
const activeChip = new Map<string, number>();

function chipFor(userId: string): number {
  return activeChip.get(userId) ?? DEFAULT_CHIP;
}

// ============ AUTOCOMPLETE ============

/**
 * Only ever offers bets that are legal in the current phase, matching the board.
 *
 * The description carries the payout and the house edge, which turns the slash path
 * into the game's only real documentation.
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused: string = interaction.options.getFocused().toLowerCase();
  const point: number | null = crapsState.getCurrentPoint();

  const available: readonly BetType[] = point === null ? COMEOUT_BET_TYPES : POINT_BET_TYPES;

  const filtered: BetType[] = available
    .filter(
      (t) => t.toLowerCase().includes(focused) || getBetDisplay(t).toLowerCase().includes(focused)
    )
    .slice(0, 25);

  await interaction.respond(
    filtered.map((t) => ({
      name: `${getBetDisplay(t)} — ${payoutLabel(t, point)}${
        BET_TYPES[t].houseEdge === 0 ? ' · no house edge' : ` · edge ${BET_TYPES[t].houseEdge}%`
      }`.slice(0, 100),
      value: t,
    }))
  );
}

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand: string = interaction.options.getSubcommand();

  try {
    if (subcommand === 'bet') await handleBetCommand(interaction);
    else if (subcommand === 'status') await handleStatus(interaction);
  } catch (error: unknown) {
    console.error('[CRAPS] Command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `An error occurred: ${message}`, ephemeral: true });
    } else {
      await interaction.editReply({ content: `An error occurred: ${message}` });
    }
  }
}

// ============ SHARED BET PATH ============

/**
 * The one path every bet takes, whatever placed it — slash command, board button or
 * select.
 */
async function placeBet(
  userId: string,
  username: string,
  betType: BetType,
  amount: number,
  channel: TextChannel,
  client: TextChannel['client']
): Promise<{ ok: boolean; message: string }> {
  const result = await crapsState.placeBet({
    userId,
    username,
    betType,
    amount,
    channel,
    client,
  });

  if (!result.success) return { ok: false, message: result.message };

  return { ok: true, message: result.message };
}

/**
 * The craps channel, or null with the reason already sent to the player.
 *
 * Every entry point needs this check, and every one of them needs to explain itself the
 * same way.
 */
async function requireTableChannel(
  interaction: RoutableInteraction | ChatInputCommandInteraction
): Promise<TextChannel | null> {
  const channelId: string | undefined = crapsState.getCrapsChannelId();

  if (!channelId) {
    await whisper(
      interaction as RoutableInteraction,
      'Craps is not configured. Set CRAPS_CHANNEL_ID in the environment.'
    );
    return null;
  }

  if (interaction.channelId !== channelId) {
    await whisper(interaction as RoutableInteraction, `Head to <#${channelId}> to play craps!`);
    return null;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await whisper(interaction as RoutableInteraction, 'Craps must be played in a text channel.');
    return null;
  }

  return interaction.channel;
}

// ============ SLASH HANDLERS ============

async function handleBetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const amount: number = interaction.options.getInteger('amount', true);
  const raw: string = interaction.options.getString('type', true).toLowerCase();

  if (!isBetType(raw)) {
    await interaction.reply({ content: `Unknown bet type: "${raw}".`, ephemeral: true });
    return;
  }

  const channelId: string | undefined = crapsState.getCrapsChannelId();
  if (!channelId) {
    await interaction.reply({
      content: 'Craps is not configured. Set CRAPS_CHANNEL_ID in the environment.',
      ephemeral: true,
    });
    return;
  }
  if (interaction.channelId !== channelId) {
    await interaction.reply({ content: `Head to <#${channelId}> to play craps!`, ephemeral: true });
    return;
  }
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Craps must be played in a text channel.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const outcome = await placeBet(
    interaction.user.id,
    interaction.user.username,
    raw,
    amount,
    interaction.channel,
    interaction.client
  );

  await interaction.editReply({
    content: outcome.ok ? `✅ ${outcome.message}` : `❌ ${outcome.message}`,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const info = crapsState.getTableInfo();
  const point: number | null = info.point;

  const lines: string[] = [`## 🎲 Craps  ·  ${puckDisplay(point)}`];

  lines.push(`**Status:** ${info.status}`);
  if (info.shooter) lines.push(`**Shooter:** <@${info.shooter.userId}>`);
  if (info.rollCount > 0) lines.push(`**Rolls this turn:** ${info.rollCount}`);
  lines.push(`**Active bets:** ${info.activeBetCount}`);
  lines.push(`**Total action:** ${formatAmount(info.totalWagered)}`);

  const available: readonly BetType[] = point === null ? COMEOUT_BET_TYPES : POINT_BET_TYPES;
  lines.push('', `**Legal right now** (${plural(available.length, 'bet')})`);
  for (const betType of available.slice(0, 12)) {
    const edge: string =
      BET_TYPES[betType].houseEdge === 0
        ? '**no house edge**'
        : `edge ${BET_TYPES[betType].houseEdge}%`;
    lines.push(`• ${getBetDisplay(betType)} — ${payoutLabel(betType, point)} · ${edge}`);
  }

  await interaction.reply({
    ...rendered(
      [
        frame(CASINO_COLORS.blue)
          .addTextDisplayComponents(text(lines.join('\n')))
          .toJSON(),
      ],
      {
        ephemeral: true,
      }
    ),
  });
}

// ============ COMPONENT HANDLERS ============

/**
 * Repaint the board after a click changed it.
 *
 * Through the click itself when it came from the live board, which keeps the edit on the
 * interaction's rate limit rather than the channel's. From anywhere else - a board left
 * behind by an earlier run - the painter repaints the real board instead.
 */
async function repaintBoard(interaction: RoutableInteraction): Promise<void> {
  const board = crapsState.currentBoard();
  if (!board) return;

  const painted: boolean = await paintViaInteraction(
    interaction,
    board,
    'CRAPS',
    crapsState.getBoardMessageId()
  );
  if (!painted) crapsState.refresh();
}

async function handleChip(interaction: RoutableInteraction, rest: string): Promise<void> {
  if (rest === 'custom') {
    if (!interaction.isButton()) return;
    await interaction.showModal(
      amountModal({
        id: IDS.CHIP_MODAL,
        title: 'Set your chip',
        label: `Chip size (${LIMITS.MIN_BET} – ${LIMITS.MAX_BET})`,
        description: 'Every one-click bet on the board will use this stake.',
        fieldId: 'amount',
        placeholder: '2500',
      })
    );
    return;
  }

  const amount: number = Number.parseInt(rest, 10);
  if (!Number.isInteger(amount)) return;

  activeChip.set(interaction.user.id, amount);
  await whisper(interaction, `Chip set to ${formatCurrency(amount)}.`);
}

async function handleChipModal(interaction: RoutableInteraction): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  await ackPrivate(interaction);

  const user = await economyDb.getOrCreateUser(interaction.user.id, interaction.user.username);
  const parsed: number | null = parseStake(
    interaction.fields.getTextInputValue('amount'),
    user.wallet
  );

  if (parsed === null || parsed < LIMITS.MIN_BET || parsed > LIMITS.MAX_BET) {
    await whisper(
      interaction,
      `Chips run from ${formatAmount(LIMITS.MIN_BET)} to ${formatAmount(LIMITS.MAX_BET)}.`
    );
    return;
  }

  activeChip.set(interaction.user.id, parsed);
  await whisper(interaction, `Chip set to ${formatCurrency(parsed)}.`);
}

/**
 * A one-click bet from the board.
 *
 * The clicker's own interaction repaints the shared board, which both acknowledges the
 * click inside Discord's three-second deadline and updates every viewer at once.
 */
async function handleBoardBet(interaction: RoutableInteraction, betType: string): Promise<void> {
  if (!isBetType(betType)) return;

  // The first bet of a session posts the board and edits it, and every bet takes coins
  // into escrow, all before there is a new board to show. Acknowledge ahead of it.
  await ackBoard(interaction);

  const channel = await requireTableChannel(interaction);
  if (!channel) return;

  const outcome = await placeBet(
    interaction.user.id,
    interaction.user.username,
    betType,
    chipFor(interaction.user.id),
    channel,
    interaction.client
  );

  if (!outcome.ok) {
    await whisper(interaction, outcome.message);
    return;
  }

  await repaintBoard(interaction);
}

/**
 * Odds are the one bet placed as a multiple rather than an amount, because what a
 * player wants is "back it as far as I'm allowed", and the ceiling moves with the point.
 */
async function handleOddsButton(interaction: RoutableInteraction): Promise<void> {
  if (!interaction.isButton()) return;

  const point: number | null = crapsState.getCurrentPoint();
  if (point === null) {
    await whisper(interaction, 'Odds need a point to be established.');
    return;
  }

  const userBets = crapsState.getUserBets(interaction.user.id);
  const line = userBets.find((b) => b.betType === 'pass_line' || b.betType === 'dont_pass');

  if (!line) {
    await whisper(
      interaction,
      "You need a Pass Line or Don't Pass bet before you can back it with odds."
    );
    return;
  }

  const ceiling: number = maxOdds(line.amount, point);
  const multiple: number = ODDS_MAX_MULTIPLE[point] ?? 1;
  const oddsType: BetType = line.betType === 'pass_line' ? 'pass_odds' : 'dont_pass_odds';

  const options = [];
  for (let m = 1; m <= multiple; m++) {
    const stake: number = line.amount * m;
    options.push({
      label: `${m}x — ${formatAmount(stake)}`,
      value: String(m),
      description: `Pays ${payoutLabel(oddsType, point)} on the ${point}`,
      default: m === multiple,
    });
  }

  await interaction.showModal(
    choiceModal({
      id: IDS.ODDS_MODAL,
      title: `Back the ${point}`,
      label: 'How far do you want to back it?',
      description: `Max ${multiple}x on a point of ${point} — up to ${formatAmount(ceiling)}. No house edge.`,
      fieldId: ODDS_MULTIPLE_FIELD,
      options,
    })
  );
}

async function handleOddsModal(interaction: RoutableInteraction): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  await ackPrivate(interaction);

  const channel = await requireTableChannel(interaction);
  if (!channel) return;

  const point: number | null = crapsState.getCurrentPoint();
  if (point === null) {
    await whisper(interaction, 'The point came off before that went through.');
    return;
  }

  const line = crapsState
    .getUserBets(interaction.user.id)
    .find((b) => b.betType === 'pass_line' || b.betType === 'dont_pass');

  if (!line) {
    await whisper(interaction, 'Your line bet is no longer on the table.');
    return;
  }

  const multiple: number = Number.parseInt(
    interaction.fields.getRadioGroup(ODDS_MULTIPLE_FIELD, true),
    10
  );
  if (!Number.isInteger(multiple) || multiple < 1) return;

  const oddsType: BetType = line.betType === 'pass_line' ? 'pass_odds' : 'dont_pass_odds';

  const outcome = await placeBet(
    interaction.user.id,
    interaction.user.username,
    oddsType,
    line.amount * multiple,
    channel,
    interaction.client
  );

  await whisper(interaction, outcome.ok ? `✅ ${outcome.message}` : `❌ ${outcome.message}`);
  crapsState.refresh();
}

async function handleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const betType: string | undefined = interaction.values[0];
  if (!betType) return;
  await handleBoardBet(interaction, betType);
}

async function handleSlip(interaction: RoutableInteraction): Promise<void> {
  const bets = crapsState.getUserBets(interaction.user.id);
  const point: number | null = crapsState.getCurrentPoint();

  const body: string =
    `### Your action\nChip: **${formatAmount(chipFor(interaction.user.id))}** — change it on the board.\n\n` +
    buildSlipText(
      bets.map((b) => ({
        userId: b.userId,
        betType: b.betType,
        amount: b.amount,
        oddsPoint: b.oddsPoint,
      })),
      point
    );

  const payload = rendered(
    [frame(CASINO_COLORS.blue).addTextDisplayComponents(text(body)).toJSON()],
    { ephemeral: true }
  );

  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    await interaction.reply(payload);
  }
}

async function handleUndo(interaction: RoutableInteraction): Promise<void> {
  // Returning a stake is a database transaction; the click cannot wait on it.
  await ackPrivate(interaction);

  const returned: number | null = await crapsState.undoLastBet(interaction.user.id);

  if (returned === null) {
    await whisper(interaction, 'Nothing of yours can come down right now.');
    return;
  }

  await whisper(interaction, `Took down ${formatCurrency(returned)}.`);
  crapsState.refresh();
}

async function handleTakeDown(interaction: RoutableInteraction): Promise<void> {
  await ackPrivate(interaction);

  const returned: number = await crapsState.takeDownAll(interaction.user.id);

  if (returned === 0) {
    await whisper(
      interaction,
      'Nothing came down. A Pass Line bet is a contract — it stays until the point resolves.'
    );
    return;
  }

  await whisper(interaction, `Took down ${formatCurrency(returned)}.`);
  crapsState.refresh();
}

async function handleRebet(interaction: RoutableInteraction): Promise<void> {
  // Replaying a slip is one escrow transaction per bet.
  await ackPrivate(interaction);

  const previous = crapsState.getLastRoundBets(interaction.user.id);
  if (previous.length === 0) {
    await whisper(interaction, 'You have nothing to repeat yet.');
    return;
  }

  const channel = await requireTableChannel(interaction);
  if (!channel) return;

  let placed = 0;
  let total = 0;
  for (const entry of previous) {
    const outcome = await placeBet(
      interaction.user.id,
      interaction.user.username,
      entry.betType,
      entry.amount,
      channel,
      interaction.client
    );
    if (outcome.ok) {
      placed += 1;
      total += entry.amount;
    }
  }

  if (placed === 0) {
    await whisper(interaction, 'None of those bets are legal right now.');
    return;
  }

  await whisper(interaction, `Repeated ${plural(placed, 'bet')} for ${formatCurrency(total)}.`);

  // This interaction is carrying a private reply, so the board is repainted through the
  // painter rather than through the click.
  crapsState.refresh();
}

/**
 * The shooter's throw.
 *
 * Only the player holding the dice may use this. Everyone else gets told whose turn it
 * is rather than a bare refusal.
 */
async function handleRoll(interaction: RoutableInteraction): Promise<void> {
  if (!crapsState.isAwaitingRoll()) {
    await whisper(interaction, 'The dice are not up for throwing right now.');
    return;
  }

  if (!crapsState.isShooter(interaction.user.id)) {
    const shooter = crapsState.getShooter();
    await whisper(
      interaction,
      shooter
        ? `Those are <@${shooter.userId}>'s dice. You're up after they seven out.`
        : 'Nobody has the dice right now.'
    );
    return;
  }

  // Acknowledge before rolling: the animation takes seconds and the click must be
  // answered inside Discord's three-second window.
  await ackBoard(interaction);

  await crapsState.executeRoll(false);
}

// ============ ROUTING ============

registerComponentHandler(ID_PREFIX, async (interaction: RoutableInteraction) => {
  const id: string = interaction.customId;

  if (id === IDS.CHIP_MODAL) return handleChipModal(interaction);
  if (id === IDS.ODDS_MODAL) return handleOddsModal(interaction);
  if (id === IDS.ODDS) return handleOddsButton(interaction);
  if (id === IDS.ROLL) return handleRoll(interaction);
  if (id === IDS.SLIP) return handleSlip(interaction);
  if (id === IDS.UNDO) return handleUndo(interaction);
  if (id === IDS.CLEAR) return handleTakeDown(interaction);
  if (id === IDS.REBET) return handleRebet(interaction);

  if (id === IDS.SELECT_PLACE || id === IDS.SELECT_PROPS) {
    if (interaction.isStringSelectMenu()) return handleSelect(interaction);
    return;
  }

  if (id.startsWith(IDS.CHIP)) return handleChip(interaction, id.slice(IDS.CHIP.length));
  if (id.startsWith(IDS.BET)) return handleBoardBet(interaction, id.slice(IDS.BET.length));

  console.warn(`[CRAPS] Unhandled component "${id}"`);
});

// ============ HUB ============

registerGameStatus(() => {
  const info = crapsState.getTableInfo();
  const open: boolean = crapsState.isTableOpen();

  const parts: string[] = [];
  if (info.point === null) parts.push('come-out');
  else parts.push(`point is ${info.point}`);
  if (info.shooter) parts.push(`${info.shooter.username} shooting`);
  if (info.rollCount > 0) parts.push(plural(info.rollCount, 'roll'));

  return {
    key: 'craps',
    label: 'CRAPS',
    emoji: '🎲',
    channelId: crapsState.getCrapsChannelId(),
    live: open,
    summary: open ? parts.join(' · ') : 'Table cold — place a bet to open it',
  };
});
