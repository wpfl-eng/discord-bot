import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";

export const data = new SlashCommandBuilder()
  .setName("cursed")
  .setDescription("Reveal your fantasy football curses and statistical nightmares")
  .addStringOption((option) =>
    option
      .setName("user")
      .setDescription("Manager name to analyze")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmin")
      .setDescription("Minimum season year (default: 2015)")
      .setRequired(false)
      .setMinValue(2015)
      .setMaxValue(2025)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmax")
      .setDescription("Maximum season year (default: 2025)")
      .setRequired(false)
      .setMinValue(2015)
      .setMaxValue(2025)
  );

/**
 * Executes the cursed command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction
 */
export async function execute(interaction) {
  // Defer immediately
  await interaction.deferReply();

  try {
    const userName = interaction.options.getString("user");
    const inputSeasonMin = interaction.options.getInteger("seasonmin");
    const inputSeasonMax = interaction.options.getInteger("seasonmax");
    
    // Handle season range
    let seasonMin = inputSeasonMin;
    let seasonMax = inputSeasonMax;
    
    if (!seasonMin && !seasonMax) {
      seasonMin = 2015;
      seasonMax = 2025;
    } else if (seasonMin && !seasonMax) {
      seasonMax = 2025;
    } else if (!seasonMin && seasonMax) {
      seasonMin = 2015;
    }
    
    // Swap if backwards
    if (seasonMin > seasonMax) {
      [seasonMin, seasonMax] = [seasonMax, seasonMin];
    }
    
    console.log(`[CURSED] Analyzing curses for ${userName} (${seasonMin}-${seasonMax})`);
    
    // Fetch all matchup data
    const matchupUrl = `https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMin=${seasonMin}&seasonMax=${seasonMax}`;
    const matchupResponse = await fetch(matchupUrl);
    
    if (!matchupResponse.ok) {
      throw new Error("Failed to fetch matchup data");
    }
    
    const allGames = await matchupResponse.json();
    
    // Filter games for this user
    const userGames = allGames.filter(game => 
      game.teamA.toLowerCase() === userName.toLowerCase() || 
      game.teamB.toLowerCase() === userName.toLowerCase()
    );
    
    if (userGames.length === 0) {
      await interaction.editReply(`No data found for "${userName}". Please check the spelling and try again.`);
      return;
    }
    
    // Process the games to find curses
    const curseData = analyzeCurses(userGames, userName);
    
    // Create embed
    const embed = createCursedEmbed(userName, curseData, seasonMin, seasonMax);
    
    await interaction.editReply({ embeds: [embed] });
    
  } catch (error) {
    console.error("[CURSED] Error:", error);
    await interaction.editReply("An error occurred while analyzing curses. Please try again.");
  }
}

/**
 * Analyzes games to find curse patterns
 * @param {Array} games - All games for the user
 * @param {string} userName - The user being analyzed
 * @returns {Object} Curse data
 */
