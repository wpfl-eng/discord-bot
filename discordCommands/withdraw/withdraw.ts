import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';

export const data = new SlashCommandBuilder()
  .setName('withdraw')
  .setDescription('Withdraw coins from your bank to your wallet')
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("Amount to withdraw (number or 'all')")
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;
    const amountStr: string = interaction.options.getString('amount')?.toLowerCase() ?? '';

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Parse amount
    let amount: number;
    if (amountStr === 'all' || amountStr === 'max') {
      amount = userData.bank;
    } else {
      amount = parseInt(amountStr);
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      await interaction.editReply({
        content: "Please enter a valid amount (a positive number or 'all').",
      });
      return;
    }

    if (amount > userData.bank) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏦 Withdraw Failed')
        .setDescription(
          `You don't have enough coins in your bank!\n\nYour bank: ${formatCurrency(userData.bank)}`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Perform transfer
    const updatedUser: EconomyUser | null = await economyDb.transferToWallet(userId, amount);

    if (!updatedUser) {
      await interaction.editReply({
        content: 'An error occurred while processing the withdrawal.',
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🏦 Withdraw Successful')
      .setDescription(`You withdrew ${formatCurrency(amount)} from your bank.`)
      .addFields(
        {
          name: 'Wallet',
          value: formatCurrency(updatedUser.wallet),
          inline: true,
        },
        {
          name: 'Bank',
          value: `${formatCurrency(updatedUser.bank)} / ${formatCurrency(updatedUser.bank_capacity)}`,
          inline: true,
        }
      )
      .setFooter({
        text: 'Warning: Wallet money can be stolen by other users!',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('withdraw command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
