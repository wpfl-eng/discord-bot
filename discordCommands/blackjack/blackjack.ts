// Blackjack Command
//
// One shared multi-seat table against one dealer on one six-deck shoe.
//
// The old game was solo and entirely ephemeral: nobody could see anyone else play, and
// the shoe reset every hand. Seats now play simultaneously on a shared clock, with the
// action controls on the public board - which works precisely because every seat is
// live at once, so a shared button is unambiguous per clicker.
//
// The slash command stays as a power-user path for taking a seat with an exact stake.

import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  registerComponentHandler,
  type RoutableInteraction,
} from '../../interactions/componentRouter.js';
import { registerGameStatus } from '../../casino/casinoHub.js';
import { ackBoard, ackPrivate, paintViaInteraction, whisper } from '../../casino/casinoPaint.js';
import { amountWithTogglesModal, parseStake } from '../../casino/casinoModal.js';
import { CASINO_COLORS } from '../../casino/casinoTheme.js';
import { formatCurrency } from '../../casino/casinoFormat.js';
import { frame, rendered, text } from '../../casino/casinoRender.js';
import {
  IDS,
  ID_PREFIX,
  SIT_SIDEBETS_FIELD,
  SIT_STAKE_FIELD,
  buildSlipText,
} from './blackjackRender.js';
import * as blackjackState from './blackjackState.js';
import { PERFECT_PAIRS_PAYOUT, TWENTY_ONE_PLUS_THREE_PAYOUT } from './blackjackSideBets.js';

// ============ COMMAND DEFINITION ============

export const data = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Take a seat at the blackjack table')
  .addSubcommand((sub) =>
    sub
      .setName('sit')
      .setDescription('Take a seat for the next round')
      .addStringOption((option) =>
        option
          .setName('amount')
          .setDescription("Stake per round (number or 'all')")
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option.setName('pairs').setDescription('Optional Perfect Pairs side bet').setMinValue(0)
      )
      .addIntegerOption((option) =>
        option.setName('plus3').setDescription('Optional 21+3 side bet').setMinValue(0)
      )
  )
  .addSubcommand((sub) => sub.setName('leave').setDescription('Stand up from the table'))
  .addSubcommand((sub) => sub.setName('rules').setDescription('House rules and paytables'));

// ============ PER-PLAYER CHIP ============

/** The stake a player's next Sit will default to. In memory only. */
const activeChip = new Map<string, number>();

function chipFor(userId: string): number {
  return activeChip.get(userId) ?? 1_000;
}

// ============ CHANNEL ============

async function requireTableChannel(
  interaction: RoutableInteraction | ChatInputCommandInteraction
): Promise<TextChannel | null> {
  const channelId: string | undefined = blackjackState.getBlackjackChannelId();

  if (!channelId) {
    await whisper(
      interaction as RoutableInteraction,
      'Blackjack is not configured. Set BLACKJACK_CHANNEL_ID in the environment.'
    );
    return null;
  }

  if (interaction.channelId !== channelId) {
    await whisper(interaction as RoutableInteraction, `Head to <#${channelId}> to play blackjack!`);
    return null;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await whisper(
      interaction as RoutableInteraction,
      'Blackjack must be played in a text channel.'
    );
    return null;
  }

  return interaction.channel;
}

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand: string = interaction.options.getSubcommand();

  try {
    if (subcommand === 'sit') await handleSitCommand(interaction);
    else if (subcommand === 'leave') await handleLeaveCommand(interaction);
    else if (subcommand === 'rules') await handleRules(interaction);
  } catch (error: unknown) {
    console.error('[BLACKJACK] Command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `An error occurred: ${message}`, ephemeral: true });
    } else {
      await interaction.editReply({ content: `An error occurred: ${message}` });
    }
  }
}

async function handleSitCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId: string | undefined = blackjackState.getBlackjackChannelId();
  if (!channelId) {
    await interaction.reply({
      content: 'Blackjack is not configured. Set BLACKJACK_CHANNEL_ID in the environment.',
      ephemeral: true,
    });
    return;
  }
  if (interaction.channelId !== channelId) {
    await interaction.reply({
      content: `Head to <#${channelId}> to play blackjack!`,
      ephemeral: true,
    });
    return;
  }
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Blackjack must be played in a text channel.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const user = await economyDb.getOrCreateUser(interaction.user.id, interaction.user.username);
  const stake: number | null = parseStake(
    interaction.options.getString('amount') ?? '',
    user.wallet
  );

  if (stake === null) {
    await interaction.editReply({ content: "Enter a valid stake — a positive number, or 'all'." });
    return;
  }

  const result = await blackjackState.sit({
    userId: interaction.user.id,
    username: interaction.user.username,
    stake,
    sideBets: {
      pairs: interaction.options.getInteger('pairs') ?? 0,
      p3: interaction.options.getInteger('plus3') ?? 0,
    },
    channel: interaction.channel,
    client: interaction.client,
  });

  activeChip.set(interaction.user.id, stake);
  await interaction.editReply({
    content: result.ok ? `✅ ${result.message}` : `❌ ${result.message}`,
  });
}

