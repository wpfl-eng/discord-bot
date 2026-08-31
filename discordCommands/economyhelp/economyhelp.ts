import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CURRENCY_EMOJI } from '../../economy/economyConfig.js';

export const data = new SlashCommandBuilder()
  .setName('economyhelp')
  .setDescription('View all economy commands');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${CURRENCY_EMOJI} Economy Commands`)
    .setDescription('A virtual currency system to earn, spend, and gamble coins!')
    .addFields(
      { name: '💰 /balance [@user]', value: "Check your or another user's balance", inline: false },
      { name: '☀️ /daily', value: 'Claim your daily reward (streak bonuses!)', inline: false },
      { name: '💼 /work', value: 'Work a random job for coins', inline: false },
      {
        name: '🏦 /deposit <amount|all>',
        value: 'Move coins from wallet to bank',
        inline: false,
      },
      { name: '🏦 /withdraw <amount|all>', value: 'Move coins from bank to wallet', inline: false },
      {
        name: '🎰 /gamble <amount|all>',
        value: '50/50 coin flip - double or nothing!',
        inline: false,
      },
      { name: '🏈 /slots <amount|all>', value: 'Football-themed slot machine!', inline: false },
      {
        name: '🃏 /blackjack <amount|all>',
        value: 'Play blackjack - Hit, Stand, or Double Down!',
        inline: false,
      },
      { name: '🏆 /eleaderboard', value: 'View the top 10 wealthiest users', inline: false },
      {
        name: '🛒 /shop',
        value: 'Buy bank expansions',
        inline: false,
      },
      { name: '📦 /inventory', value: 'View and sell items from your inventory', inline: false }
    )
    .setFooter({ text: 'Tip: Use /shop to gear up!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
