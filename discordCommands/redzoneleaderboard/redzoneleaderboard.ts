import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as redzoneDb from '../../redzone/redzoneDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';
import type { LeaderboardEntry, LeaderboardCategory } from '../../redzone/redzoneDb.js';

export const data = new SlashCommandBuilder()
  .setName('redzoneleaderboard')
  .setDescription('View the Red Zone leaderboard')
  .addStringOption((option) =>
    option
      .setName('category')
      .setDescription('Leaderboard category')
      .setRequired(false)
      .addChoices(
        { name: 'Most Touchdowns', value: 'touchdowns' },
        { name: 'Highest TD Rate (min 10 games)', value: 'winrate' },
        { name: 'Longest Drive', value: 'drive' },
        { name: 'Highest Profit', value: 'profit' },
        { name: 'Best TD Streak', value: 'streak' },
        { name: 'Biggest Single Win', value: 'biggest_win' }
      )
  );

/**
 * Execute the redzoneleaderboard command
 * @param interaction - The Discord command interaction
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const category: LeaderboardCategory =
    (interaction.options.getString('category') as LeaderboardCategory | null) ?? 'touchdowns';

  try {
    const leaderboard: LeaderboardEntry[] = await redzoneDb.getLeaderboard(category, 10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No Red Zone stats yet! Be the first to play with `/redzone`.',
      });
      return;
    }

    const medals: string[] = ['🥇', '🥈', '🥉'];

    // Format entries based on category
    const leaderboardText: string = leaderboard
      .map((entry: LeaderboardEntry, index: number): string => {
        const medal: string = medals[index] ?? `${index + 1}.`;
        let statText: string = '';

        switch (category) {
          case 'touchdowns':
            statText = `${entry.touchdowns} TDs (${entry.td_rate}% rate)`;
            break;
          case 'winrate':
            statText = `${entry.td_rate}% (${entry.touchdowns}/${entry.games_played} games)`;
            break;
          case 'drive':
            statText = `${entry.longest_drive} yards (${entry.total_yards_gained} total)`;
            break;
          case 'profit': {
            const profit: number = entry.net_profit ?? 0;
            statText = `${profit >= 0 ? '+' : ''}${formatCurrency(profit)}`;
            break;
          }
          case 'streak':
            statText = `${entry.best_td_streak} TD streak`;
            break;
          case 'biggest_win':
            statText = `${formatCurrency(entry.biggest_win ?? 0)}`;
            break;
          default:
            statText = `${entry.touchdowns} TDs`;
        }

        return `${medal} **${entry.username}** - ${statText}`;
      })
      .join('\n');

    // Category titles
    const categoryTitles: Record<LeaderboardCategory, string> = {
      touchdowns: 'Most Touchdowns',
      winrate: 'Highest TD Rate',
      drive: 'Longest Drive',
      profit: 'Highest Profit',
      streak: 'Best TD Streak',
      biggest_win: 'Biggest Single Win',
    };

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`🏈 Red Zone Leaderboard - ${categoryTitles[category]}`)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: category === 'winrate' ? 'Minimum 10 games required' : 'Top 10 players' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('redzoneleaderboard command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `Error fetching leaderboard: ${message}`,
    });
  }
}
