import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';

export const data = new SlashCommandBuilder()
  .setName('deposit')
  .setDescription('Deposit coins from your wallet to your bank')
  .addStringOption((option) =>
    option.setName('amount').setDescription("Amount to deposit (number or 'all')").setRequired(true)
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
      // Deposit as much as possible (up to bank capacity)
      const availableSpace: number = userData.bank_capacity - userData.bank;
      amount = Math.min(userData.wallet, availableSpace);
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

    if (amount > userData.wallet) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏦 Deposit Failed')
        .setDescription(
          `You don't have enough coins in your wallet!\n\nYour wallet: ${formatCurrency(userData.wallet)}`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check bank capacity
    const availableSpace: number = userData.bank_capacity - userData.bank;
    if (amount > availableSpace) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏦 Deposit Failed')
        .setDescription(
          `Your bank doesn't have enough space!\n\nBank: ${formatCurrency(userData.bank)} / ${formatCurrency(userData.bank_capacity)}\nAvailable space: ${formatCurrency(availableSpace)}`
        )
        .setFooter({ text: 'Tip: Use /shop to expand your bank capacity' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Perform transfer
    const updatedUser: EconomyUser | null = await economyDb.transferToBank(userId, amount);

    if (!updatedUser) {
      await interaction.editReply({
        content: 'An error occurred while processing the deposit.',
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🏦 Deposit Successful')
      .setDescription(`You deposited ${formatCurrency(amount)} into your bank.`)
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
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('deposit command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
