import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import * as economyDb from "../../economy/economyDb.js";
import {
  CONFIG,
  formatCurrency,
  isCooldownOver,
  randomInt,
  getRandomJob,
  CURRENCY_EMOJI,
} from "../../economy/economyConfig.js";

export const data = new SlashCommandBuilder()
  .setName("work")
  .setDescription("Work a random job to earn some coins");

/**
 * Execute the work command
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
    const cooldownMs = CONFIG.WORK_COOLDOWN_MINUTES * 60 * 1000;

    if (!isCooldownOver(userData.last_work, cooldownMs)) {
      // Calculate when they can work again using Discord timestamp
      const nextWorkTime = new Date(userData.last_work).getTime() + cooldownMs;
      const discordTimestamp = Math.floor(nextWorkTime / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("💼 Work")
        .setDescription(
          `You're too tired to work right now!\n\nTry again <t:${discordTimestamp}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Determine success or failure
    const isSuccess = Math.random() < CONFIG.WORK_SUCCESS_RATE;
    const job = getRandomJob();

    // Calculate next work time for footer
    const nextWorkTime = Date.now() + cooldownMs;
    const discordTimestamp = Math.floor(nextWorkTime / 1000);

    if (isSuccess) {
      // Calculate earnings
      const earnings = randomInt(CONFIG.WORK_MIN, CONFIG.WORK_MAX);

      // Claim work atomically (updates timestamp and adds reward)
      const updatedUser = await economyDb.claimWork(userId, earnings);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("💼 Work Complete!")
        .setDescription(`${job.success} ${formatCurrency(earnings)}!`)
        .addFields(
          {
            name: "Earned",
            value: formatCurrency(earnings),
            inline: true,
          },
          {
            name: "New Balance",
            value: formatCurrency(updatedUser.wallet),
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: `Work again` })
        .setDescription(`${job.success} ${formatCurrency(earnings)}!\n\nWork again <t:${discordTimestamp}:R>`);

      await interaction.editReply({ embeds: [embed] });
    } else {
      // Claim work with 0 reward (just updates timestamp)
      await economyDb.claimWork(userId, 0);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("💼 Work Failed!")
        .setDescription(`${job.fail}. You earned nothing.\n\nTry again <t:${discordTimestamp}:R>`)
        .addFields({
          name: "Earned",
          value: formatCurrency(0),
          inline: true,
        })
        .setTimestamp()
        .setFooter({ text: "Better luck next time!" });

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error("work command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
