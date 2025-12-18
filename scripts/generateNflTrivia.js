/**
 * NFL Trivia Question Generator
 * Fetches player stats from nflverse and generates trivia questions
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// nflverse data URLs
const PLAYER_STATS_URL = (year) =>
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${year}.csv`;

// Years to fetch (nflverse has data from 1999, but we want 2010-2024)
const START_YEAR = 2010;
const END_YEAR = 2024;

/**
 * Parse CSV string into array of objects
 * @param {string} csvString - Raw CSV content
 * @returns {Array<Object>} - Array of row objects
 */
function parseCSV(csvString) {
  const lines = csvString.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Parse a single CSV line handling quoted values
 * @param {string} line - CSV line
 * @returns {Array<string>} - Array of values
 */
function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Fetch player stats for a given year
 * @param {number} year - Season year
 * @returns {Promise<Array<Object>>} - Array of player stats
 */
async function fetchPlayerStats(year) {
  const url = PLAYER_STATS_URL(year);
  console.log(`Fetching ${year} player stats...`);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/csv,application/csv,*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csvText = await response.text();
    return parseCSV(csvText);
  } catch (error) {
    console.error(`Error fetching ${year}:`, error.message);
    return [];
  }
}

/**
 * Aggregate weekly stats into season totals by player
 * @param {Array<Object>} weeklyStats - Weekly player stats
 * @param {number} year - Season year
 * @returns {Map<string, Object>} - Map of player_id to aggregated stats
 */
function aggregateSeasonStats(weeklyStats, year) {
  const playerStats = new Map();

  for (const week of weeklyStats) {
    // Only include regular season games
    if (week.season_type !== "REG") continue;

    const playerId = week.player_id;
    if (!playerId) continue;

    if (!playerStats.has(playerId)) {
      playerStats.set(playerId, {
        player_id: playerId,
        player_name: week.player_display_name || week.player_name,
        position: week.position,
        team: week.recent_team || week.team,
        season: year,
        passing_yards: 0,
        passing_tds: 0,
        interceptions: 0,
        rushing_yards: 0,
        rushing_tds: 0,
        receiving_yards: 0,
        receiving_tds: 0,
        receptions: 0,
        sacks: 0,
      });
    }

    const stats = playerStats.get(playerId);
    // Update with most recent name/team
    stats.player_name = week.player_display_name || week.player_name || stats.player_name;
    stats.team = week.recent_team || week.team || stats.team;

    // Aggregate stats
    stats.passing_yards += parseFloat(week.passing_yards) || 0;
    stats.passing_tds += parseInt(week.passing_tds) || 0;
    stats.interceptions += parseInt(week.interceptions) || 0;
    stats.rushing_yards += parseFloat(week.rushing_yards) || 0;
    stats.rushing_tds += parseInt(week.rushing_tds) || 0;
    stats.receiving_yards += parseFloat(week.receiving_yards) || 0;
    stats.receiving_tds += parseInt(week.receiving_tds) || 0;
    stats.receptions += parseInt(week.receptions) || 0;
    stats.sacks += parseFloat(week.sacks) || 0;
  }

  return playerStats;
}

/**
 * Find the leader for a given stat category
 * @param {Map<string, Object>} playerStats - Aggregated player stats
 * @param {string} statField - Field to find leader for
 * @param {string} positionFilter - Optional position filter (e.g., "QB")
 * @returns {Object|null} - Leader stats or null
 */
function findLeader(playerStats, statField, positionFilter = null) {
  let leader = null;
  let maxValue = -Infinity;

  for (const [, stats] of playerStats) {
    if (positionFilter && stats.position !== positionFilter) continue;
    const value = stats[statField];
    if (value > maxValue) {
      maxValue = value;
      leader = stats;
    }
  }

  return leader;
}

/**
 * Generate acceptable answers from a player name
 * @param {string} playerName - Full player name
 * @returns {Array<string>} - Array of acceptable answers
 */
function generateAcceptableAnswers(playerName) {
  if (!playerName) return [];

  const acceptable = [playerName];
  const parts = playerName.split(" ");

  // Add last name only
  if (parts.length >= 2) {
    acceptable.push(parts[parts.length - 1]);
  }

  // Add first name + last initial for common format (e.g., "Patrick M.")
  if (parts.length >= 2) {
    acceptable.push(`${parts[0]} ${parts[parts.length - 1][0]}.`);
  }

  return acceptable;
}

