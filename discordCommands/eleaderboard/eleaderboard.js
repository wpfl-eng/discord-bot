import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import * as economyDb from "../../economy/economyDb.js";
import { formatCurrency, CURRENCY_EMOJI } from "../../economy/economyConfig.js";

export const data = new SlashCommandBuilder()
  .setName("eleaderboard")
  .setDescription("View the economy leaderboard");

/**
 * Execute the eleaderboard command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Ensure current user exists in the database
    await economyDb.getOrCreateUser(userId, username);

    // Get leaderboard
    const leaderboard = await economyDb.getLeaderboard(10);

    if (leaderboard.length === 0) {
      await interaction.editReply({
        content:
          "No one has any coins yet! Use `/daily` or `/work` to start earning.",
      });
      return;
    }

    // Get current user's rank
    const userRank = await economyDb.getUserRank(userId);
    const totalUsers = await economyDb.getTotalUsers();

    // Build leaderboard text
    const medals = ["🥇", "🥈", "🥉"];
    const leaderboardText = leaderboard
      .map((entry, index) => {
        const medal = medals[index] || `${index + 1}.`;
        const isCurrentUser = entry.user_id === userId;
        const highlight = isCurrentUser ? "**" : "";
        return `${medal} ${highlight}${entry.username}${highlight} - ${formatCurrency(entry.total_wealth)}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`${CURRENCY_EMOJI} Economy Leaderboard`)
      .setDescription(leaderboardText)
      .setTimestamp()
      .setFooter({ text: `Your rank: #${userRank} of ${totalUsers}` });

    // If user is not in top 10, show their position
    const userInTop10 = leaderboard.some((entry) => entry.user_id === userId);
    if (!userInTop10 && userRank) {
      const currentUser = await economyDb.getUser(userId);
      const totalWealth = currentUser.wallet + currentUser.bank;
      embed.addFields({
        name: "Your Position",
        value: `#${userRank} - ${formatCurrency(totalWealth)}`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("eleaderboard command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
