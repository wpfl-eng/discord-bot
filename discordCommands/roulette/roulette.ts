// Roulette Command
//
// American roulette played at a shared session table. The table opens on the first
// bet, spins on a short adaptive window, and closes after a spin nobody joins.
//
// Betting happens through buttons on the table message, routed centrally so each click
// carries its own interaction token. The slash command remains as a power-user path
// and is the only way to bet an arbitrary amount without opening the chip modal.

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ModalBuilder,
  TextChannel,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import * as escrowDb from '../../economy/escrowDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';
import {
  registerComponentHandler,
  type RoutableInteraction,
} from '../../interactions/componentRouter.js';
import { registerGameStatus } from '../../casino/casinoHub.js';
import { amountModal } from '../../casino/casinoModal.js';
import {
  ALL_BET_TYPES,
  BET_TYPES,
  DEFAULT_CHIP,
  LIMITS,
  betDisplayRich,
  formatAmount,
  getBetDisplay,
  pocketDisplay,
} from './rouletteConfig.js';
import * as rouletteState from './rouletteState.js';
import * as rouletteDb from './rouletteDb.js';
import { IDS, ID_PREFIX, buildBetPanel, buildSlipText } from './rouletteRender.js';

// ============ COMMAND DEFINITION ============

export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Play roulette in the casino')
  .addSubcommand((sub) =>
    sub
      .setName('bet')
      .setDescription('Place a bet on the roulette table')
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
          .setDescription('What to bet on (red, black, 17, first-dozen, etc.)')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) => sub.setName('stats').setDescription('Your lifetime roulette numbers'))
  .addSubcommand((sub) =>
    sub
      .setName('leaderboard')
      .setDescription('Roulette leaderboards')
      .addStringOption((opt) =>
        opt
          .setName('category')
          .setDescription('What to rank by (default: net)')
          .addChoices(
            { name: 'Net profit', value: 'net' },
            { name: 'Total wagered', value: 'wagered' },
            { name: 'Biggest single hit', value: 'biggest' },
            { name: 'Return rate', value: 'rtp' }
          )
      )
  );

// ============ PER-PLAYER CHIP ============

/**
 * The stake each player's next one-click bet will use. In memory only - a restart
 * costs nothing but a reset to the default.
 */
const activeChip = new Map<string, number>();

function chipFor(userId: string): number {
  return activeChip.get(userId) ?? DEFAULT_CHIP;
}

/**
 * The pocket each player's panel is currently focused on.
 *
 * The panel is a two-step flow - pick a number, then pick one of the bets covering it -
 * and that intermediate choice has to live somewhere between the two interactions.
 * In memory only; the worst a restart costs is a panel that reopens unfocused.
 */
const panelFocus = new Map<string, string>();

// ============ AUTOCOMPLETE ============

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused: string = interaction.options.getFocused().toLowerCase();

  const filtered: string[] = ALL_BET_TYPES.filter((t) => t.toLowerCase().startsWith(focused)).slice(
    0,
    25
  );

  await interaction.respond(filtered.map((t) => ({ name: getBetDisplay(t), value: t })));
}

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand: string = interaction.options.getSubcommand();

  try {
    if (subcommand === 'bet') await handleBetCommand(interaction);
    else if (subcommand === 'stats') await handleStats(interaction);
    else if (subcommand === 'leaderboard') await handleLeaderboard(interaction);
  } catch (error: unknown) {
    console.error('[ROULETTE] Command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `An error occurred: ${message}`, ephemeral: true });
    } else {
      await interaction.editReply({ content: `An error occurred: ${message}` });
    }
  }
}

// ============ SHARED BET PATH ============

interface PlaceBetOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * The single path every bet takes, whatever placed it - slash command, table button or
 * panel select.
 *
 * Order matters: the table is opened first so the wager has a session to belong to,
 * then the coins are taken atomically, then the bet joins the round. If the last step
 * fails the stake is handed straight back rather than waiting for the startup sweep.
 */
