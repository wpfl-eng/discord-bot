import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as blackjackDb from '../../blackjack/blackjackDb.js';
import type { LeaderboardCategory, LeaderboardEntry } from '../../blackjack/blackjackDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';

export const data = new SlashCommandBuilder()
  .setName('blackjackleaderboard')
  .setDescription('View the blackjack leaderboard')
  .addStringOption((option) =>
    option
      .setName('category')
      .setDescription('Leaderboard category')
      .setRequired(false)
      .addChoices(
        { name: 'Most Games Played', value: 'games' },
        { name: 'Most Wins', value: 'wins' },
        { name: 'Highest Win Rate (min 20 games)', value: 'winrate' },
        { name: 'Most Blackjacks', value: 'blackjacks' },
        { name: 'Highest Profit', value: 'profit' },
        { name: 'Best Win Streak', value: 'streak' },
        { name: 'Biggest Single Win', value: 'biggest_win' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const category: LeaderboardCategory =
    (interaction.options.getString('category') as LeaderboardCategory) || 'games';

  try {
    const leaderboard: LeaderboardEntry[] = await blackjackDb.getLeaderboard(category, 10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No blackjack stats yet! Be the first to play.',
      });
      return;
    }

    const medals: string[] = ['🥇', '🥈', '🥉'];

    // Format entries based on category
    const leaderboardText: string = leaderboard
      .map((entry: LeaderboardEntry, index: number) => {
        const medal: string = medals[index] || `${index + 1}.`;
        let statText: string = '';

        switch (category) {
          case 'games':
            statText = `${entry.games_played} games (${entry.win_rate}% WR)`;
            break;
          case 'wins':
            statText = `${entry.games_won} wins (${entry.win_rate}% WR)`;
            break;
          case 'winrate':
            statText = `${entry.win_rate}% (${entry.games_won}/${entry.games_played})`;
            break;
          case 'blackjacks':
            statText = `${entry.blackjacks_hit} blackjacks in ${entry.games_played} games`;
            break;
          case 'profit': {
            const profit: number = entry.net_profit ?? 0;
            statText = `${profit >= 0 ? '+' : ''}${formatCurrency(profit)}`;
            break;
          }
          case 'streak':
            statText = `${entry.best_win_streak} win streak`;
            break;
          case 'biggest_win':
            statText = `${formatCurrency(entry.biggest_win ?? 0)}`;
            break;
          default:
            statText = `${entry.games_played} games`;
        }

        return `${medal} **${entry.username}** - ${statText}`;
      })
      .join('\n');

    // Category titles
    const categoryTitles: Record<LeaderboardCategory, string> = {
      games: 'Most Games Played',
      wins: 'Most Wins',
      winrate: 'Highest Win Rate',
      blackjacks: 'Most Blackjacks',
      profit: 'Highest Profit',
      streak: 'Best Win Streak',
      biggest_win: 'Biggest Single Win',
    };

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`Blackjack Leaderboard - ${categoryTitles[category]}`)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: category === 'winrate' ? 'Minimum 20 games required' : 'Top 10 players' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('blackjackleaderboard command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `Error fetching leaderboard: ${message}`,
    });
  }
}