async function handleLeaveCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = blackjackState.standUp(interaction.user.id);
  await interaction.reply({
    content: result.ok ? `✅ ${result.message}` : `❌ ${result.message}`,
    ephemeral: true,
  });
  blackjackState.refresh();
}

async function handleRules(interaction: ChatInputCommandInteraction): Promise<void> {
  const pairs = PERFECT_PAIRS_PAYOUT;
  const p3 = TWENTY_ONE_PLUS_THREE_PAYOUT;

  const body: string = [
    '## 🃏 House rules',
    '',
    '**6 decks**, persistent shoe, cut card at 75%',
    '**Dealer stands on soft 17**',
    '**Blackjack pays 3:2**',
    'Double after split · Late surrender · Re-split to 4 hands',
    'Insurance pays 2:1 — taking it on a natural is even money',
    '',
    '_House edge about 0.35%._',
    '',
    '### Perfect Pairs',
    `Perfect pair **${pairs.perfect}:1** · Coloured **${pairs.colored}:1** · Mixed **${pairs.mixed}:1**`,
    '',
    '### 21+3',
    `Suited trips **${p3.suited_trips}:1** · Straight flush **${p3.straight_flush}:1** · ` +
      `Trips **${p3.trips}:1** · Straight **${p3.straight}:1** · Flush **${p3.flush}:1**`,
    '',
    '### The round',
    'Seats close, cards go out, then **every seat acts at once** on one shared clock. ' +
      'Anyone still deciding when it runs out is stood automatically.',
    'Your stake rides from round to round until you change it or stand up.',
  ].join('\n');

  await interaction.reply(
    rendered([frame(CASINO_COLORS.blue).addTextDisplayComponents(text(body)).toJSON()], {
      ephemeral: true,
    })
  );
}

// ============ COMPONENT HANDLERS ============

/**
 * Repaint the table after a click changed it.
 *
 * Through the click itself when it came from the live board, which keeps the edit on the
 * interaction's rate limit and shows the new card immediately. From anywhere else - a
 * board left behind by an earlier run - the painter repaints the real board instead.
 *
 * @returns false when there is no table to paint
 */
async function repaintTable(interaction: RoutableInteraction): Promise<boolean> {
  const board = blackjackState.currentBoard();
  if (!board) return false;

  const painted: boolean = await paintViaInteraction(
    interaction,
    board,
    'BLACKJACK',
    blackjackState.getBoardMessageId()
  );
  if (!painted) blackjackState.refresh();

  return true;
}

async function handleChip(interaction: RoutableInteraction, rest: string): Promise<void> {
  if (rest === 'custom') {
    await openSitModal(interaction);
    return;
  }

  const amount: number = Number.parseInt(rest, 10);
  if (!Number.isInteger(amount)) return;

  activeChip.set(interaction.user.id, amount);

  // A seated player changing their chip is changing their riding stake, which is what
  // they almost certainly meant.
  const seat = blackjackState.getSeatView(interaction.user.id);
  if (seat) {
    const result = blackjackState.setStake(interaction.user.id, amount);
    await whisper(interaction, result.message);
    blackjackState.refresh();
    return;
  }

  await whisper(interaction, `Chip set to ${formatCurrency(amount)}. Press Sit to join.`);
}

/**
 * The Sit dialog collects the stake and both side bets in one submit.
 *
 * Three clicks collapse into one interaction, which is the whole reason the modal earns
 * its extra step here when every other control on the table is a single click.
 */
async function openSitModal(interaction: RoutableInteraction): Promise<void> {
  if (!interaction.isButton()) return;

  await interaction.showModal(
    amountWithTogglesModal({
      id: IDS.SIT_MODAL,
      title: 'Take a seat',
      label: 'Stake per round',
      description: "Rides every round until you change it or stand up. 'all' works too.",
      fieldId: SIT_STAKE_FIELD,
      placeholder: String(chipFor(interaction.user.id)),
      toggleLabel: 'Side bets',
      toggleDescription: 'Each matches your stake and settles the moment cards are dealt.',
      toggleFieldId: SIT_SIDEBETS_FIELD,
      toggles: [
        {
          label: '21+3',
          value: 'p3',
          description: 'Your two cards + dealer upcard · up to 100:1',
        },
        {
          label: 'Perfect Pairs',
          value: 'pairs',
          description: 'Your first two cards · up to 25:1',
        },
      ],
    })
  );
}