/**
 * Question templates for generating trivia
 */
const QUESTION_TEMPLATES = [
  {
    category: "passing_yards",
    template: (year) => `Who led the NFL in passing yards in ${year}?`,
    statField: "passing_yards",
    positionFilter: null,
    pointValue: 2,
  },
  {
    category: "rushing_yards",
    template: (year) => `Who led the NFL in rushing yards in ${year}?`,
    statField: "rushing_yards",
    positionFilter: null,
    pointValue: 2,
  },
  {
    category: "receiving_yards",
    template: (year) => `Who led the NFL in receiving yards in ${year}?`,
    statField: "receiving_yards",
    positionFilter: null,
    pointValue: 2,
  },
  {
    category: "passing_tds",
    template: (year) => `Which quarterback threw the most touchdown passes in ${year}?`,
    statField: "passing_tds",
    positionFilter: "QB",
    pointValue: 2,
  },
  {
    category: "rushing_tds",
    template: (year) => `Who scored the most rushing touchdowns in ${year}?`,
    statField: "rushing_tds",
    positionFilter: null,
    pointValue: 2,
  },
  {
    category: "receiving_tds",
    template: (year) => `Who scored the most receiving touchdowns in ${year}?`,
    statField: "receiving_tds",
    positionFilter: null,
    pointValue: 2,
  },
  {
    category: "receptions",
    template: (year) => `Who led the NFL in receptions in ${year}?`,
    statField: "receptions",
    positionFilter: null,
    pointValue: 2,
  },
  {
    category: "interceptions",
    template: (year) => `Which quarterback threw the most interceptions in ${year}?`,
    statField: "interceptions",
    positionFilter: "QB",
    pointValue: 3,
  },
];

/**
 * Generate trivia questions from aggregated stats
 * @param {Map<string, Object>} playerStats - Aggregated player stats
 * @param {number} year - Season year
 * @returns {Array<Object>} - Array of trivia questions
 */
function generateQuestionsForYear(playerStats, year) {
  const questions = [];

  for (const template of QUESTION_TEMPLATES) {
    const leader = findLeader(playerStats, template.statField, template.positionFilter);

    if (leader && leader[template.statField] > 0) {
      questions.push({
        id: `nfl_${year}_${template.category}`,
        question: template.template(year),
        answer: leader.player_name,
        acceptable_answers: generateAcceptableAnswers(leader.player_name),
        point_value: template.pointValue,
        metadata: {
          year: year,
          category: template.category,
          stat_value: Math.round(leader[template.statField]),
          team: leader.team,
        },
      });
    }
  }

  return questions;
}

/**
 * Main function to generate all trivia questions
 */
async function main() {
  console.log("=== NFL Trivia Question Generator ===\n");

  const allQuestions = [];

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const weeklyStats = await fetchPlayerStats(year);

    if (weeklyStats.length === 0) {
      console.log(`No data for ${year}, skipping...\n`);
      continue;
    }

    console.log(`  Found ${weeklyStats.length} weekly stat records`);

    const seasonStats = aggregateSeasonStats(weeklyStats, year);
    console.log(`  Aggregated ${seasonStats.size} players`);

    const questions = generateQuestionsForYear(seasonStats, year);
    console.log(`  Generated ${questions.length} questions\n`);

    allQuestions.push(...questions);
  }

  // Sort by year then category
  allQuestions.sort((a, b) => {
    if (a.metadata.year !== b.metadata.year) {
      return a.metadata.year - b.metadata.year;
    }
    return a.metadata.category.localeCompare(b.metadata.category);
  });

  // Write to file
  const outputPath = path.join(__dirname, "..", "trivia", "nflQuestions.json");
  fs.writeFileSync(outputPath, JSON.stringify(allQuestions, null, 2));

  console.log("=== Summary ===");
  console.log(`Total questions generated: ${allQuestions.length}`);
  console.log(`Output written to: ${outputPath}`);

  // Print sample questions
  console.log("\n=== Sample Questions ===");
  const samples = allQuestions.slice(0, 5);
  for (const q of samples) {
    console.log(`\nQ: ${q.question}`);
    console.log(`A: ${q.answer} (${q.metadata.stat_value})`);
  }
}

main().catch(console.error);
