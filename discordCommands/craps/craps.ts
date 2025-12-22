// Craps Command
// American craps with pass line, don't pass, field, and place bets

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { formatCurrency } from '../../economy/economyConfig.js';
import {
  BET_TYPES,
  COMEOUT_BET_TYPES,
  POINT_BET_TYPES,
  ALL_BET_TYPES,
  LIMITS,
  getBetDisplay,
  formatAmount,
  type BetType,
} from './crapsConfig.js';
import * as crapsState from './crapsState.js';

// ============ TYPE GUARDS ============

/**
 * Check if a string is a valid BetType
 */
function isBetType(value: string): value is BetType {
  return ALL_BET_TYPES.includes(value as BetType);
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
          .setDescription('Type of bet (pass_line, dont_pass, field, place_6, place_8)')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('View the current craps table status')
  );

// ============ AUTOCOMPLETE ============

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused: string = interaction.options.getFocused().toLowerCase();

  // Get available bet types based on current table phase
  const point = crapsState.getCurrentPoint();
  const status = crapsState.getTableStatus();

  // During point phase, only show point bets. During comeout/idle, show comeout bets.
  let availableBets: readonly BetType[];
  if (status === 'idle' || point === null) {
    availableBets = COMEOUT_BET_TYPES;
  } else {
    availableBets = POINT_BET_TYPES;
  }

  const filtered: BetType[] = availableBets.filter((t) =>
    t.toLowerCase().includes(focused) || getBetDisplay(t).toLowerCase().includes(focused)
  );

  await interaction.respond(
    filtered.map((t) => ({
      name: `${getBetDisplay(t)} - ${BET_TYPES[t].description}`,
      value: t,
    }))
  );
}

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand: string = interaction.options.getSubcommand();

  try {
    if (subcommand === 'bet') {
      await handleBet(interaction);
    } else if (subcommand === 'status') {
      await handleStatus(interaction);
    }
  } catch (error: unknown) {
    console.error('[CRAPS] Command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `An error occurred: ${message}`,
        ephemeral: true,
      });
    } else {
      await interaction.editReply({
        content: `An error occurred: ${message}`,
      });
    }
  }
}

// ============ BET HANDLER ============

async function handleBet(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const userId: string = interaction.user.id;
  const username: string = interaction.user.username;
  const amount: number = interaction.options.getInteger('amount', true);
  const betTypeInput: string = interaction.options.getString('type', true).toLowerCase();

  // Check if in craps channel
  const crapsChannelId: string | undefined = crapsState.getCrapsChannelId();
  if (!crapsChannelId) {
    await interaction.editReply({
      content: 'Craps is not configured. Set CRAPS_CHANNEL_ID in environment.',
    });
    return;
  }

  if (interaction.channelId !== crapsChannelId) {
    await interaction.editReply({
      content: `Head to <#${crapsChannelId}> to play craps!`,
    });
    return;
  }

  // Validate bet type
  if (!isBetType(betTypeInput)) {
    await interaction.editReply({
      content: `Invalid bet type: "${betTypeInput}". Try: pass_line, dont_pass, field, place_6, place_8`,
    });
    return;
  }

  const betType: BetType = betTypeInput;

  // Ensure channel is a text channel
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      content: 'This command must be used in a text channel.',
    });
    return;
  }
  const channel: TextChannel = interaction.channel;

  // Place the bet (handles all validation, wallet deduction, state updates)
  const result = await crapsState.placeBet(
    interaction.client,
    channel,
    userId,
    username,
    betType,
    amount
  );

  if (!result.success) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('Bet Failed')
      .setDescription(result.message);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Build confirmation with user's current bets
  const userBets = crapsState.getUserBets(userId);
  const totalExposure = crapsState.getUserTotalExposure(userId);

  const betLines: string[] = userBets.map(
    (b) => `• ${formatAmount(b.amount)} on ${getBetDisplay(b.betType)}`
  );

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Bet Placed!')
    .setDescription(
      `${formatAmount(amount)} on **${getBetDisplay(betType)}**\n\n` +
        '**Your bets this session:**\n' +
        betLines.join('\n') +
        `\n\nTotal on table: ${formatCurrency(totalExposure)}`
    );

  await interaction.editReply({ embeds: [embed] });

  // Post public bet announcement (theater element)
  const betVerb = betType === 'dont_pass' ? 'slides' : 'throws';
  const extra = betType === 'dont_pass' ? ' betting against the table!' : '';
  await channel.send(
    `🎲 <@${userId}> ${betVerb} ${formatAmount(amount)} on **${getBetDisplay(betType)}**!${extra}`
  );
}

// ============ STATUS HANDLER ============

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const info = crapsState.getTableInfo();

  let statusText: string;
  let color: number;

  switch (info.status) {
    case 'idle':
      statusText = 'Table is cold. Place a bet to start!';
      color = 0x95a5a6;
      break;
    case 'betting':
      statusText = 'Bets are open!';
      color = 0x3498db;
      break;
    case 'rolling':
      statusText = 'Dice are in the air!';
      color = 0xf1c40f;
      break;
    case 'resolved':
      statusText = 'Round resolved, new bets opening...';
      color = 0x2ecc71;
      break;
    default:
      statusText = 'Unknown';
      color = 0x95a5a6;
  }

  const lines: string[] = [];
  lines.push(`**Status:** ${statusText}`);

  if (info.point !== null) {
    lines.push(`**Point:** ${info.point}`);
  } else if (info.status !== 'idle') {
    lines.push('**Phase:** Come-out roll');
  }

  if (info.shooter) {
    lines.push(`**Shooter:** <@${info.shooter.userId}>`);
  }

  if (info.rollCount > 0) {
    lines.push(`**Rolls:** ${info.rollCount}`);
  }

  lines.push(`**Active Bets:** ${info.activeBetCount}`);
  lines.push(`**Total Action:** ${formatAmount(info.totalWagered)}`);

  if (info.bettingEndsAt && info.status === 'betting') {
    const spinTime = Math.floor(info.bettingEndsAt / 1000);
    lines.push(`**Rolling:** <t:${spinTime}:R>`);
  }

  // Show available bet types
  const availableBets = info.point === null ? COMEOUT_BET_TYPES : POINT_BET_TYPES;
  lines.push('');
  lines.push('**Available Bets:**');
  for (const betType of availableBets) {
    const config = BET_TYPES[betType];
    lines.push(`• ${config.name}: ${config.description}`);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🎲 Craps Table Status')
    .setDescription(lines.join('\n'))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
