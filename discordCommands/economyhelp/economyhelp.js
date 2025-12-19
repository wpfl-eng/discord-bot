import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { CURRENCY_EMOJI } from "../../economy/economyConfig.js";

export const data = new SlashCommandBuilder()
  .setName("economyhelp")
  .setDescription("View all economy commands");

/**
 * Execute the economyhelp command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${CURRENCY_EMOJI} Economy Commands`)
    .setDescription("A virtual currency system to earn, spend, gamble, and steal coins!")
    .addFields(
      { name: "💰 /balance [@user]", value: "Check your or another user's balance", inline: false },
      { name: "☀️ /daily", value: "Claim your daily reward (streak bonuses!)", inline: false },
      { name: "💼 /work", value: "Work a random job for coins", inline: false },
      { name: "🏦 /deposit <amount|all>", value: "Move coins from wallet to bank (safe from robbery)", inline: false },
      { name: "🏦 /withdraw <amount|all>", value: "Move coins from bank to wallet", inline: false },
      { name: "🎰 /gamble <amount|all>", value: "50/50 coin flip - double or nothing!", inline: false },
      { name: "🦹 /rob @user", value: "Attempt to steal from another user's wallet", inline: false },
      { name: "🏆 /eleaderboard", value: "View the top 10 wealthiest users", inline: false },
      { name: "🛒 /shop", value: "Buy padlocks and bank expansions", inline: false }
    )
    .setFooter({ text: "Tip: Keep money in your bank to protect it from robbery!" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
