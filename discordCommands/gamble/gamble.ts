import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import type { EconomyUser } from '../../types/database.js';

export const data = new SlashCommandBuilder()
  .setName('gamble')
  .setDescription('Gamble your coins on a coin flip')
  .addStringOption((option) =>
    option.setName('amount').setDescription("Amount to gamble (number or 'all')").setRequired(true)
  );

/**
 * Execute the gamble command
 * @param interaction - The Discord command interaction
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;
    const amountStr: string = interaction.options.getString('amount')!.toLowerCase();

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Parse amount
    let amount: number;
    let isAllIn: boolean = false;

    if (amountStr === 'all' || amountStr === 'max') {
      amount = userData.wallet;
      isAllIn = true;
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

    // Check min/max
    if (amount < CONFIG.GAMBLE_MIN) {
      await interaction.editReply({
        content: `Minimum bet is ${formatCurrency(CONFIG.GAMBLE_MIN)}.`,
      });
      return;
    }

    if (amount > CONFIG.GAMBLE_MAX) {
      await interaction.editReply({
        content: `Maximum bet is ${formatCurrency(CONFIG.GAMBLE_MAX)}.`,
      });
      return;
    }

    // Check if user has enough in wallet
    if (userData.wallet < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🎰 Gamble Failed')
        .setDescription(
          `You don't have enough coins in your wallet!\n\nYour wallet: ${formatCurrency(userData.wallet)}\nBet amount: ${formatCurrency(amount)}`
        )
        .setFooter({ text: 'Tip: Use /withdraw to get coins from your bank' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Flip the coin
    const isWin: boolean = Math.random() < 0.5;
    const coinResult: string = isWin ? 'Heads' : 'Tails';
    const allInText: string = isAllIn ? ' 🎲 ALL IN!' : '';

    if (isWin) {
      // Win - use atomic gambleWin
      const updatedUser: EconomyUser | null = await economyDb.gambleWin(userId, amount);

      // Handle null case (shouldn't happen, but be consistent with lose case)
      if (!updatedUser) {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🎰 You Won!${allInText}`)
        .setDescription(
          `The coin landed on **${coinResult}**!\n\nYou won ${formatCurrency(amount)}!`
        )
        .addFields(
          {
            name: 'Bet',
            value: formatCurrency(amount),
            inline: true,
          },
          {
            name: 'Winnings',
            value: `+${formatCurrency(amount)}`,
            inline: true,
          },
          {
            name: 'New Balance',
            value: formatCurrency(updatedUser.wallet),
            inline: true,
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.GAMBLE_WIN,
        userId,
        username,
        client: interaction.client,
        amount,
      }).catch((err: unknown) => console.error('Failed to check achievements:', err));
    } else {
      // Lose - use atomic gambleLose
      const updatedUser: EconomyUser | null = await economyDb.gambleLose(userId, amount);

      // This should never be null due to our check above, but handle it anyway
      if (!updatedUser) {
        await interaction.editReply({
          content: 'Something went wrong. Please try again.',
        });
        return;
      }

      const brokeText: string = updatedUser.wallet === 0 ? "\n\n💸 You're broke!" : '';

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`🎰 You Lost!${allInText}`)
        .setDescription(
          `The coin landed on **${coinResult}**!\n\nYou lost ${formatCurrency(amount)}!${brokeText}`
        )
        .addFields(
          {
            name: 'Bet',
            value: formatCurrency(amount),
            inline: true,
          },
          {
            name: 'Lost',
            value: `-${formatCurrency(amount)}`,
            inline: true,
          },
          {
            name: 'New Balance',
            value: formatCurrency(updatedUser.wallet),
            inline: true,
          }
        )
        .setFooter({ text: 'Better luck next time!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.GAMBLE_LOSE,
        userId,
        username,
        client: interaction.client,
        amount,
      }).catch((err: unknown) => console.error('Failed to check achievements:', err));
    }
  } catch (error: unknown) {
    console.error('gamble command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