async function placeBet(
  userId: string,
  username: string,
  amount: number,
  betType: string,
  channel: TextChannel
): Promise<PlaceBetOutcome> {
  if (!BET_TYPES[betType]) {
    return { ok: false, message: `Unknown bet type: "${betType}".` };
  }

  if (!Number.isInteger(amount) || amount < LIMITS.MIN_BET || amount > LIMITS.MAX_BET) {
    return {
      ok: false,
      message: `Bets run from ${formatAmount(LIMITS.MIN_BET)} to ${formatAmount(LIMITS.MAX_BET)}.`,
    };
  }

  await rouletteState.ensureTable(channel);

  if (!rouletteState.isBettingOpen()) {
    return { ok: false, message: 'Betting is closed for this spin. Hang on for the next one.' };
  }

  const sessionKey: string | null = rouletteState.getActiveSessionKey();
  if (!sessionKey) {
    return { ok: false, message: 'The table just closed. Try again in a moment.' };
  }

  const escrow: escrowDb.OpenEscrowResult = await escrowDb.openEscrow({
    userId,
    username,
    game: 'roulette',
    sessionKey,
    amount,
    purpose: 'bet',
    detail: { betType },
  });

  if (!escrow.ok || escrow.escrowId === null) {
    return {
      ok: false,
      message: `You do not have ${formatCurrency(amount)} in your wallet.`,
    };
  }

  try {
    await rouletteState.addBet({
      userId,
      username,
      betType,
      amount,
      placedAt: new Date(),
      escrowId: escrow.escrowId,
    });
  } catch (err) {
    console.error('[ROULETTE] addBet failed after escrow opened; voiding:', err);
    await escrowDb.voidEscrow(escrow.escrowId, userId);
    return {
      ok: false,
      message: `The wheel spun before your bet landed. Your ${formatCurrency(amount)} was returned.`,
    };
  }

  return {
    ok: true,
    message: `${formatAmount(amount)} on ${betDisplayRich(betType)}`,
  };
}

// ============ SLASH: BET ============

async function handleBetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channelCheck: string | null = wrongChannelMessage(interaction.channelId);
  if (channelCheck) {
    await interaction.editReply({ content: channelCheck });
    return;
  }

  if (!interaction.channel) {
    await interaction.editReply({ content: 'This command must be used in a text channel.' });
    return;
  }

  const amount: number = interaction.options.getInteger('amount', true);
  const betType: string = interaction.options.getString('type', true).toLowerCase();

  await economyDb.getOrCreateUser(interaction.user.id, interaction.user.username);

  const outcome: PlaceBetOutcome = await placeBet(
    interaction.user.id,
    interaction.user.username,
    amount,
    betType,
    interaction.channel as TextChannel
  );

  await interaction.editReply({
    content: outcome.ok
      ? `${outcome.message}\n\n${buildSlipText(rouletteState.getUserBets(interaction.user.id))}`
      : outcome.message,
  });
}

/** null when the channel is fine, otherwise the message to show the player. */
function wrongChannelMessage(channelId: string): string | null {
  const rouletteChannelId: string | undefined = rouletteState.getRouletteChannelId();
  if (!rouletteChannelId) return 'Roulette is not configured. Contact an admin.';
  if (channelId !== rouletteChannelId) return `Head to <#${rouletteChannelId}> to play roulette!`;
  return null;
}

// ============ SLASH: STATS ============

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const stats = await rouletteDb.getUserStats(interaction.user.id);

  if (stats.betCount === 0) {
    await interaction.editReply({ content: 'You have not played roulette yet.' });
    return;
  }

  const sign: string = stats.net >= 0 ? '+' : '-';
  const lines: string[] = [
    '### 🎰 Your roulette',
    '',
    `**Spins played** ${stats.spins}  ·  **Bets** ${stats.betCount}  ·  **Wins** ${stats.wins}`,
    `**Wagered** ${formatAmount(stats.wagered)}  ·  **Returned** ${formatAmount(stats.returned)}`,
    `**Net** ${sign}${formatAmount(Math.abs(stats.net))}` +
      (stats.rtp !== null ? `  ·  **Return rate** ${(stats.rtp * 100).toFixed(1)}%` : ''),
  ];

  if (stats.biggestHit > 0 && stats.biggestHitBet) {
    lines.push(
      `**Biggest hit** ${formatAmount(stats.biggestHit)} on ${betDisplayRich(stats.biggestHitBet)}`
    );
  }
  if (stats.favouriteBet && stats.favouriteBetShare !== null) {
    lines.push(
      `**Favourite bet** ${betDisplayRich(stats.favouriteBet)} ` +
        `_(${(stats.favouriteBetShare * 100).toFixed(0)}% of your bets)_`
    );
  }
  if (stats.luckiestPocket) {
    lines.push(
      `**Luckiest pocket** ${pocketDisplay(stats.luckiestPocket)} ` +
        `_(${stats.luckiestPocketHits} win${stats.luckiestPocketHits === 1 ? '' : 's'})_`
    );
  }

  await interaction.editReply({ content: lines.join('\n') });
}

