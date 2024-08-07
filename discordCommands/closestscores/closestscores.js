import { SlashCommandBuilder } from "discord.js";
import pkg from "espn-fantasy-football-api/node.js";
const { Client } = pkg;
import { differenceInHours } from "date-fns";
import { espnMembers } from "../../constants/espnMembers.js";

export const data = new SlashCommandBuilder()
  .setName("closestscores")
  .setDescription("Get the closest scores for a specific week and year")
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("The week number")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("The year")
      .setRequired(false)
      .setMinValue(2018)
      .setMaxValue(new Date().getFullYear())
  );

async function getMatchups(matchupWeek = 1, matchupYear = 2023) {
  let response = `Week ${matchupWeek} ${matchupYear} Closest Scores:\n`;

  const myClient = new Client({
    leagueId: Number.parseInt(process.env.LEAGUE_ID),
  });
  myClient.setCookies({
    espnS2: process.env.ESPN_S2,
    SWID: process.env.SWID,
  });

  try {
    const matchups = await myClient.getBoxscoreForWeek({
      seasonId: Number.parseInt(matchupYear),
      matchupPeriodId: Number.parseInt(matchupWeek),
      scoringPeriodId: Number.parseInt(matchupWeek),
    });

    matchups.forEach((matchup) => {
      const homeMemberName = espnMembers.find(
        (member) => member.id === matchup.homeTeamId
      ).name;
      const awayMemberName = espnMembers.find(
        (member) => member.id === matchup.awayTeamId
      ).name;

      if (matchup.awayTeamId) {
        const diffScore = matchup.awayScore - matchup.homeScore;

        if (
          (-16 < diffScore && diffScore <= 0) ||
          (0 <= diffScore && diffScore < 16)
        ) {
          response += `${homeMemberName}: ${matchup.homeScore} --- ${awayMemberName}: ${matchup.awayScore}\n`;
        }
      }
    });

    return response;
  } catch (err) {
    console.error(err);
    return "API returned an error. You did something stupid or it's broken. Try again later";
  }
}

export async function execute(interaction) {
  await interaction.deferReply();

  let matchupWeek = interaction.options.getInteger("week");
  let matchupYear = interaction.options.getInteger("year") || 2023;

  if (!matchupWeek) {
    const dateDiff =
      Math.floor(
        differenceInHours(new Date(), new Date(2023, 8, 6)) / (7 * 24)
      ) || 1;
    matchupWeek = dateDiff >= 0 ? dateDiff : 1;
  }

  const response = await getMatchups(matchupWeek, matchupYear);

  await interaction.editReply({
    content: response,
    ephemeral: false,
  });
}
