import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as triviaDb from '../../trivia/triviaDb.js';

export const data = new SlashCommandBuilder()
  .setName('trivialeaderboard')
  .setDescription('View the trivia leaderboard')
  .addStringOption((option) =>
    option
      .setName('view')
      .setDescription('Which leaderboard to show')
      .setRequired(false)
      .addChoices(
        { name: 'Last 30 Days (Default)', value: '30day' },
        { name: 'Current Month', value: 'month' },
        { name: 'All Time', value: 'alltime' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const view = interaction.options.getString('view') || '30day';

  try {
    let leaderboard: { user_id?: string; username: string; points?: number; total_points?: number }[];
    let title: string;
    let footer: string;

    switch (view) {
      case 'month':
        leaderboard = await triviaDb.getCurrentMonthLeaderboard(10);
        title = 'Trivia Leaderboard - Current Month';
        footer = 'Points earned this month';
        break;
      case 'alltime':
        leaderboard = await triviaDb.getLeaderboard(10);
        title = 'Trivia Leaderboard - All Time';
        footer = 'Total points earned';
        break;
      case '30day':
      default:
        leaderboard = await triviaDb.getRolling30DayLeaderboard(10);
        title = 'Trivia Leaderboard - Last 30 Days';
        footer = 'Points earned in last 30 days';
        break;
    }

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No trivia scores yet! Be the first to answer a question.',
      });
      return;
    }

    const medals: string[] = ['🥇', '🥈', '🥉'];

    const leaderboardText: string = leaderboard
      .map((entry, index: number) => {
        const medal: string = medals[index] || `${index + 1}.`;
        const points = entry.points ?? entry.total_points ?? 0;
        return `${medal} **${entry.username}** - ${points} pts`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(title)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: footer });

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('trivialeaderboard command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `Error fetching leaderboard: ${message}`,
    });
  }
}