// ============ SLASH: LEADERBOARD ============

const CATEGORY_LABEL: Record<rouletteDb.RouletteLeaderboardCategory, string> = {
  net: 'Net profit',
  wagered: 'Total wagered',
  biggest: 'Biggest single hit',
  rtp: 'Return rate',
};

async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const category = (interaction.options.getString('category') ??
    'net') as rouletteDb.RouletteLeaderboardCategory;

  const rows = await rouletteDb.getLeaderboard(category, 10);

  if (rows.length === 0) {
    await interaction.editReply({
      content:
        category === 'rtp'
          ? `Nobody has the ${rouletteDb.RTP_MIN_BETS} bets needed to rank on return rate yet.`
          : 'No roulette results recorded yet.',
    });
    return;
  }

  const medals: string[] = ['🥇', '🥈', '🥉'];
  const lines: string[] = rows.map((row, i) => {
    const rank: string = medals[i] ?? `**${i + 1}.**`;
    const value: string =
      category === 'rtp'
        ? `${(row.value * 100).toFixed(1)}%`
        : category === 'net'
          ? `${row.value >= 0 ? '+' : '-'}${formatAmount(Math.abs(row.value))}`
          : formatAmount(row.value);
    return `${rank} <@${row.userId}> — **${value}**`;
  });

  await interaction.editReply({
    content:
      `### 🎰 Roulette — ${CATEGORY_LABEL[category]}\n\n${lines.join('\n')}` +
      (category === 'rtp' ? `\n\n_Minimum ${rouletteDb.RTP_MIN_BETS} bets to rank._` : ''),
    allowedMentions: { parse: [] },
  });
}

// ============ COMPONENT HANDLERS ============

/**
 * Everything on the table message and the bet panel arrives here.
 *
 * Replies are always ephemeral: the shared message is repainted by the state module,
 * so a player's own feedback never adds a message to the channel.
 */
async function handleComponent(interaction: MessageComponentInteraction): Promise<void> {
  const { customId } = interaction;
  const userId: string = interaction.user.id;

  if (customId === IDS.CHIP_CUSTOM) {
    await interaction.showModal(buildChipModal());
    return;
  }

  if (customId.startsWith(IDS.CHIP)) {
    const amount: number = Number(customId.slice(IDS.CHIP.length));
    await setChip(interaction, amount);
    return;
  }

  if (customId.startsWith(IDS.BET)) {
    await betFromComponent(interaction, customId.slice(IDS.BET.length), chipFor(userId));
    return;
  }

  // Picking a number does NOT place a bet - it focuses the panel on that pocket so the
  // cover select can be rebuilt for it.
  if (customId === IDS.SELECT_LOW || customId === IDS.SELECT_HIGH) {
    const select = interaction as StringSelectMenuInteraction;
    const pocket: string | undefined = select.values[0];
    if (pocket) await focusPocket(select, pocket);
    return;
  }

  // Choosing from the cover select is what actually lands a bet.
  if (customId === IDS.SELECT_COVER) {
    const select = interaction as StringSelectMenuInteraction;
    const betType: string | undefined = select.values[0];
    if (betType) await betFromPanel(select, betType);
    return;
  }

  switch (customId) {
    case IDS.PANEL:
      await openPanel(interaction);
      return;
    case IDS.SLIP:
      await showSlip(interaction);
      return;
    case IDS.REBET:
      await rebet(interaction);
      return;
    case IDS.UNDO:
      await undo(interaction);
      return;
    case IDS.CLEAR:
      await clearBets(interaction);
      return;
    default:
      await interaction.reply({ content: 'That control is no longer active.', ephemeral: true });
  }
}

