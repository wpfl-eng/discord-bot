import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import pkg from "espn-fantasy-football-api/node.js";
const { Client } = pkg;
import { espnMembers } from "../../constants/espnMembers.js";

export const data = new SlashCommandBuilder()
  .setName("median")
  .setDescription("Get ranked scores for a specific week and year")
  .addIntegerOption((option) =>
    option
      .setName("week")
      .setDescription("The week number (default: 13)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(18)
  )
  .addIntegerOption((option) =>
    option
      .setName("year")
      .setDescription("The year (default: 2025)")
      .setRequired(false)
      .setMinValue(2018)
      .setMaxValue(2025)
  );

async function getRankedScores(week, year) {
  const myClient = new Client({
    leagueId: Number.parseInt(process.env.LEAGUE_ID),
  });
  myClient.setCookies({
    espnS2: process.env.ESPN_S2,
    SWID: process.env.SWID,
  });

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
  return scores;
}

function createEmbed(scores, week, year) {
  const cutLine = 7;
  const safeScores = scores.slice(0, cutLine);
  const belowScores = scores.slice(cutLine);

  const safeField = safeScores
    .map((entry, i) => `${i + 1}. ${entry.name} - ${entry.score}`)
    .join("\n");

  const belowField = belowScores
    .map((entry, i) => `${i + cutLine + 1}. ${entry.name} - ${entry.score}`)
    .join("\n");

  const medianScore =
    scores.length >= 2
      ? ((scores[cutLine - 1]?.score || 0) + (scores[cutLine]?.score || 0)) / 2
      : 0;

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Week ${week} ${year} Scores`)
    .setDescription(`Cut Line: Top ${cutLine}`)
    .addFields(
      { name: "Safe", value: safeField || "None", inline: true },
      { name: "Below Cut", value: belowField || "None", inline: true }
    )
    .setFooter({ text: `Median: ${medianScore.toFixed(1)}` })
    .setTimestamp();
}

export async function execute(interaction) {
  await interaction.deferReply();

  const week = interaction.options.getInteger("week") || 13;
  const year = interaction.options.getInteger("year") || 2025;

  try {
    const scores = await getRankedScores(week, year);
    const embed = createEmbed(scores, week, year);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply("API returned an error. Try again later.");
  }
}
