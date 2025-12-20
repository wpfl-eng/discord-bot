import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as redzoneDb from '../../redzone/redzoneDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';

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
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const category = interaction.options.getString('category') || 'touchdowns';

  try {
    const leaderboard = await redzoneDb.getLeaderboard(category, 10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No Red Zone stats yet! Be the first to play with `/redzone`.',
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
          case 'touchdowns':
            statText = `${entry.touchdowns} TDs (${entry.td_rate}% rate)`;
            break;
          case 'winrate':
            statText = `${entry.td_rate}% (${entry.touchdowns}/${entry.games_played} games)`;
            break;
          case 'drive':
            statText = `${entry.longest_drive} yards (${entry.total_yards_gained} total)`;
            break;
          case 'profit':
            const profit = entry.net_profit;
            statText = `${profit >= 0 ? '+' : ''}${formatCurrency(profit)}`;
            break;
          case 'streak':
            statText = `${entry.best_td_streak} TD streak`;
            break;
          case 'biggest_win':
            statText = `${formatCurrency(entry.biggest_win)}`;
            break;
          default:
            statText = `${entry.touchdowns} TDs`;
        }

        return `${medal} **${entry.username}** - ${statText}`;
      })
      .join('\n');

    // Category titles
    const categoryTitles = {
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
  } catch (error) {
    console.error('redzoneleaderboard command error:', error);
    await interaction.editReply({
      content: `Error fetching leaderboard: ${error.message}`,
    });
  }
}
