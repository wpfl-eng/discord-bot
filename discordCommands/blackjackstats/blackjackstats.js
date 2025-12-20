import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as blackjackDb from '../../blackjack/blackjackDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';

export const data = new SlashCommandBuilder()
  .setName('blackjackstats')
  .setDescription('View blackjack stats for yourself or another user')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('User to view stats for (defaults to yourself)')
      .setRequired(false)
  );

/**
 * Execute the blackjackstats command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user') || interaction.user;

  try {
    const stats = await blackjackDb.getUserStats(targetUser.id);

    if (!stats) {
      await interaction.editReply({
        content: `${targetUser.username} hasn't played any blackjack yet!`,
      });
      return;
    }

    // Calculate derived stats
    const winRate =
      stats.games_played > 0 ? ((stats.games_won / stats.games_played) * 100).toFixed(1) : '0.0';
    const netProfit = stats.total_won - stats.total_wagered;
    const record = `${stats.games_won}-${stats.games_lost}-${stats.pushes}`;
    const doubleRate =
      stats.doubles_attempted > 0
        ? ((stats.doubles_won / stats.doubles_attempted) * 100).toFixed(0)
        : 'N/A';

    // Determine embed color based on profit
    const embedColor = netProfit > 0 ? 0x2ecc71 : netProfit < 0 ? 0xe74c3c : 0x3498db;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`Blackjack Stats: ${stats.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: 'Games Played',
          value: `${stats.games_played}`,
          inline: true,
        },
        {
          name: 'Record (W-L-P)',
          value: record,
          inline: true,
        },
        {
          name: 'Win Rate',
          value: `${winRate}%`,
          inline: true,
        },
        {
          name: 'Blackjacks',
          value: `${stats.blackjacks_hit}`,
          inline: true,
        },
        {
          name: 'Busts',
          value: `${stats.busts}`,
          inline: true,
        },
        {
          name: 'Double Success',
          value:
            doubleRate === 'N/A'
              ? 'N/A'
              : `${doubleRate}% (${stats.doubles_won}/${stats.doubles_attempted})`,
          inline: true,
        },
        {
          name: 'Total Wagered',
          value: formatCurrency(stats.total_wagered),
          inline: true,
        },
        {
          name: 'Net Profit',
          value: `${netProfit >= 0 ? '+' : ''}${formatCurrency(netProfit)}`,
          inline: true,
        },
        {
          name: 'Biggest Win',
          value: formatCurrency(stats.biggest_win),
          inline: true,
        },
        {
          name: 'Best Win Streak',
          value: `${stats.best_win_streak}`,
          inline: true,
        },
        {
          name: 'Worst Loss Streak',
          value: `${stats.worst_loss_streak}`,
          inline: true,
        },
        {
          name: 'Current Streak',
          value:
            stats.current_streak > 0
              ? `${stats.current_streak} wins`
              : stats.current_streak < 0
                ? `${Math.abs(stats.current_streak)} losses`
                : 'None',
          inline: true,
        }
      )
      .setTimestamp();

    if (stats.last_played_at) {
      embed.setFooter({
        text: `Last played: ${new Date(stats.last_played_at).toLocaleDateString()}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('blackjackstats command error:', error);
    await interaction.editReply({
      content: `Error fetching stats: ${error.message}`,
    });
  }
}
