import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as blackjackDb from '../../blackjack/blackjackDb.js';
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

/**
 * Execute the blackjackleaderboard command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const category = interaction.options.getString('category') || 'games';

  try {
    const leaderboard = await blackjackDb.getLeaderboard(category, 10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No blackjack stats yet! Be the first to play.',
      });
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];

    // Format entries based on category
    const leaderboardText = leaderboard
      .map((entry, index) => {
        const medal = medals[index] || `${index + 1}.`;
        let statText = '';

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
            const profit = entry.net_profit;
            statText = `${profit >= 0 ? '+' : ''}${formatCurrency(profit)}`;
            break;
          }
          case 'streak':
            statText = `${entry.best_win_streak} win streak`;
            break;
          case 'biggest_win':
            statText = `${formatCurrency(entry.biggest_win)}`;
            break;
          default:
            statText = `${entry.games_played} games`;
        }

        return `${medal} **${entry.username}** - ${statText}`;
      })
      .join('\n');

    // Category titles
    const categoryTitles = {
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
  } catch (error) {
    console.error('blackjackleaderboard command error:', error);
    await interaction.editReply({
      content: `Error fetching leaderboard: ${error.message}`,
    });
  }
}