/**
 * The chip modal.
 *
 * Built on `Label` rather than an ActionRow-wrapped TextInput, which is the deprecated
 * form this file used previously.
 */
function buildChipModal(): ModalBuilder {
  return amountModal({
    id: IDS.CHIP_MODAL,
    title: 'Set your chip',
    label: `Chip size (${LIMITS.MIN_BET} – ${LIMITS.MAX_BET})`,
    description: 'Every one-click bet on the table will use this stake.',
    fieldId: 'amount',
    placeholder: '2500',
  });
}

async function setChip(interaction: RoutableInteraction, amount: number): Promise<void> {
  if (!Number.isInteger(amount) || amount < LIMITS.MIN_BET || amount > LIMITS.MAX_BET) {
    await interaction.reply({
      content: `Chips run from ${formatAmount(LIMITS.MIN_BET)} to ${formatAmount(LIMITS.MAX_BET)}.`,
      ephemeral: true,
    });
    return;
  }

  activeChip.set(interaction.user.id, amount);
  await interaction.reply({
    content: `Chip set to **${formatAmount(amount)}**. Every one-click bet now uses it.`,
    ephemeral: true,
  });
}

/**
 * Place a bet from a button or select.
 *
 * The click is acknowledged with deferUpdate so the shared table message is not
 * touched here - the state module repaints it once, after the bet lands.
 */
