import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { formatCurrency, CURRENCY_EMOJI } from '../../economy/economyConfig.js';

export const data = new SlashCommandBuilder()
  .setName('withdraw')
  .setDescription('Withdraw coins from your bank to your wallet')
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("Amount to withdraw (number or 'all')")
      .setRequired(true)
  );

/**
 * Execute the withdraw command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const amountStr = interaction.options.getString('amount').toLowerCase();

    // Get or create user
    const userData = await economyDb.getOrCreateUser(userId, username);

    // Parse amount
    let amount;
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
    const updatedUser = await economyDb.transferToWallet(userId, amount);

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
  } catch (error) {
    console.error('withdraw command error:', error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
