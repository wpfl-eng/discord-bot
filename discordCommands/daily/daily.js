import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import * as economyDb from "../../economy/economyDb.js";
import {
  CONFIG,
  formatCurrency,
  isCooldownOver,
  CURRENCY_EMOJI,
} from "../../economy/economyConfig.js";

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward");

/**
 * Execute the daily command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Get or create user
    const userData = await economyDb.getOrCreateUser(userId, username);

    // Check cooldown
    const cooldownMs = CONFIG.DAILY_COOLDOWN_HOURS * 60 * 60 * 1000;

    if (!isCooldownOver(userData.last_daily, cooldownMs)) {
      // Calculate when they can claim again using Discord timestamp
      const nextClaimTime = new Date(userData.last_daily).getTime() + cooldownMs;
      const discordTimestamp = Math.floor(nextClaimTime / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("☀️ Daily Reward")
        .setDescription(
          `You've already claimed your daily reward!\n\nCome back <t:${discordTimestamp}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Calculate streak
    let newStreak = 1;
    const streakExpireMs = CONFIG.DAILY_STREAK_EXPIRE_HOURS * 60 * 60 * 1000;

    if (userData.last_daily) {
      const timeSinceLastDaily =
        Date.now() - new Date(userData.last_daily).getTime();

      // If within streak window, increment streak
      if (timeSinceLastDaily < streakExpireMs) {
        newStreak = userData.daily_streak + 1;
      }
      // Otherwise streak resets to 1
    }

    // Calculate reward
    const streakBonus = Math.min(
      (newStreak - 1) * CONFIG.DAILY_STREAK_BONUS,
      CONFIG.DAILY_STREAK_MAX_BONUS
    );
    const totalReward = CONFIG.DAILY_AMOUNT + streakBonus;

    // Claim daily atomically (updates timestamp, streak, and adds reward)
    const updatedUser = await economyDb.claimDaily(userId, newStreak, totalReward);

    // Calculate next claim time for footer
    const nextClaimTime = Date.now() + cooldownMs;
    const discordTimestamp = Math.floor(nextClaimTime / 1000);

    // Build response embed
    const streakEmoji = newStreak >= 5 ? "🔥" : "";
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`☀️ Daily Reward Claimed!`)
      .addFields(
        {
          name: "Base Reward",
          value: formatCurrency(CONFIG.DAILY_AMOUNT),
          inline: true,
        },
        {
          name: "Streak Bonus",
          value: `${formatCurrency(streakBonus)} (${newStreak} days ${streakEmoji})`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Total Earned",
          value: formatCurrency(totalReward),
          inline: true,
        },
        {
          name: "New Balance",
          value: formatCurrency(updatedUser.wallet),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({
        text: `Next daily available`,
      })
      .setDescription(`Come back <t:${discordTimestamp}:R> to keep your streak!`);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("daily command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
