// ewins.js
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";

export const data = new SlashCommandBuilder()
  .setName("ewins")
  .setDescription("Returns expected wins vs actual wins by week and year")
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("Season year (default: current year)")
      .setMinValue(2010)
      .setMaxValue(2025)
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("Week of season (default: all weeks)")
      .setMinValue(1)
      .setMaxValue(18)
      .setRequired(true)
  );

export const execute = async (interaction, fetchFn = fetch) => {
  await interaction.deferReply();

  const year = interaction.options.getInteger("year") || 2025;
  const week = interaction.options.getInteger("week") || 9;

  const url = new URL("https://wpflapi.azurewebsites.net/api/expectedwins");
  url.searchParams.set("seasonMax", year);
  url.searchParams.set("seasonMin", year);
  if (week) {
    url.searchParams.set("weekMax", week);
    url.searchParams.set("weekMin", 1);
  }

  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    if (data.length === 0) {
      return await interaction.editReply(
        "No data available for the specified period."
      );
    }

    const sortedData = data.sort((a, b) => b.expectedWins - a.expectedWins);
    const embed = createEmbed(sortedData, year, week);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching expected wins:", error);
    await interaction.editReply(
      "An error occurred while fetching the data. Please try again later."
    );
  }
};

export function createEmbed(data, year, week) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(
      `Expected Wins vs Actual Wins ${year}${week ? ` (Week ${week})` : ""}`
    )
    .setDescription(`Weeks covered: ${data[0].weekMin}-${data[0].weekMax}`)
    .setTimestamp();

  let fieldValue = "";
  data.forEach((item, index) => {
    const line = `${index + 1}. ${item.owner}: ${item.expectedWins.toFixed(
      2
    )} E[W] | ${item.actualWins} A[W]\n`;
    if (fieldValue.length + line.length > 1024) {
      embed.addFields({ name: "\u200B", value: fieldValue });
      fieldValue = line;
    } else {
      fieldValue += line;
    }
  });

  if (fieldValue) {
    embed.addFields({ name: "\u200B", value: fieldValue });
  }

  const totalExpectedWins = data.reduce(
    (sum, item) => sum + item.expectedWins,
    0
  );
  const totalActualWins = data.reduce((sum, item) => sum + item.actualWins, 0);
  embed.setFooter({
    text: `Total: ${totalExpectedWins.toFixed(
      2
    )} E[W] | ${totalActualWins} A[W]`,
  });

  return embed;
}
