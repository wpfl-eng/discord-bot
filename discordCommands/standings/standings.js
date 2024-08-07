// standings.js
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
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("Input year of standings")
      .setRequired(true)
      .setMinValue(2018)
      .setMaxValue(new Date().getFullYear())
  );

export const getStandings = async (espnClient, matchupYear, matchupWeek) => {
  const teams = await espnClient.getTeamsAtWeek({
    seasonId: matchupYear,
    scoringPeriodId: matchupWeek,
  });

  const sortedTeams = teams.sort(
    (a, b) =>
      (a.finalStandingsPosition || a.playoffSeed) -
      (b.finalStandingsPosition || b.playoffSeed)
  );

  return sortedTeams
    .map((team, index) => {
      const member = espnMembers.find((member) => member.id === team.id);
      const memberName = member?.name ?? "Unknown";
      const position = index + 1;
      const record = `(${team.wins}-${team.losses}-${team.ties})`;

      switch (position) {
        case 1:
          return `#${position} 👑${memberName} ${record}👑`;
        case sortedTeams.length:
          return `#${position} 💩${memberName} ${record}💩`;
        default:
          return `#${position} ${memberName} ${record}`;
      }
    })
    .join("\n");
};

export const execute = async (interaction) => {
  const matchupWeek = interaction.options.getInteger("week");
  const matchupYear = interaction.options.getInteger("year");

  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    return await interaction.reply({
      content: "Missing required environment variables",
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  try {
    const espnClient = new Client({ leagueId: parseInt(LEAGUE_ID, 10) });
    espnClient.setCookies({ espnS2: ESPN_S2, SWID });

    const response = await getStandings(espnClient, matchupYear, matchupWeek);

    await interaction.editReply({ content: response });
  } catch (error) {
    console.error("Standings command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
      ephemeral: true,
    });
  }
};
