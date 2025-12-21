import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, User } from 'discord.js';
import * as videoPokerDb from '../../videopoker/videoPokerDb.js';
import type { VideoPokerStats } from '../../videopoker/videoPokerDb.js';
import { formatCurrency } from '../../economy/economyConfig.js';
import { HAND_NAMES, HandRank } from '../videopoker/videoPokerConfig.js';

export const data = new SlashCommandBuilder()
  .setName('videopokerstats')
  .setDescription('View video poker stats for yourself or another user')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('User to view stats for (defaults to yourself)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const targetUser: User = interaction.options.getUser('user') || interaction.user;

  try {
    const stats: VideoPokerStats | null = await videoPokerDb.getUserStats(targetUser.id);

    if (!stats) {
      await interaction.editReply({
        content: `${targetUser.username} hasn't played any video poker yet!`,
      });
      return;
    }

    // Calculate derived stats
    const winRate: string =
      stats.games_played > 0 ? ((stats.games_won / stats.games_played) * 100).toFixed(1) : '0.0';
    const netProfit: number = stats.total_won - stats.total_wagered;
    const record: string = `${stats.games_won}-${stats.games_lost}`;

    // Build hand breakdown string
    const handBreakdown: string[] = [];
    if (stats.royal_flushes > 0) handBreakdown.push(`Royal: ${stats.royal_flushes}`);
    if (stats.straight_flushes > 0) handBreakdown.push(`SF: ${stats.straight_flushes}`);
    if (stats.four_of_a_kinds > 0) handBreakdown.push(`4K: ${stats.four_of_a_kinds}`);
    if (stats.full_houses > 0) handBreakdown.push(`FH: ${stats.full_houses}`);
    if (stats.flushes > 0) handBreakdown.push(`Fl: ${stats.flushes}`);
    if (stats.straights > 0) handBreakdown.push(`St: ${stats.straights}`);
    if (stats.three_of_a_kinds > 0) handBreakdown.push(`3K: ${stats.three_of_a_kinds}`);
    if (stats.two_pairs > 0) handBreakdown.push(`2P: ${stats.two_pairs}`);
    if (stats.jacks_or_betters > 0) handBreakdown.push(`J+: ${stats.jacks_or_betters}`);

    const handBreakdownStr = handBreakdown.length > 0 ? handBreakdown.join(' | ') : 'None';

    // Determine embed color based on profit
    const embedColor: number = netProfit > 0 ? 0x2ecc71 : netProfit < 0 ? 0xe74c3c : 0x3498db;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`Video Poker Stats: ${stats.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: 'Games Played',
          value: `${stats.games_played}`,
          inline: true,
        },
        {
          name: 'Record (W-L)',
          value: record,
          inline: true,
        },
        {
          name: 'Win Rate',
          value: `${winRate}%`,
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
        },
        {
          name: 'Winning Hands',
          value: handBreakdownStr,
          inline: false,
        }
      )
      .setTimestamp();

    if (stats.last_played_at) {
      embed.setFooter({
        text: `Last played: ${new Date(stats.last_played_at).toLocaleDateString()}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('videopokerstats command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `Error fetching stats: ${message}`,
    });
  }
}
