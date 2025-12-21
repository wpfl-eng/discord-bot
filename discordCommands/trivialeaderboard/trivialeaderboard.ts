import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';
import type { TriviaScore } from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('trivialeaderboard')
  .setDescription('View the trivia leaderboard');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const leaderboard: TriviaScore[] = await triviaDb.getLeaderboard(10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No trivia scores yet! Be the first to answer a question.',
      });
      return;
    }

    const medals: string[] = ['🥇', '🥈', '🥉'];

    const leaderboardText: string = leaderboard
      .map((entry: TriviaScore, index: number) => {
        const medal: string = medals[index] || `${index + 1}.`;
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
  } catch (error: unknown) {
    console.error('trivialeaderboard command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `Error fetching leaderboard: ${message}`,
    });
  }
}