function analyzeCurses(games, userName) {
  const curses = {
    totalGames: 0,
    totalWins: 0,
    totalLosses: 0,
    closeGames: [],
    badBeats: [],
    weekCurses: {},
    marginBuckets: {
      under3: { wins: 0, losses: 0 },
      under5: { wins: 0, losses: 0 },
      under10: { wins: 0, losses: 0 }
    },
    playoffGames: [],
    mustWinGames: [],
    highScoringLosses: [],
    lowScoringWins: [],
    streaks: {
      currentStreak: { type: null, count: 0 },
      longestWinStreak: 0,
      longestLossStreak: 0
    },
    opponents: {},
    seasonRecords: {}
  };
  
  // Sort games chronologically
  games.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return parseInt(a.week) - parseInt(b.week);
  });
  
  let currentStreak = { type: null, count: 0 };
  let winStreak = 0;
  let lossStreak = 0;
  
  games.forEach(game => {
    const isTeamA = game.teamA.toLowerCase() === userName.toLowerCase();
    const userScore = isTeamA ? game.teamAPoints : game.teamBPoints;
    const oppScore = isTeamA ? game.teamBPoints : game.teamAPoints;
    const opponent = isTeamA ? game.teamB : game.teamA;
    const won = userScore > oppScore;
    const margin = Math.abs(userScore - oppScore);
    
    curses.totalGames++;
    if (won) {
      curses.totalWins++;
      winStreak++;
      lossStreak = 0;
      if (winStreak > curses.streaks.longestWinStreak) {
        curses.streaks.longestWinStreak = winStreak;
      }
    } else {
      curses.totalLosses++;
      lossStreak++;
      winStreak = 0;
      if (lossStreak > curses.streaks.longestLossStreak) {
        curses.streaks.longestLossStreak = lossStreak;
      }
    }
    
    // Update current streak
    if (currentStreak.type === null || currentStreak.type === won) {
      currentStreak.type = won;
      currentStreak.count++;
    } else {
      currentStreak = { type: won, count: 1 };
    }
    
    // Track margin buckets
    if (margin < 3) {
      won ? curses.marginBuckets.under3.wins++ : curses.marginBuckets.under3.losses++;
      curses.closeGames.push({ ...game, margin, won, userScore, oppScore });
    }
    if (margin < 5) {
      won ? curses.marginBuckets.under5.wins++ : curses.marginBuckets.under5.losses++;
    }
    if (margin < 10) {
      won ? curses.marginBuckets.under10.wins++ : curses.marginBuckets.under10.losses++;
    }
    
    // Track bad beats (lost by <3 with high score)
    if (!won && margin < 3 && userScore > 100) {
      curses.badBeats.push({ ...game, margin, userScore, oppScore, opponent });
    }
    
    // Track week-specific curses
    const week = game.week;
    if (!curses.weekCurses[week]) {
      curses.weekCurses[week] = { wins: 0, losses: 0 };
    }
    won ? curses.weekCurses[week].wins++ : curses.weekCurses[week].losses++;
    
    // Track playoff games
    if (game.isPlayoffs || parseInt(week) >= 14) {
      curses.playoffGames.push({ ...game, won, margin, userScore, oppScore });
    }
    
    // Track high-scoring losses and low-scoring wins
    if (!won && userScore > 130) {
      curses.highScoringLosses.push({ ...game, userScore, oppScore, margin });
    }
    if (won && userScore < 80) {
      curses.lowScoringWins.push({ ...game, userScore, oppScore, margin });
    }
    
    // Track opponent records
    if (!curses.opponents[opponent]) {
      curses.opponents[opponent] = { wins: 0, losses: 0, totalFor: 0, totalAgainst: 0 };
    }
    curses.opponents[opponent][won ? 'wins' : 'losses']++;
    curses.opponents[opponent].totalFor += userScore;
    curses.opponents[opponent].totalAgainst += oppScore;
    
    // Track season records
    if (!curses.seasonRecords[game.season]) {
      curses.seasonRecords[game.season] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    }
    curses.seasonRecords[game.season][won ? 'wins' : 'losses']++;
    curses.seasonRecords[game.season].pointsFor += userScore;
    curses.seasonRecords[game.season].pointsAgainst += oppScore;
  });
  
  curses.streaks.currentStreak = currentStreak;
  
  return curses;
}

/**
 * Creates the cursed embed
 * @param {string} userName - User being analyzed
 * @param {Object} curseData - Analyzed curse data
 * @param {number} seasonMin - Min season
 * @param {number} seasonMax - Max season
 * @returns {EmbedBuilder} The embed
 */
