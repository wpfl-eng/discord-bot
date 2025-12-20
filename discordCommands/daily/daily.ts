import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { CONFIG, formatCurrency, isCooldownOver } from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Collect your game day check');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Check cooldown
    const cooldownMs: number = CONFIG.DAILY_COOLDOWN_HOURS * 60 * 60 * 1000;

    if (!isCooldownOver(userData.last_daily, cooldownMs)) {
      // Calculate when they can claim again using Discord timestamp
      const lastDailyTime: number = userData.last_daily ? new Date(userData.last_daily).getTime() : 0;
      const nextClaimTime: number = lastDailyTime + cooldownMs;
      const discordTimestamp: number = Math.floor(nextClaimTime / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏈 Game Day Bonus')
        .setDescription(
          `You already collected your game check!\n\nNext payday <t:${discordTimestamp}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Calculate streak
    let newStreak: number = 1;
    const streakExpireMs: number = CONFIG.DAILY_STREAK_EXPIRE_HOURS * 60 * 60 * 1000;

    if (userData.last_daily) {
      const timeSinceLastDaily: number = Date.now() - new Date(userData.last_daily).getTime();

      // If within streak window, increment streak
      if (timeSinceLastDaily < streakExpireMs) {
        newStreak = userData.daily_streak + 1;
      }
      // Otherwise streak resets to 1
    }

    // Calculate reward
    const streakBonus: number = Math.min(
      (newStreak - 1) * CONFIG.DAILY_STREAK_BONUS,
      CONFIG.DAILY_STREAK_MAX_BONUS
    );
    const totalReward: number = CONFIG.DAILY_AMOUNT + streakBonus;

    // Claim daily atomically (updates timestamp, streak, and adds reward)
    const updatedUser: EconomyUser | null = await economyDb.claimDaily(userId, newStreak, totalReward);

    if (!updatedUser) {
      await interaction.editReply({
        content: 'An error occurred while claiming your daily reward.',
      });
      return;
    }

    // Calculate next claim time for footer
    const nextClaimTime: number = Date.now() + cooldownMs;
    const discordTimestamp: number = Math.floor(nextClaimTime / 1000);

    // Build response embed
    const streakEmoji: string = newStreak >= 5 ? '🔥' : '🏆';
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`🏈 Game Check Collected!`)
      .addFields(
        {
          name: 'Base Salary',
          value: formatCurrency(CONFIG.DAILY_AMOUNT),
          inline: true,
        },
        {
          name: 'Win Streak Bonus',
          value: `${formatCurrency(streakBonus)} (${newStreak} games ${streakEmoji})`,
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        },
        {
          name: 'Total Earnings',
          value: formatCurrency(totalReward),
          inline: true,
        },
        {
          name: 'Bank Account',
          value: formatCurrency(updatedUser.wallet),
          inline: true,
        },
        {
          name: '\u200b',
          value: '\u200b',
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({
        text: `Next game check available`,
      })
      .setDescription(`Collect again <t:${discordTimestamp}:R> to keep your win streak!`);

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('daily command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
