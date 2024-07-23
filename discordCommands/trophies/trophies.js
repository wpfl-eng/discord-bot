import { SlashCommandBuilder } from "discord.js";
import { formatNumber } from "../../helpers/utils.js";
import { espnMembers } from "../../constants/espnMembers.js";
import { Client } from "../../espnClient.cjs";

const HIGH_SCORE_INIT = -1;
const LOW_SCORE_INIT = 9999;
const SCORE_DIFF_INIT = 9999;

export const data = new SlashCommandBuilder()
  .setName("trophies")
  .setDescription("Returns trophies by week and year")
  .addStringOption((option) =>
    option
      .setName("week")
      .setDescription("Input week of matchup")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("year")
      .setDescription("Input year of matchup")
      .setRequired(true)
  );

export const execute = async (interaction) => {
  const matchupWeek = interaction.options.getString("week");
  const matchupYear = interaction.options.getString("year");

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

    const boxscores = await espnClient.getBoxscoreForWeek({
      seasonId: matchupYear,
      matchupPeriodId: Number.parseInt(matchupWeek),
      scoringPeriodId: Number.parseInt(matchupWeek),
    });

    const scores = analyzeScores(boxscores);

    const response = formatResponse(matchupWeek, matchupYear, scores);
    await interaction.editReply({ content: response });
  } catch (error) {
    console.error("Trophies command error: ", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
      ephemeral: true,
    });
  }
};

const analyzeScores = (boxscores) => {
  let scores = {
    lowScore: LOW_SCORE_INIT,
    lowScoreTeam: "",
    highScore: HIGH_SCORE_INIT,
    highScoreTeam: "",
    closeScore: SCORE_DIFF_INIT,
    closeScoreWinner: "",
    closeScoreLoser: "",
    biggestBlowout: HIGH_SCORE_INIT,
    biggestBlowoutWinner: "",
    biggestBlowoutLoser: "",
  };

  boxscores.forEach(({ homeTeamId, awayTeamId, homeScore, awayScore }) => {
    const homeMemberName = getMemberName(homeTeamId);
    const awayMemberName = getMemberName(awayTeamId);

    updateScores(homeScore, homeMemberName, scores);
    updateScores(awayScore, awayMemberName, scores);
    updateCloseScores(
      homeScore,
      awayScore,
      homeMemberName,
      awayMemberName,
      scores
    );
    updateBlowoutScores(
      homeScore,
      awayScore,
      homeMemberName,
      awayMemberName,
      scores
    );
  });

  return scores;
};

const getMemberName = (teamId) => {
  const member = espnMembers.find((member) => member.id === teamId);
  return member ? member.name : "Unknown";
};

const updateScores = (score, teamName, scores) => {
  if (score > scores.highScore) {
    scores.highScore = score;
    scores.highScoreTeam = teamName;
  }
  if (score < scores.lowScore) {
    scores.lowScore = score;
    scores.lowScoreTeam = teamName;
  }
};

const updateCloseScores = (
  homeScore,
  awayScore,
  homeMemberName,
  awayMemberName,
  scores
) => {
  const scoreDifference = Math.abs(homeScore - awayScore);
  if (scoreDifference !== 0 && scoreDifference < scores.closeScore) {
    scores.closeScore = scoreDifference;
    if (homeScore > awayScore) {
      scores.closeScoreWinner = homeMemberName;
      scores.closeScoreLoser = awayMemberName;
    } else {
      scores.closeScoreWinner = awayMemberName;
      scores.closeScoreLoser = homeMemberName;
    }
  }
};

const updateBlowoutScores = (
  homeScore,
  awayScore,
  homeMemberName,
  awayMemberName,
  scores
) => {
  const blowoutDifference = Math.abs(homeScore - awayScore);
  if (blowoutDifference > scores.biggestBlowout) {
    scores.biggestBlowout = blowoutDifference;
    if (homeScore > awayScore) {
      scores.biggestBlowoutWinner = homeMemberName;
      scores.biggestBlowoutLoser = awayMemberName;
    } else {
      scores.biggestBlowoutWinner = awayMemberName;
      scores.biggestBlowoutLoser = homeMemberName;
    }
  }
};

const formatResponse = (week, year, scores) => {
  return `Week ${week} ${year} Trophies:
  - Lowest Score with ${formatNumber(scores.lowScore)} points: ${
    scores.lowScoreTeam
  }
  - Highest Score with ${formatNumber(scores.highScore)} points: ${
    scores.highScoreTeam
  }
  - ${scores.closeScoreWinner} barely beat ${
    scores.closeScoreLoser
  } by a margin of ${formatNumber(scores.closeScore)} points
  - ${scores.biggestBlowoutLoser} blown out by ${
    scores.biggestBlowoutWinner
  } by a margin of ${formatNumber(scores.biggestBlowout)} points`;
};