async function betFromComponent(
  interaction: MessageComponentInteraction,
  betType: string,
  amount: number
): Promise<void> {
  const channelCheck: string | null = wrongChannelMessage(interaction.channelId);
  if (channelCheck) {
    await interaction.reply({ content: channelCheck, ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  await economyDb.getOrCreateUser(interaction.user.id, interaction.user.username);

  const outcome: PlaceBetOutcome = await placeBet(
    interaction.user.id,
    interaction.user.username,
    amount,
    betType,
    interaction.channel as TextChannel
  );

  await interaction.followUp({
    content: outcome.ok
      ? `✅ ${outcome.message}\n\n${buildSlipText(rouletteState.getUserBets(interaction.user.id))}`
      : `⚠️ ${outcome.message}`,
    ephemeral: true,
  });
}

async function openPanel(interaction: MessageComponentInteraction): Promise<void> {
  const userId: string = interaction.user.id;
  await interaction.reply(panelFor(userId));
}

/** The panel as this player currently has it. */
function panelFor(userId: string) {
  return buildBetPanel(
    chipFor(userId),
    buildSlipText(rouletteState.getUserBets(userId)),
    panelFocus.get(userId) ?? null,
    !rouletteState.isBettingOpen()
  );
}

/**
 * Focus the panel on a pocket.
 *
 * The panel is ephemeral and per-player, so updating it in place is safe - doing the
 * same to a select on the shared board would yank it out from under everyone else.
 */
async function focusPocket(
  interaction: StringSelectMenuInteraction,
  pocket: string
): Promise<void> {
  panelFocus.set(interaction.user.id, pocket);
  await interaction.update(panelFor(interaction.user.id));
}

/**
 * Place one of the bets covering the focused pocket, then rebuild the panel so the slip
 * reflects it immediately.
 */
async function betFromPanel(
  interaction: StringSelectMenuInteraction,
  betType: string
): Promise<void> {
  const userId: string = interaction.user.id;

  const channelCheck: string | null = wrongChannelMessage(interaction.channelId);
  if (channelCheck) {
    await interaction.reply({ content: channelCheck, ephemeral: true });
    return;
  }

  await economyDb.getOrCreateUser(userId, interaction.user.username);

  const outcome: PlaceBetOutcome = await placeBet(
    userId,
    interaction.user.username,
    chipFor(userId),
    betType,
    interaction.channel as TextChannel
  );

  await interaction.update(panelFor(userId));

  if (!outcome.ok) {
    await interaction.followUp({ content: `⚠️ ${outcome.message}`, ephemeral: true });
  }
}

async function showSlip(interaction: MessageComponentInteraction): Promise<void> {
  const userId: string = interaction.user.id;
  await interaction.reply({
    content:
      `**Chip:** ${formatAmount(chipFor(userId))}\n\n` +
      buildSlipText(rouletteState.getUserBets(userId)),
    ephemeral: true,
  });
}

/**
 * Replay the bets this player had down on the previous spin.
 */
async function rebet(interaction: MessageComponentInteraction): Promise<void> {
  const userId: string = interaction.user.id;
  const previous = rouletteState.getLastRoundBets(userId);

  if (previous.length === 0) {
    await interaction.reply({
      content: 'You had nothing down on the last spin.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const placed: string[] = [];
  const failed: string[] = [];

  for (const bet of previous) {
    const outcome: PlaceBetOutcome = await placeBet(
      userId,
      interaction.user.username,
      bet.amount,
      bet.betType,
      interaction.channel as TextChannel
    );
    if (outcome.ok) placed.push(outcome.message);
    else failed.push(outcome.message);
  }

  await interaction.followUp({
    content:
      (placed.length > 0 ? `✅ Rebet ${placed.length} wager(s)\n` : '') +
      (failed.length > 0 ? `⚠️ ${failed[0]}\n` : '') +
      `\n${buildSlipText(rouletteState.getUserBets(userId))}`,
    ephemeral: true,
  });
}

/**
 * Take back the most recent bet and return the stake.
 *
 * voidEscrow only claims rows that are still open, so racing the spin refunds at most
 * once - and the bet is removed from the round before the refund is attempted, so a
 * failed refund cannot leave a bet on the table that has been paid back.
 */
async function undo(interaction: MessageComponentInteraction): Promise<void> {
  const userId: string = interaction.user.id;

  if (!rouletteState.isBettingOpen()) {
    await interaction.reply({ content: 'Betting is closed for this spin.', ephemeral: true });
    return;
  }

  const removed = rouletteState.popLastBet(userId);
  if (!removed) {
    await interaction.reply({ content: 'You have no bets to undo.', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const refunded = await escrowDb.voidEscrow(removed.escrowId, userId);
  await rouletteState.refresh();

  await interaction.followUp({
    content: refunded
      ? `↩️ Took back ${formatAmount(removed.amount)} from ${betDisplayRich(removed.betType)}.\n\n` +
        buildSlipText(rouletteState.getUserBets(userId))
      : 'That bet had already been resolved.',
    ephemeral: true,
  });
}

/** Take back every bet this player has on the table. */
async function clearBets(interaction: MessageComponentInteraction): Promise<void> {
  const userId: string = interaction.user.id;

  if (!rouletteState.isBettingOpen()) {
    await interaction.reply({ content: 'Betting is closed for this spin.', ephemeral: true });
    return;
  }

  const removed = rouletteState.popAllBets(userId);
  if (removed.length === 0) {
    await interaction.reply({ content: 'You have no bets on the table.', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  // One transaction for the whole slip rather than one per chip.
  const refund = await escrowDb.voidEscrowIds(
    removed.map((bet) => bet.escrowId),
    userId
  );

  await rouletteState.refresh();

  await interaction.followUp({
    content: `🧹 Cleared ${removed.length} bet(s), ${formatAmount(refund.totalRefunded)} returned.`,
    ephemeral: true,
  });
}

// ============ MODAL ============

async function handleChipModal(interaction: ModalSubmitInteraction): Promise<void> {
  const raw: string = interaction.fields.getTextInputValue('amount').replace(/[,\s]/g, '');
  // setChip owns the limit check and both replies, so the typed and clicked paths
  // cannot drift apart.
  await setChip(interaction, Number.parseInt(raw, 10));
}

// ============ REGISTRATION ============

registerComponentHandler(ID_PREFIX, async (interaction) => {
  if (interaction.isModalSubmit()) {
    await handleChipModal(interaction);
    return;
  }
  await handleComponent(interaction as MessageComponentInteraction);
});

// ============ HUB ============

registerGameStatus(() => {
  const open: boolean = rouletteState.isTableOpen();
  const betting: boolean = rouletteState.isBettingOpen();

  return {
    key: 'roulette',
    label: 'ROULETTE',
    emoji: '🎰',
    channelId: rouletteState.getRouletteChannelId(),
    live: open,
    summary: !open
      ? 'Table closed — place a bet to open it'
      : betting
        ? 'Betting open'
        : 'Wheel is spinning',
  };
});
