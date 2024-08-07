import { SlashCommandBuilder } from "discord.js";
import { formatNumber } from "../../helpers/utils.js";
import { espnMembers } from "../../constants/espnMembers.js";
import { Client } from "../../espnClient.cjs";

// Define the command structure
export const data = new SlashCommandBuilder()
  .setName("trophies")
  .setDescription("Returns trophies by week and year")
  .addIntegerOption(
    (option) =>
      option
        .setName("week")
        .setDescription("Input week of matchup")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(18) // Assuming a maximum of 17 weeks in a season
  )
  .addIntegerOption(
    (option) =>
      option
        .setName("year")
        .setDescription("Input year of matchup")
        .setRequired(true)
        .setMinValue(2018)
        .setMaxValue(new Date().getFullYear()) // Dynamic max year
  );

// Main execution function
export const execute = async (interaction) => {
  // Get user inputs
  const matchupWeek = interaction.options.getInteger("week");
  const matchupYear = interaction.options.getInteger("year");

  // Check for required environment variables
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    return await interaction.reply({
      content: "Missing required environment variables",
      ephemeral: true,
    });
  }

  // Defer the reply to allow for processing time
  await interaction.deferReply();

  try {
    // Initialize ESPN client
    const espnClient = new Client({ leagueId: parseInt(LEAGUE_ID, 10) });
    espnClient.setCookies({ espnS2: ESPN_S2, SWID });

    // Fetch boxscores for the specified week and year
    const boxscores = await espnClient.getBoxscoreForWeek({
      seasonId: matchupYear,
      matchupPeriodId: matchupWeek,
      scoringPeriodId: matchupWeek,
    });

    // Analyze scores and format response
    const scores = analyzeScores(boxscores);
    const response = formatResponse(matchupWeek, matchupYear, scores);

    // Send the formatted response
    await interaction.editReply({ content: response });
  } catch (error) {
    console.error("Trophies command error:", error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
      ephemeral: true,
    });
  }
};

// Analyze boxscores to determine various trophy categories
const analyzeScores = (boxscores) => {
  return boxscores.reduce(
    (scores, { homeTeamId, awayTeamId, homeScore, awayScore }) => {
      const homeMemberName = getMemberName(homeTeamId);
      const awayMemberName = getMemberName(awayTeamId);

      updateHighLowScores(scores, homeScore, homeMemberName);
      updateHighLowScores(scores, awayScore, awayMemberName);
      updateCloseAndBlowoutScores(
        scores,
        homeScore,
        awayScore,
        homeMemberName,
        awayMemberName
      );
      updateHighestScoringLoserAndLowestScoringWinner(
        scores,
        homeScore,
        awayScore,
        homeMemberName,
        awayMemberName
      );
      scores.totalScore += homeScore + awayScore;
      scores.matchupCount += 1;

      return scores;
    },
    {
      lowScore: Infinity,
      lowScoreTeam: "",
      highScore: -Infinity,
      highScoreTeam: "",
      closeScore: Infinity,
      closeScoreWinner: "",
      closeScoreLoser: "",
      biggestBlowout: -Infinity,
      biggestBlowoutWinner: "",
      biggestBlowoutLoser: "",
      highestScoringLoser: { score: -Infinity, team: "" },
      lowestScoringWinner: { score: Infinity, team: "" },
      totalScore: 0,
      matchupCount: 0,
    }
  );
};

// Get member name from team ID
const getMemberName = (teamId) =>
  espnMembers.find((member) => member.id === teamId)?.name ?? "Unknown";

// Update high and low scores
const updateHighLowScores = (scores, score, teamName) => {
  if (score > scores.highScore) {
    scores.highScore = score;
    scores.highScoreTeam = teamName;
  }
  if (score < scores.lowScore) {
    scores.lowScore = score;
    scores.lowScoreTeam = teamName;
  }
};

// Update close game and blowout statistics
const updateCloseAndBlowoutScores = (
  scores,
  homeScore,
  awayScore,
  homeMemberName,
  awayMemberName
) => {
  const scoreDifference = Math.abs(homeScore - awayScore);
  const [winner, loser] =
    homeScore > awayScore
      ? [homeMemberName, awayMemberName]
      : [awayMemberName, homeMemberName];

  // Update close game
  if (scoreDifference !== 0 && scoreDifference < scores.closeScore) {
    scores.closeScore = scoreDifference;
    scores.closeScoreWinner = winner;
    scores.closeScoreLoser = loser;
  }

  // Update blowout
  if (scoreDifference > scores.biggestBlowout) {
    scores.biggestBlowout = scoreDifference;
    scores.biggestBlowoutWinner = winner;
    scores.biggestBlowoutLoser = loser;
  }
};

const updateHighestScoringLoserAndLowestScoringWinner = (
  scores,
  homeScore,
  awayScore,
  homeMemberName,
  awayMemberName
) => {
  if (homeScore > awayScore) {
    // Home team won
    if (homeScore < scores.lowestScoringWinner.score) {
      scores.lowestScoringWinner = { score: homeScore, team: homeMemberName };
    }
    if (awayScore > scores.highestScoringLoser.score) {
      scores.highestScoringLoser = { score: awayScore, team: awayMemberName };
    }
  } else {
    // Away team won
    if (awayScore < scores.lowestScoringWinner.score) {
      scores.lowestScoringWinner = { score: awayScore, team: awayMemberName };
    }
    if (homeScore > scores.highestScoringLoser.score) {
      scores.highestScoringLoser = { score: homeScore, team: homeMemberName };
    }
  }
};

// Format the response message
const formatResponse = (week, year, scores) => {
  const weeklyAverageScore = scores.totalScore / (scores.matchupCount * 2);
  return `
Week ${week} ${year} Trophies:
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
  } by a margin of ${formatNumber(scores.biggestBlowout)} points
- Highest Scoring Loser: ${scores.highestScoringLoser.team} with ${formatNumber(
    scores.highestScoringLoser.score
  )} points
- Lowest Scoring Winner: ${scores.lowestScoringWinner.team} with ${formatNumber(
    scores.lowestScoringWinner.score
  )} points
- Weekly Average Score: ${formatNumber(weeklyAverageScore)} points
`.trim();
};
