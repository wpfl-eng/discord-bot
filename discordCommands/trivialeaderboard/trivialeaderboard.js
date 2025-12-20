import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('trivialeaderboard')
  .setDescription('View the trivia leaderboard');

export async function execute(interaction) {
  await interaction.deferReply();

  try {
    const leaderboard = await triviaDb.getLeaderboard(10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No trivia scores yet! Be the first to answer a question.',
      });
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];

    const leaderboardText = leaderboard
      .map((entry, index) => {
        const medal = medals[index] || `${index + 1}.`;
        // return `${medal} **${entry.username}** - ${entry.total_points} pts (NFL: ${entry.nfl_points} | WPFL: ${entry.wpfl_points})`;
        return `${medal} **${entry.username}** - ${entry.total_points} pts (NFL: ${entry.nfl_points})`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('Trivia Leaderboard')
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: 'Top 10 players by total points' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('trivialeaderboard command error:', error);
    await interaction.editReply({
      content: `Error fetching leaderboard: ${error.message}`,
    });
  }
}