function createCursedEmbed(userName, curseData, seasonMin, seasonMax) {
  const seasonRange = seasonMin === seasonMax ? `(${seasonMin})` : `(${seasonMin}-${seasonMax})`;
  
  const embed = new EmbedBuilder()
    .setTitle(`🔮 THE CURSE OF ${userName.toUpperCase()} ${seasonRange}`)
    .setColor(0x8B0000)
    .setTimestamp()
    .setFooter({ text: "May the fantasy gods have mercy on your soul" });
  
  // Heartbreak Statistics
  const heartbreakStats = [];
  
  // Close game record
  const under5Record = `${curseData.marginBuckets.under5.wins}-${curseData.marginBuckets.under5.losses}`;
  const under3Record = `${curseData.marginBuckets.under3.wins}-${curseData.marginBuckets.under3.losses}`;
  heartbreakStats.push(`• Lost ${curseData.marginBuckets.under5.losses} games by <5 points (Record: ${under5Record})`);
  heartbreakStats.push(`• ${under3Record} record in games decided by <3 points`);
  
  // Worst bad beat
  if (curseData.badBeats.length > 0) {
    const worstBeat = curseData.badBeats.sort((a, b) => a.margin - b.margin)[0];
    heartbreakStats.push(`• Worst bad beat: Lost by ${worstBeat.margin.toFixed(1)} with ${worstBeat.userScore.toFixed(1)} pts (Week ${worstBeat.week}, ${worstBeat.season})`);
  }
  
  embed.addFields({
    name: "😱 HEARTBREAK STATISTICS",
    value: heartbreakStats.join("\n") || "Lucky you - no heartbreaks found!",
    inline: false
  });
  
  // Specific Curses
  const specificCurses = [];
  
  // Week curses
  const weekCurseEntries = Object.entries(curseData.weekCurses)
    .map(([week, record]) => ({
      week: parseInt(week),
      wins: record.wins,
      losses: record.losses,
      winPct: record.wins / (record.wins + record.losses)
    }))
    .filter(w => w.losses >= 2 && w.winPct < 0.4)
    .sort((a, b) => a.winPct - b.winPct);
  
  if (weekCurseEntries.length > 0) {
    const worstWeek = weekCurseEntries[0];
    specificCurses.push(`• The "Week ${worstWeek.week} Wormhole": ${worstWeek.wins}-${worstWeek.losses} all-time`);
  }
  
  // Opponent curses
  const nemeses = Object.entries(curseData.opponents)
    .map(([opp, record]) => ({
      opponent: opp,
      wins: record.wins,
      losses: record.losses,
      winPct: record.wins / (record.wins + record.losses)
    }))
    .filter(o => o.losses >= 3 && o.winPct < 0.35)
    .sort((a, b) => a.winPct - b.winPct);
  
  if (nemeses.length > 0) {
    const topNemesis = nemeses[0];
    specificCurses.push(`• The "${topNemesis.opponent} Hex": ${topNemesis.wins}-${topNemesis.losses} lifetime`);
  }
  
  // High scoring losses curse
  if (curseData.highScoringLosses.length >= 3) {
    specificCurses.push(`• The "Points Don't Matter" Curse: Lost ${curseData.highScoringLosses.length} games scoring 130+`);
  }
  
  // Playoff curse
  const playoffRecord = curseData.playoffGames.reduce((acc, game) => {
    game.won ? acc.wins++ : acc.losses++;
    return acc;
  }, { wins: 0, losses: 0 });
  
  if (playoffRecord.losses >= 3 && playoffRecord.wins / (playoffRecord.wins + playoffRecord.losses) < 0.4) {
    specificCurses.push(`• The "December Disaster": ${playoffRecord.wins}-${playoffRecord.losses} in playoffs/Week 14+`);
  }
  
  // Streak curse
  if (curseData.streaks.longestLossStreak >= 5) {
    specificCurses.push(`• The "Spiral of Doom": ${curseData.streaks.longestLossStreak}-game losing streak`);
  }
  
  if (specificCurses.length > 0) {
    embed.addFields({
      name: "🎯 SPECIFIC CURSES",
      value: specificCurses.slice(0, 5).join("\n"),
      inline: false
    });
  }
  
  // Patterns of Pain
  const painPatterns = [];
  
  // Season of suffering
  const worstSeason = Object.entries(curseData.seasonRecords)
    .map(([season, record]) => ({
      season,
      winPct: record.wins / (record.wins + record.losses),
      pointsDiff: record.pointsFor - record.pointsAgainst
    }))
    .sort((a, b) => a.winPct - b.winPct)[0];
  
  if (worstSeason && worstSeason.winPct < 0.4) {
    painPatterns.push(`• ${worstSeason.season} Season from Hell: ${(worstSeason.winPct * 100).toFixed(1)}% win rate`);
  }
  
  // Points against curse
  const totalPA = Object.values(curseData.seasonRecords).reduce((sum, s) => sum + s.pointsAgainst, 0);
  const avgPA = totalPA / curseData.totalGames;
  if (avgPA > 110) {
    painPatterns.push(`• Opponent Magnet: ${avgPA.toFixed(1)} PPG against (everyone goes off)`);
  }
  
  // Close game futility
  const closeGamePct = curseData.marginBuckets.under5.losses / (curseData.marginBuckets.under5.wins + curseData.marginBuckets.under5.losses);
  if (closeGamePct > 0.6 && curseData.marginBuckets.under5.losses >= 5) {
    painPatterns.push(`• Clutch Factor: ${(closeGamePct * 100).toFixed(0)}% loss rate in close games`);
  }
  
  if (painPatterns.length > 0) {
    embed.addFields({
      name: "💔 PATTERNS OF PAIN",
      value: painPatterns.join("\n"),
      inline: false
    });
  }
  
  // The Ultimate Curse
  let ultimateCurse = "";
  let curseTagline = "";
  
  // Determine the user's ultimate curse based on their worst trait
  if (closeGamePct > 0.65 && curseData.marginBuckets.under5.losses >= 5) {
    ultimateCurse = `"${userName}'s Law of Narrow Defeats"`;
    curseTagline = `The closer the game, the more certain the loss\n` +
                   `• Win % in blowouts: ${((curseData.totalWins - curseData.marginBuckets.under10.wins) / (curseData.totalGames - curseData.marginBuckets.under10.wins - curseData.marginBuckets.under10.losses) * 100).toFixed(1)}%\n` +
                   `• Win % in nail-biters: ${(curseData.marginBuckets.under3.wins / (curseData.marginBuckets.under3.wins + curseData.marginBuckets.under3.losses) * 100).toFixed(1)}%`;
  } else if (curseData.highScoringLosses.length >= 4) {
    ultimateCurse = `"The ${userName} Paradox"`;
    curseTagline = `The more points you score, the more your opponent scores\n` +
                   `• Record when scoring 130+: ${curseData.highScoringLosses.filter(g => g.won).length}-${curseData.highScoringLosses.length}\n` +
                   `• Average opponent score in those games: ${(curseData.highScoringLosses.reduce((sum, g) => sum + g.oppScore, 0) / curseData.highScoringLosses.length).toFixed(1)}`;
  } else if (playoffRecord.losses >= 4 && playoffRecord.wins / (playoffRecord.wins + playoffRecord.losses) < 0.35) {
    ultimateCurse = `"${userName}'s December Doom"`;
    curseTagline = `Regular season warrior, playoff peasant\n` +
                   `• Regular season win %: ${((curseData.totalWins - playoffRecord.wins) / (curseData.totalGames - playoffRecord.wins - playoffRecord.losses) * 100).toFixed(1)}%\n` +
                   `• Playoff win %: ${(playoffRecord.wins / (playoffRecord.wins + playoffRecord.losses) * 100).toFixed(1)}%`;
  } else if (nemeses.length > 0 && nemeses[0].winPct < 0.25) {
    ultimateCurse = `"The Curse of ${nemeses[0].opponent}"`;
    curseTagline = `Some rivalries are just meant to hurt\n` +
                   `• Lifetime record vs ${nemeses[0].opponent}: ${nemeses[0].wins}-${nemeses[0].losses}\n` +
                   `• Win % vs everyone else: ${((curseData.totalWins - nemeses[0].wins) / (curseData.totalGames - nemeses[0].wins - nemeses[0].losses) * 100).toFixed(1)}%`;
  } else {
    ultimateCurse = `"${userName}'s Burden"`;
    curseTagline = `Fantasy football wasn't meant to be this hard\n` +
                   `• Overall record: ${curseData.totalWins}-${curseData.totalLosses}\n` +
                   `• Most common loss margin: ${findMostCommonLossMargin(curseData)} points`;
  }
  
  embed.addFields({
    name: `🔥 THE ULTIMATE CURSE`,
    value: `**${ultimateCurse}**\n${curseTagline}`,
    inline: false
  });
  
  return embed;
}

/**
 * Helper function to find most common loss margin
 */
function findMostCommonLossMargin(curseData) {
  const margins = {};
  curseData.closeGames.forEach(game => {
    if (!game.won) {
      const marginBucket = Math.floor(game.margin / 5) * 5;
      margins[marginBucket] = (margins[marginBucket] || 0) + 1;
    }
  });
  
  const mostCommon = Object.entries(margins)
    .sort(([,a], [,b]) => b - a)[0];
  
  return mostCommon ? `${mostCommon[0]}-${parseInt(mostCommon[0]) + 5}` : "5-10";
}