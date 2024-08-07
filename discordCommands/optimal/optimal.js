import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

export const data = new SlashCommandBuilder()
  .setName("optimal")
  .setDescription("Shows optimal coaching data")
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("The year to fetch data for")
      .setMinValue(2010)
      .setMaxValue(2023)
  )
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("The week to fetch data for (optional)")
      .setMinValue(1)
      .setMaxValue(18)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const year = interaction.options.getInteger("year") || 2023;
  const week = interaction.options.getInteger("week") || 17;

  let url = `https://wpflapi.azurewebsites.net/api/optimalcoaching/pointsfor/${year}`;
  if (week) {
    url += `?week=${week}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    if (data.length === 0) {
      await interaction.editReply("No data found for the specified criteria.");
      return;
    }

    const formattedData = formatCoachingData(data);

    const title = week
      ? `Optimal Coaching Data for Year ${year}, Week ${week}`
      : `Optimal Coaching Data for Year ${year}`;

    await interaction.editReply(`**${title}**\n\n${formattedData}`);
  } catch (error) {
    console.error("Error fetching optimal coaching data:", error);
    await interaction.editReply(
      "An error occurred while fetching the data. Please try again later."
    );
  }
}

const formatCoachingData = (data) => {
  // Sort the data by efficiency (highest to lowest)
  const sortedData = data.sort((a, b) => {
    const efficiencyA = a.actualPointsFor / a.optimalPointsFor;
    const efficiencyB = b.actualPointsFor / b.optimalPointsFor;
    return efficiencyB - efficiencyA;
  });

  return sortedData
    .map(({ owner, actualPointsFor, optimalPointsFor }, index) => {
      const actual = Number(actualPointsFor).toFixed(2);
      const optimal = Number(optimalPointsFor).toFixed(2);
      const efficiency = ((actualPointsFor / optimalPointsFor) * 100).toFixed(
        2
      );
      const bench = (optimalPointsFor - actualPointsFor).toFixed(2);

      return [
        `**${index + 1}. ${owner}**`,
        "```",
        `ACT:${actual.padStart(7)} OPT:${optimal.padStart(7)}`,
        `EFF:${efficiency.padStart(6)}% BENCH:${bench.padStart(7)}`,
        "```",
      ].join("\n");
    })
    .join("\n\n");
};
