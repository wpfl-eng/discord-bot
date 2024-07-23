import { SlashCommandBuilder } from "discord.js";
import { Client } from "../../espnClient.cjs";
import { espnMembers } from "../../constants/espnMembers.js";

export const data = new SlashCommandBuilder()
  .setName("standings")
  .setDescription("Returns standings by week and year")
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("Input week of standings")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("Input year of standings")
      .setRequired(true)
  );

export const execute = async (interaction) => {
  const matchupWeek = interaction.options.getInteger("week");
  const matchupYear = interaction.options.getInteger("year");

  if (!matchupWeek || !matchupYear) {
    await interaction.reply({
      content: "Incorrect parameters input",
      ephemeral: true,
    });
    return;
  }

  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    await interaction.reply({
      content: "Missing required environment variables",
      ephemeral: true,
    });
    return;
  }

  if (matchupYear < 2018) {
    await interaction.reply({
      content: "Cant view activity before 2018",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const espnClient = new Client({ leagueId: Number.parseInt(LEAGUE_ID) });
    espnClient.setCookies({ espnS2: ESPN_S2, SWID });

    const teams = await espnClient.getTeamsAtWeek({
      seasonId: Number.parseInt(matchupYear),
      scoringPeriodId: Number.parseInt(matchupWeek),
    });

    let sortedTeams = [];
    if ([...teams][0].finalStandingsPosition === 0) {
      sortedTeams = [...teams].sort((a, b) => {
        if (a.playoffSeed < b.playoffSeed) {
          return -1;
        }
        if (a.playoffSeed > b.playoffSeed) {
          return 1;
        }
        return 0;
      });
    } else {
      sortedTeams = [...teams].sort((a, b) => {
        if (a.finalStandingsPosition < b.finalStandingsPosition) {
          return -1;
        }
        if (a.finalStandingsPosition > b.finalStandingsPosition) {
          return 1;
        }
        return 0;
      });
    }

    let response = "";

    sortedTeams.forEach((team) => {
      const member = espnMembers.find((member) => member.id === team.id);
      const memberName = member ? member.name : "Unknown";

      const position = team.finalStandingsPosition || team.playoffSeed;
      const record = `(${team.wins}-${team.losses}-${team.ties})`;

      if (position === 1) {
        response += `#${position} 👑${memberName} ${record}👑\n`;
      } else if (position === 14) {
        response += `#${position} 💩${memberName} ${record}💩\n`;
      } else {
        response += `#${position} ${memberName} ${record}\n`;
      }
    });

    console.log(response);

    await interaction.editReply({ content: response });
  } catch (e) {
    console.error("Standings command error: ", e);
    await interaction.editReply({
      content: `An error occurred: ${e.message}`,
      ephemeral: true,
    });
  }
};
