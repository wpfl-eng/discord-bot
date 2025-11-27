import { SlashCommandBuilder } from "discord.js";
import pkg from "espn-fantasy-football-api/node.js";
const { Client } = pkg;
import { espnMembers } from "../../constants/espnMembers.js";

export const data = new SlashCommandBuilder()
  .setName("median")
  .setDescription("Get ranked scores for a specific week and year")
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("The week number")
      .setRequired(true)
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

async function getRankedScores(week, year) {
  const myClient = new Client({
    leagueId: Number.parseInt(process.env.LEAGUE_ID),
  });
  myClient.setCookies({
    espnS2: process.env.ESPN_S2,
    SWID: process.env.SWID,
  });

  try {
    const matchups = await myClient.getBoxscoreForWeek({
      seasonId: Number.parseInt(year),
      matchupPeriodId: Number.parseInt(week),
      scoringPeriodId: Number.parseInt(week),
    });

    const scores = [];

    matchups.forEach((matchup) => {
      const homeMember = espnMembers.find(
        (member) => member.id === matchup.homeTeamId
      );
      if (homeMember) {
        scores.push({ name: homeMember.name, score: matchup.homeScore });
      }

      if (matchup.awayTeamId) {
        const awayMember = espnMembers.find(
          (member) => member.id === matchup.awayTeamId
        );
        if (awayMember) {
          scores.push({ name: awayMember.name, score: matchup.awayScore });
        }
      }
    });

    scores.sort((a, b) => b.score - a.score);

    let response = `Week ${week} ${year} Scores:\n`;
    scores.forEach((entry, index) => {
      response += `${index + 1}. ${entry.name} - ${entry.score}\n`;
    });

    return response;
  } catch (err) {
    console.error(err);
    return "API returned an error. Try again later.";
  }
}

export async function execute(interaction) {
  await interaction.deferReply();

  const week = interaction.options.getInteger("week");
  const year = interaction.options.getInteger("year") || new Date().getFullYear();

  const response = await getRankedScores(week, year);

  await interaction.editReply({
    content: response,
    ephemeral: false,
  });
}
