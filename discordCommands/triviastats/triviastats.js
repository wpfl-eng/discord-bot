import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('triviastats')
  .setDescription('View trivia stats for yourself or another user')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('User to view stats for (defaults to yourself)')
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user') || interaction.user;

  try {
    const stats = await triviaDb.getUserStats(targetUser.id);

    if (!stats) {
      await interaction.editReply({
        content: `${targetUser.username} hasn't answered any trivia questions yet!`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle(`Trivia Stats: ${stats.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: 'Total Points',
          value: `${stats.total_points}`,
          inline: true,
        },
        {
          name: 'NFL Points',
          value: `${stats.nfl_points}`,
          inline: true,
        }
        // {
        //   name: "WPFL Points",
        //   value: `${stats.wpfl_points}`,
        //   inline: true,
        // }
      )
      .setTimestamp();

    if (stats.last_correct_at) {
      embed.setFooter({
        text: `Last correct answer: ${new Date(stats.last_correct_at).toLocaleDateString()}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('triviastats command error:', error);
    await interaction.editReply({
      content: `Error fetching stats: ${error.message}`,
    });
  }
}
