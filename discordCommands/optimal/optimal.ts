import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import fetch from 'node-fetch';
import type { OptimalCoachingResponse } from '../../types/api.js';

export const data = new SlashCommandBuilder()
  .setName('optimal')
  .setDescription('Shows optimal coaching data')
  .addIntegerOption((option) =>
    option
      .setName('year')
      .setDescription('The year to fetch data for')
      .setMinValue(2010)
      .setMaxValue(2025)
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('week')
      .setDescription('The week to fetch data for')
      .setMinValue(1)
      .setMaxValue(18)
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  // Options are required, so non-null assertion is safe
  const year = interaction.options.getInteger('year')!;
  const week = interaction.options.getInteger('week')!;

  const url = `https://wpflapi.azurewebsites.net/api/optimalcoaching/pointsfor/${year}?week=${week}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const responseData = (await response.json()) as OptimalCoachingResponse[];

    if (responseData.length === 0) {
      await interaction.editReply('No data found for the specified criteria.');
      return;
    }

    const formattedData = formatCoachingData(responseData);

    const title = `Optimal Coaching Data for Year ${year}, Week ${week}`;

    await interaction.editReply(`**${title}**\n\n${formattedData}`);
  } catch (error: unknown) {
    console.error('Error fetching optimal coaching data:', error);
    await interaction.editReply(
      'An error occurred while fetching the data. Please try again later.'
    );
  }
}

const formatCoachingData = (data: OptimalCoachingResponse[]): string => {
  const sortedData = data.sort((a, b) => {
    const efficiencyA = a.optimalPointsFor > 0 ? a.actualPointsFor / a.optimalPointsFor : 0;
    const efficiencyB = b.optimalPointsFor > 0 ? b.actualPointsFor / b.optimalPointsFor : 0;
    return efficiencyB - efficiencyA;
  });

  return sortedData
    .map(({ owner, actualPointsFor, optimalPointsFor }, index) => {
      const actual = Number(actualPointsFor).toFixed(2);
      const optimal = Number(optimalPointsFor).toFixed(2);
      const efficiency =
        optimalPointsFor > 0 ? ((actualPointsFor / optimalPointsFor) * 100).toFixed(2) : '0.00';
      const bench = (optimalPointsFor - actualPointsFor).toFixed(2);

      return [
        '```',
        `${index + 1}. ${owner} > ACT:${actual.padStart(
          7
        )} OPT:${optimal.padStart(7)} EFF:${efficiency.padStart(6)}% BENCH:${bench.padStart(7)}`,
        '```',
      ].join('\n');
    })
    .join('');
};