async function handleSitModal(interaction: RoutableInteraction): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  // Seating reads the wallet, may post the board and edits it, all before there is
  // anything to say back. Acknowledge first; whisper() fills this reply in.
  await ackPrivate(interaction);

  const channel = await requireTableChannel(interaction);
  if (!channel) return;

  const user = await economyDb.getOrCreateUser(interaction.user.id, interaction.user.username);
  const stake: number | null = parseStake(
    interaction.fields.getTextInputValue(SIT_STAKE_FIELD),
    user.wallet
  );

  if (stake === null) {
    await whisper(interaction, "Enter a valid stake — a positive number, or 'all'.");
    return;
  }

  const chosen: readonly string[] = interaction.fields.getCheckboxGroup(SIT_SIDEBETS_FIELD);

  // A side bet matches the main stake. Offering a third amount field for each would
  // undo the point of collecting everything in one dialog.
  const result = await blackjackState.sit({
    userId: interaction.user.id,
    username: interaction.user.username,
    stake,
    sideBets: {
      pairs: chosen.includes('pairs') ? stake : 0,
      p3: chosen.includes('p3') ? stake : 0,
    },
    channel,
    client: interaction.client,
  });

  activeChip.set(interaction.user.id, stake);
  await whisper(interaction, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
  blackjackState.refresh();
}

async function handleSit(interaction: RoutableInteraction): Promise<void> {
  const channel = await requireTableChannel(interaction);
  if (!channel) return;
  await openSitModal(interaction);
}

async function handleLeave(interaction: RoutableInteraction): Promise<void> {
  const result = blackjackState.standUp(interaction.user.id);

  if (!result.ok) {
    await whisper(interaction, result.message);
    return;
  }

  await ackBoard(interaction);
  if (!(await repaintTable(interaction))) await whisper(interaction, result.message);
}

async function handleSlip(interaction: RoutableInteraction): Promise<void> {
  const user = await economyDb.getOrCreateUser(interaction.user.id, interaction.user.username);
  const seat = blackjackState.getSeatView(interaction.user.id);

  const payload = rendered(
    [
      frame(CASINO_COLORS.blue)
        .addTextDisplayComponents(
          text(buildSlipText(seat, chipFor(interaction.user.id), user.wallet))
        )
        .toJSON(),
    ],
    { ephemeral: true }
  );

  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    await interaction.reply(payload);
  }
}

/**
 * A play action from the shared board.
 *
 * The clicker's own interaction repaints the board, which both acknowledges the click
 * inside Discord's three-second deadline and shows the new card to everyone at once.
 */
async function handleAction(
  interaction: RoutableInteraction,
  action: blackjackState.PlayerAction
): Promise<void> {
  // Double and split each open an escrow row before the board can change, so the click
  // is acknowledged ahead of the action rather than by its result.
  await ackBoard(interaction);

  const result = await blackjackState.act(interaction.user.id, action);

  if (!result.ok) {
    await whisper(interaction, result.message);
    return;
  }

  // The round ended on this action. finishRound is painting the settle; a second edit
  // from here would only race it.
  if (result.roundEnded) return;

  await repaintTable(interaction);
}

async function handleInsurance(interaction: RoutableInteraction, take: boolean): Promise<void> {
  // Taking insurance opens an escrow row before there is anything to report.
  await ackPrivate(interaction);

  const result = take
    ? await blackjackState.takeInsurance(interaction.user.id)
    : blackjackState.declineInsurance(interaction.user.id);

  if (!result.ok) {
    await whisper(interaction, result.message);
    return;
  }

  await whisper(interaction, result.message);
  blackjackState.refresh();
}

// ============ ROUTING ============

registerComponentHandler(ID_PREFIX, async (interaction: RoutableInteraction) => {
  const id: string = interaction.customId;

  if (id === IDS.SIT_MODAL) return handleSitModal(interaction);
  if (id === IDS.SIT) return handleSit(interaction);
  if (id === IDS.LEAVE) return handleLeave(interaction);
  if (id === IDS.SLIP) return handleSlip(interaction);

  if (id === IDS.HIT) return handleAction(interaction, 'hit');
  if (id === IDS.STAND) return handleAction(interaction, 'stand');
  if (id === IDS.DOUBLE) return handleAction(interaction, 'double');
  if (id === IDS.SPLIT) return handleAction(interaction, 'split');
  if (id === IDS.SURRENDER) return handleAction(interaction, 'surrender');

  if (id === IDS.INSURANCE_YES) return handleInsurance(interaction, true);
  if (id === IDS.INSURANCE_NO) return handleInsurance(interaction, false);

  if (id.startsWith(IDS.CHIP)) return handleChip(interaction, id.slice(IDS.CHIP.length));

  console.warn(`[BLACKJACK] Unhandled component "${id}"`);
});

// ============ HUB ============

registerGameStatus(() => {
  const open: boolean = blackjackState.isTableOpen();
  const phase = blackjackState.getPhase();

  const PHASE_TEXT: Record<string, string> = {
    idle: 'Table closed — take a seat to open it',
    betting: 'Seats open',
    dealing: 'Dealing',
    insurance: 'Insurance offered',
    acting: 'Hands in play',
    dealer: 'Dealer playing',
    settled: 'Settling',
  };

  return {
    key: 'blackjack',
    label: 'BLACKJACK',
    emoji: '🃏',
    channelId: blackjackState.getBlackjackChannelId(),
    live: open && phase !== 'idle',
    summary: PHASE_TEXT[phase] ?? 'Unknown',
  };
});
