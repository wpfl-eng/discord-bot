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
  const year = interaction.options.getInteger("year") || 2023;
  const week = interaction.options.getInteger("week") || 17;

  let url = `https://wpflapi.azurewebsites.net/api/optimalcoaching/pointsfor/${year}`;
  if (week) {
    url += `?week=${week}`;
  }

  try {
    await interaction.deferReply();

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    if (data.length === 0) {
      await interaction.editReply("No data found for the specified criteria.");
      return;
    }

    const formattedData = data
      .map((item) => {
        const efficiency = (
          (item.actualPointsFor / item.optimalPointsFor) *
          100
        ).toFixed(2);
        const pointsLeftOnBench = (
          item.optimalPointsFor - item.actualPointsFor
        ).toFixed(2);
        return (
          `**${item.owner}**\n` +
          `\`ACT:${item.actualPointsFor.toFixed(
            2
          )} OPT:${item.optimalPointsFor.toFixed(2)} ` +
          `EFF:${efficiency}% BENCH:${pointsLeftOnBench}\``
        );
      })
      .join("\n");

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
