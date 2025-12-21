import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import fetch from 'node-fetch';
import type { ExpectedWinsResponse } from '../../types/api.js';

export const data = new SlashCommandBuilder()
  .setName('ewins')
  .setDescription('Returns expected wins vs actual wins by week and year')
  .addIntegerOption((option) =>
    option
      .setName('year')
      .setDescription('Season year (default: current year)')
      .setMinValue(2010)
      .setMaxValue(2025)
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('week')
      .setDescription('Week of season (default: all weeks)')
      .setMinValue(1)
      .setMaxValue(18)
      .setRequired(true)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction,
  fetchFn: typeof fetch = fetch
): Promise<void> => {
  await interaction.deferReply();

  // Options are required, so non-null assertion is safe
  const year = interaction.options.getInteger('year')!;
  const week = interaction.options.getInteger('week')!;

  const url = new URL('https://wpflapi.azurewebsites.net/api/expectedwins');
  url.searchParams.set('seasonMax', String(year));
  url.searchParams.set('seasonMin', String(year));
  url.searchParams.set('weekMax', String(week));
  url.searchParams.set('weekMin', '1');

  try {
    const response = await fetchFn(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const responseData = (await response.json()) as ExpectedWinsResponse[];

    if (responseData.length === 0) {
      await interaction.editReply('No data available for the specified period.');
      return;
    }

    const sortedData = responseData.sort((a, b) => b.expectedWins - a.expectedWins);
    const embed = createEmbed(sortedData, year, week);

    await interaction.editReply({ embeds: [embed] });
  } catch (error: unknown) {
    console.error('Error fetching expected wins:', error);
    await interaction.editReply(
      'An error occurred while fetching the data. Please try again later.'
    );
  }
};

export function createEmbed(
  data: ExpectedWinsResponse[],
  year: number,
  week: number | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Expected Wins vs Actual Wins ${year}${week ? ` (Week ${week})` : ''}`)
    .setDescription(`Weeks covered: ${data[0].weekMin}-${data[0].weekMax}`)
    .setTimestamp();

  let fieldValue = '';
  data.forEach((item, index) => {
    const line = `${index + 1}. ${item.owner}: ${item.expectedWins.toFixed(
      2
    )} E[W] | ${item.actualWins} A[W]\n`;
    if (fieldValue.length + line.length > 1024) {
      embed.addFields({ name: '\u200B', value: fieldValue });
      fieldValue = line;
    } else {
      fieldValue += line;
    }
  });

  if (fieldValue) {
    embed.addFields({ name: '\u200B', value: fieldValue });
  }

  const totalExpectedWins = data.reduce((sum, item) => sum + item.expectedWins, 0);
  const totalActualWins = data.reduce((sum, item) => sum + item.actualWins, 0);
  embed.setFooter({
    text: `Total: ${totalExpectedWins.toFixed(2)} E[W] | ${totalActualWins} A[W]`,
  });

  return embed;
}
