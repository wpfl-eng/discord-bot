import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { formatLargeNumber, CURRENCY_EMOJI } from '../../economy/economyConfig.js';
import type { TotalWealthEntry } from '../../types/database.js';

export const data = new SlashCommandBuilder()
  .setName('eleaderboard')
  .setDescription('View the economy leaderboard');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;

    // Ensure current user exists in the database
    await economyDb.getOrCreateUser(userId, username);

    // Get total wealth leaderboard
    const leaderboard: TotalWealthEntry[] = await economyDb.getTotalWealthLeaderboard(10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content: 'No one has any coins yet! Use `/daily` or `/work` to start earning.',
      });
      return;
    }

    // Get current user's rank
    const userRank: number | null = await economyDb.getTotalWealthUserRank(userId);
    const totalUsers: number = await economyDb.getTotalUsers();

    // Build leaderboard text
    const medals: string[] = ['🥇', '🥈', '🥉'];
    const leaderboardText: string = leaderboard
      .map((entry: TotalWealthEntry, index: number) => {
        const medal: string = medals[index] || `${index + 1}.`;
        const isCurrentUser: boolean = entry.user_id === userId;
        const highlight: string = isCurrentUser ? '**' : '';
        return `${medal} ${highlight}${entry.username}${highlight} - ${formatLargeNumber(entry.total_wealth)}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`${CURRENCY_EMOJI} Economy Leaderboard`)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: `Your rank: #${userRank} of ${totalUsers}` });

    // If user is not in top 10, show their position with breakdown
    const userInTop10: boolean = leaderboard.some((entry: TotalWealthEntry) => entry.user_id === userId);
    if (!userInTop10 && userRank) {
      const userWealth: TotalWealthEntry | null = await economyDb.getUserTotalWealth(userId);
      if (userWealth) {
        const breakdown = `💵 ${Math.floor(userWealth.cash_wealth).toLocaleString()} | 📈 ${Math.floor(userWealth.stock_wealth).toLocaleString()} | 📦 ${Math.floor(userWealth.inventory_wealth).toLocaleString()}`;
        embed.addFields({
          name: `Your Position: #${userRank}`,
          value: `${formatLargeNumber(userWealth.total_wealth)}\n${breakdown}`,
          inline: false,
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('[ELEADERBOARD] Error:', error);
    await interaction.editReply({
      content: 'An error occurred while fetching the leaderboard. Please try again.',
    });
  }
}
