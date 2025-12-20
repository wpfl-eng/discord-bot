import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  CONFIG,
  formatCurrency,
  isCooldownOver,
  randomInt,
  getRandomJob,
} from '../../economy/economyConfig.js';
import type { EconomyUser } from '../../types/database.js';
import type { WorkJob } from '../../economy/economyConfig.js';

export const data = new SlashCommandBuilder()
  .setName('work')
  .setDescription('Put in work at practice to earn some coins');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Check cooldown
    const cooldownMs: number = CONFIG.WORK_COOLDOWN_MINUTES * 60 * 1000;

    if (!isCooldownOver(userData.last_work, cooldownMs)) {
      // Calculate when they can work again using Discord timestamp
      const lastWorkTime: number = userData.last_work ? new Date(userData.last_work).getTime() : 0;
      const nextWorkTime: number = lastWorkTime + cooldownMs;
      const discordTimestamp: number = Math.floor(nextWorkTime / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💼 Work')
        .setDescription(
          `You're too tired to work right now!\n\nTry again <t:${discordTimestamp}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Determine success or failure
    const isSuccess: boolean = Math.random() < CONFIG.WORK_SUCCESS_RATE;
    const job: WorkJob = getRandomJob();

    // Calculate next work time for footer
    const nextWorkTime: number = Date.now() + cooldownMs;
    const discordTimestamp: number = Math.floor(nextWorkTime / 1000);

    if (isSuccess) {
      // Calculate earnings
      const earnings: number = randomInt(CONFIG.WORK_MIN, CONFIG.WORK_MAX);

      // Claim work atomically (updates timestamp and adds reward)
      const updatedUser: EconomyUser | null = await economyDb.claimWork(userId, earnings);

      if (!updatedUser) {
        await interaction.editReply({
          content: 'An error occurred while processing your work reward.',
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💼 Work Complete!')
        .setDescription(`${job.success} ${formatCurrency(earnings)}!`)
        .addFields(
          {
            name: 'Earned',
            value: formatCurrency(earnings),
            inline: true,
          },
          {
            name: 'New Balance',
            value: formatCurrency(updatedUser.wallet),
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: `Work again` })
        .setDescription(
          `${job.success} ${formatCurrency(earnings)}!\n\nWork again <t:${discordTimestamp}:R>`
        );

      await interaction.editReply({ embeds: [embed] });
    } else {
      // Claim work with 0 reward (just updates timestamp)
      await economyDb.claimWork(userId, 0);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💼 Work Failed!')
        .setDescription(`${job.fail}. You earned nothing.\n\nTry again <t:${discordTimestamp}:R>`)
        .addFields({
          name: 'Earned',
          value: formatCurrency(0),
          inline: true,
        })
        .setTimestamp()
        .setFooter({ text: 'Better luck next time!' });

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error: unknown) {
    console.error('work command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
