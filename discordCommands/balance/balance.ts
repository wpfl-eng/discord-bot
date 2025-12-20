import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { formatCurrency, CURRENCY_EMOJI } from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription("Check your or another user's economy balance")
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('User to check balance for (defaults to yourself)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(targetUser.id, targetUser.username);

    // Get user's rank
    const rank: number | null = await economyDb.getUserRank(targetUser.id);
    const totalUsers: number = await economyDb.getTotalUsers();
    const totalWealth: number = userData.wallet + userData.bank;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${CURRENCY_EMOJI} ${targetUser.username}'s Balance`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: 'Wallet',
          value: formatCurrency(userData.wallet),
          inline: true,
        },
        {
          name: 'Bank',
          value: `${formatCurrency(userData.bank)} / ${formatCurrency(userData.bank_capacity)}`,
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        },
        {
          name: 'Net Worth',
          value: formatCurrency(totalWealth),
          inline: true,
        },
        {
          name: 'Rank',
          value: `#${rank} of ${totalUsers}`,
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: 'Economy System' });

    // Add padlock indicator if they have one
    if (userData.has_padlock) {
      embed.addFields({
        name: 'Protection',
        value: '🔒 Padlock active',
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('balance command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
