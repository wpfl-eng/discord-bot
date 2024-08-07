// standings.js
import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

export const data = new SlashCommandBuilder()
  .setName("ewins")
  .setDescription("Returns expected wins by week and year")
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("Input week of season (optional)")
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("Input year of season (optional)")
      .setMinValue(2010)
      .setMaxValue(new Date().getFullYear())
  );

export const execute = async (interaction) => {
  await interaction.deferReply();

  const week = interaction.options.getInteger("week");
  const year =
    interaction.options.getInteger("year") || new Date().getFullYear();

  let url = `https://wpflapi.azurewebsites.net/api/expectedwins?seasonMax=${year}&seasonMin=${year}`;

  if (week) {
    url += `&weekMax=${week}&weekMin=${week}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    let replyContent = `Expected Wins vs Actual Wins for ${year}`;
    if (week) {
      replyContent += ` (Week ${week})`;
    }
    replyContent += ":\n\n";

    // Sort data by expectedWins in descending order
    data.sort((a, b) => b.expectedWins - a.expectedWins);

    data.forEach((item, index) => {
      replyContent += `${index + 1}. ${item.owner}: ${item.expectedWins.toFixed(
        2
      )} E[W] | ${item.actualWins} A[W]\n`;
    });

    // Add summary of weeks covered
    const weekRange = data[0] ? `${data[0].weekMin}-${data[0].weekMax}` : "N/A";
    replyContent += `\nWeeks covered: ${weekRange}`;

    await interaction.editReply({ content: replyContent });
  } catch (error) {
    console.error("Error fetching expected wins:", error);
    await interaction.editReply({
      content:
        "An error occurred while fetching the data. Please try again later.",
      ephemeral: true,
    });
  }
};
