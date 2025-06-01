import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

export const data = new SlashCommandBuilder()
  .setName("drafttrends")
  .setDescription("Analyze draft patterns and tendencies for league members")
  .addStringOption((option) =>
    option
      .setName("user")
      .setDescription("Manager name to analyze")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmin")
      .setDescription("Minimum season year (default: 2010)")
      .setRequired(false)
      .setMinValue(2010)
      .setMaxValue(2024)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmax")
      .setDescription("Maximum season year (default: 2024)")
      .setRequired(false)
      .setMinValue(2010)
      .setMaxValue(2024)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  try {
    const userName = interaction.options.getString("user");
    let seasonMin = interaction.options.getInteger("seasonmin");
    let seasonMax = interaction.options.getInteger("seasonmax");
    
    // Handle edge cases and defaults
    if (!seasonMin && !seasonMax) {
      // Both empty: use full range
      seasonMin = 2010;
      seasonMax = 2024;
    } else if (seasonMin && !seasonMax) {
      // Only min provided: use min to 2024
      seasonMax = 2024;
    } else if (!seasonMin && seasonMax) {
      // Only max provided: use 2010 to max
      seasonMin = 2010;
    }
    
    // Swap if user put them backwards
    if (seasonMin > seasonMax) {
      [seasonMin, seasonMax] = [seasonMax, seasonMin];
    }
    
    // Build API URL with parameters
    let apiUrl = "https://wpflapi.azurewebsites.net/api/draft/history?";
    const params = new URLSearchParams();
    params.append("seasonMin", seasonMin.toString());
    params.append("seasonMax", seasonMax.toString());
    
    apiUrl += params.toString();
    
    // Fetch draft history
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const draftData = await response.json();
    
    // Fetch player scores (only available from 2015+) to calculate actual value
    let playerScores = {};
    if (seasonMax >= 2015) {
      // Only fetch scores for years where data is available (2015+)
      const scoresMinYear = Math.max(seasonMin, 2015);
      const scoresUrl = `https://wpflapi.azurewebsites.net/api/playerscores?seasonMin=${scoresMinYear}&seasonMax=${seasonMax}`;
      const scoresResponse = await fetch(scoresUrl);
      if (scoresResponse.ok) {
        const scoresData = await scoresResponse.json();
        
        // Aggregate total points by player and season
        scoresData.forEach(score => {
          const key = `${score.player}_${score.season}`;
          if (!playerScores[key]) {
            playerScores[key] = {
              player: score.player,
              season: score.season,
              totalPoints: 0,
              gamesPlayed: 0
            };
          }
          playerScores[key].totalPoints += score.points;
          playerScores[key].gamesPlayed++;
        });
      }
    }
    
    // Filter by user name (exact match, case-insensitive)
    const filteredData = draftData.filter(pick => 
      pick.owner.toLowerCase() === userName.toLowerCase()
    );
    
    if (filteredData.length === 0) {
      // Try to find similar names for suggestions
      const allOwners = [...new Set(draftData.map(pick => pick.owner))];
      const suggestions = allOwners
        .filter(owner => 
          owner.toLowerCase().includes(userName.toLowerCase()) || 
          userName.toLowerCase().includes(owner.toLowerCase())
        )
        .slice(0, 3);
      
      let replyMsg = `No draft data found for "${userName}"`;
      if (suggestions.length > 0) {
        replyMsg += `\n\nDid you mean: ${suggestions.map(s => `**${s}**`).join(", ")}?`;
      }
      
      await interaction.editReply(replyMsg);
      return;
    }
    
    // Analyze the data
    const analysis = analyzeDraftTrends(filteredData, playerScores);
    
    // Format and send the response
    const embed = createDraftTrendsEmbed(analysis, userName, seasonMin, seasonMax);
    await interaction.editReply({ embeds: [embed] });
    
  } catch (error) {
    console.error("Error in drafttrends command:", error);
    await interaction.editReply("An error occurred while analyzing draft trends.");
  }
}

function analyzeDraftTrends(draftData, playerScores) {
  const ownerStats = {};
  
  // Group by owner
  draftData.forEach(pick => {
    if (!ownerStats[pick.owner]) {
      ownerStats[pick.owner] = {
        picks: [],
        teamFrequency: {},
        positionFrequency: {},
        positionByRound: {},
        playerFrequency: {},
        seasonBreakdown: {},
        auctionStats: {
          totalSpent: 0,
          avgValue: 0,
          maxBid: 0,
          minBid: Infinity,
          valueByPosition: {},
          bargains: [],
          overpays: [],
          positionROI: {},
          overallROI: 0,
          bustRate: 0,
          hitRate: 0
        },
        snakeDraftPicks: 0,
        auctionDraftPicks: 0,
        totalPicks: 0,
        averagePosition: 0,
        earliestPick: Infinity,
        latestPick: 0,
        draftEfficiency: {
          totalPossiblePoints: 0,
          actualPoints: 0,
          efficiencyRate: 0
        }
      };
    }
    
    const stats = ownerStats[pick.owner];
    stats.picks.push(pick);
    stats.totalPicks++;
    
    // Track NFL team frequency
    const team = pick.playerNflTeam ? pick.playerNflTeam.trim().toUpperCase() : "Unknown";
    stats.teamFrequency[team] = (stats.teamFrequency[team] || 0) + 1;
    
    // Track position frequency
    const position = pick.playerNflPosition ? pick.playerNflPosition.trim() : "Unknown";
    stats.positionFrequency[position] = (stats.positionFrequency[position] || 0) + 1;
    
    // Track player frequency
    const player = pick.player || "Unknown";
    if (!stats.playerFrequency[player]) {
      stats.playerFrequency[player] = {
        count: 0,
        seasons: [],
        positions: new Set(),
        teams: new Set()
      };
    }
    stats.playerFrequency[player].count++;
    stats.playerFrequency[player].seasons.push(pick.season);
    if (position !== "Unknown") stats.playerFrequency[player].positions.add(position);
    if (team !== "Unknown") stats.playerFrequency[player].teams.add(team);
    
    // Track season breakdown
    const season = pick.season || "Unknown";
    if (!stats.seasonBreakdown[season]) {
      stats.seasonBreakdown[season] = {
        picks: 0,
        avgPosition: 0,
        positions: {}
      };
    }
    stats.seasonBreakdown[season].picks++;
    stats.seasonBreakdown[season].avgPosition += pick.draftPosition;
    stats.seasonBreakdown[season].positions[position] = 
      (stats.seasonBreakdown[season].positions[position] || 0) + 1;
    
    // Track position by round (1-3 early, 4-8 mid, 9+ late)
    const round = Math.ceil(pick.draftPosition / 12); // Assuming 12-team league
    const roundCategory = round <= 3 ? "early" : round <= 8 ? "mid" : "late";
    
    if (!stats.positionByRound[roundCategory]) {
      stats.positionByRound[roundCategory] = {};
    }
    stats.positionByRound[roundCategory][position] = 
      (stats.positionByRound[roundCategory][position] || 0) + 1;
    
    // Track draft position stats
    stats.averagePosition += pick.draftPosition;
    stats.earliestPick = Math.min(stats.earliestPick, pick.draftPosition);
    stats.latestPick = Math.max(stats.latestPick, pick.draftPosition);
    
    // Track auction values (2016 onwards)
    if (pick.auctionValue && pick.auctionValue > 0 && pick.season >= 2016) {
      stats.auctionDraftPicks++;
      stats.auctionStats.totalSpent += pick.auctionValue;
      stats.auctionStats.maxBid = Math.max(stats.auctionStats.maxBid, pick.auctionValue);
      stats.auctionStats.minBid = Math.min(stats.auctionStats.minBid, pick.auctionValue);
      
      // Track value by position
      if (!stats.auctionStats.valueByPosition[position]) {
        stats.auctionStats.valueByPosition[position] = {
          total: 0,
          count: 0,
          avg: 0
        };
      }
      stats.auctionStats.valueByPosition[position].total += pick.auctionValue;
      stats.auctionStats.valueByPosition[position].count++;
    } else if (pick.season < 2016 || !pick.auctionValue) {
      stats.snakeDraftPicks++;
    }
  });
  
  // Calculate averages and find patterns
  Object.keys(ownerStats).forEach(owner => {
    const stats = ownerStats[owner];
    stats.averagePosition = stats.averagePosition / stats.totalPicks;
    
    // Find top 3 teams
    stats.topTeams = Object.entries(stats.teamFrequency)
      .filter(([team]) => team !== "Unknown")
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);
    
    // Legacy: keep favoriteTeam for compatibility
    stats.favoriteTeam = stats.topTeams[0];
    
    // Find favorite position
    stats.favoritePosition = Object.entries(stats.positionFrequency)
      .filter(([pos]) => pos !== "Unknown")
      .sort(([,a], [,b]) => b - a)[0];
    
    // Find repeat players (drafted 2+ times)
    stats.repeatPlayers = Object.entries(stats.playerFrequency)
      .filter(([player, data]) => data.count >= 2 && player !== "Unknown")
      .sort(([,a], [,b]) => b.count - a.count)
      .map(([player, data]) => ({
        player,
        count: data.count,
        seasons: data.seasons.sort(),
        positions: Array.from(data.positions),
        teams: Array.from(data.teams)
      }));
    
    // Calculate season averages
    Object.keys(stats.seasonBreakdown).forEach(season => {
      const seasonData = stats.seasonBreakdown[season];
      seasonData.avgPosition = seasonData.avgPosition / seasonData.picks;
    });
    
    // Calculate auction averages and find bargains/overpays based on actual performance
    if (stats.auctionStats.totalSpent > 0) {
      const auctionPicks = stats.picks.filter(p => p.auctionValue && p.auctionValue > 0);
      stats.auctionStats.avgValue = stats.auctionStats.totalSpent / auctionPicks.length;
      
      // Note: Performance data only available from 2015+
      // For 2010-2014, we'll show draft data without performance metrics
      
      // Calculate value based on actual performance
      const performanceValues = [];
      
      auctionPicks.forEach(pick => {
        // Only calculate performance for years where data exists (2015+)
        if (pick.season >= 2015) {
          const playerKey = `${pick.player}_${pick.season}`;
          const performance = playerScores[playerKey];
          
          if (performance && performance.totalPoints > 0) {
            const pointsPerDollar = performance.totalPoints / pick.auctionValue;
            performanceValues.push({
              pick: pick,
              totalPoints: performance.totalPoints,
              gamesPlayed: performance.gamesPlayed,
              pointsPerDollar: pointsPerDollar,
              pointsPerGame: performance.totalPoints / performance.gamesPlayed
            });
          }
        }
      });
      
      // Calculate league average points per dollar for the seasons in question
      if (performanceValues.length > 0) {
        const avgPointsPerDollar = performanceValues.reduce((sum, pv) => sum + pv.pointsPerDollar, 0) / performanceValues.length;
        
        // Calculate ROI by position
        const positionGroups = {};
        performanceValues.forEach(pv => {
          const pos = pv.pick.playerNflPosition?.trim() || "Unknown";
          if (!positionGroups[pos]) {
            positionGroups[pos] = [];
          }
          positionGroups[pos].push(pv);
        });
        
        // Calculate position-specific ROI
        Object.entries(positionGroups).forEach(([pos, players]) => {
          const totalSpent = players.reduce((sum, p) => sum + p.pick.auctionValue, 0);
          const totalPoints = players.reduce((sum, p) => sum + p.totalPoints, 0);
          const avgPointsPerDollar = totalPoints / totalSpent;
          
          stats.auctionStats.positionROI[pos] = {
            totalSpent: totalSpent,
            totalPoints: totalPoints.toFixed(1),
            pointsPerDollar: avgPointsPerDollar.toFixed(2),
            playerCount: players.length,
            efficiency: ((avgPointsPerDollar / avgPointsPerDollar) * 100).toFixed(1)
          };
        });
        
        // Calculate overall ROI
        const totalInvestment = performanceValues.reduce((sum, pv) => sum + pv.pick.auctionValue, 0);
        const totalReturn = performanceValues.reduce((sum, pv) => sum + pv.totalPoints, 0);
        stats.auctionStats.overallROI = (totalReturn / totalInvestment).toFixed(2);
        
        // Calculate bust rate (players who returned < 50 points per $10 spent)
        const busts = performanceValues.filter(pv => pv.totalPoints < (pv.pick.auctionValue * 5));
        stats.auctionStats.bustRate = ((busts.length / performanceValues.length) * 100).toFixed(1);
        
        // Calculate hit rate (players who exceeded expected value)
        const hits = performanceValues.filter(pv => pv.pointsPerDollar > avgPointsPerDollar);
        stats.auctionStats.hitRate = ((hits.length / performanceValues.length) * 100).toFixed(1);
        
        // Find bargains (great value: > 150% of average points per dollar)
        stats.auctionStats.bargains = performanceValues
          .filter(pv => pv.pointsPerDollar > avgPointsPerDollar * 1.5)
          .map(pv => ({
            player: pv.pick.player,
            value: pv.pick.auctionValue,
            position: pv.pick.playerNflPosition?.trim() || "Unknown",
            season: pv.pick.season,
            totalPoints: pv.totalPoints.toFixed(1),
            pointsPerDollar: pv.pointsPerDollar.toFixed(2),
            valueRating: ((pv.pointsPerDollar / avgPointsPerDollar - 1) * 100).toFixed(0)
          }))
          .sort((a, b) => b.pointsPerDollar - a.pointsPerDollar);
        
        // Find overpays (poor value: < 70% of average points per dollar)
        stats.auctionStats.overpays = performanceValues
          .filter(pv => pv.pointsPerDollar < avgPointsPerDollar * 0.7)
          .map(pv => ({
            player: pv.pick.player,
            value: pv.pick.auctionValue,
            position: pv.pick.playerNflPosition?.trim() || "Unknown",
            season: pv.pick.season,
            totalPoints: pv.totalPoints.toFixed(1),
            pointsPerDollar: pv.pointsPerDollar.toFixed(2),
            valueRating: ((1 - pv.pointsPerDollar / avgPointsPerDollar) * 100).toFixed(0)
          }))
          .sort((a, b) => a.pointsPerDollar - b.pointsPerDollar);
          
        // Track spending efficiency over time
        const yearlyEfficiency = {};
        performanceValues.forEach(pv => {
          if (!yearlyEfficiency[pv.pick.season]) {
            yearlyEfficiency[pv.pick.season] = {
              totalSpent: 0,
              totalPoints: 0,
              picks: 0
            };
          }
          yearlyEfficiency[pv.pick.season].totalSpent += pv.pick.auctionValue;
          yearlyEfficiency[pv.pick.season].totalPoints += pv.totalPoints;
          yearlyEfficiency[pv.pick.season].picks++;
        });
        
        stats.yearlyEfficiency = Object.entries(yearlyEfficiency).map(([year, data]) => ({
          year,
          pointsPerDollar: (data.totalPoints / data.totalSpent).toFixed(2),
          avgSpend: (data.totalSpent / data.picks).toFixed(0)
        })).sort((a, b) => a.year - b.year);
      }
    }
    
    // Calculate different metrics based on draft type
    if (stats.auctionDraftPicks > 0) {
      // Calculate percentage of budget on top players (>$40)
      const bigSpends = stats.picks.filter(p => p.auctionValue && p.auctionValue > 40 && p.season >= 2016).length;
      stats.starsAndScrubsPercentage = (bigSpends / stats.auctionDraftPicks) * 100;
      
      // Calculate budget allocation by position
      stats.budgetAllocation = {};
      Object.entries(stats.auctionStats.valueByPosition).forEach(([pos, data]) => {
        stats.budgetAllocation[pos] = ((data.total / stats.auctionStats.totalSpent) * 100).toFixed(1);
      });
    }
    
    if (stats.snakeDraftPicks > 0) {
      // Calculate reach percentage for snake draft picks only
      const snakePicks = stats.picks.filter(p => p.season < 2016 || !p.auctionValue);
      stats.reachPercentage = (snakePicks.filter(p => p.draftPosition <= 24).length / stats.snakeDraftPicks) * 100;
    }
  });
  
  return ownerStats;
}

function createDraftTrendsEmbed(analysis, userName, seasonMin, seasonMax) {
  const seasonRange = seasonMin === seasonMax 
    ? `(${seasonMin})` 
    : `(${seasonMin}-${seasonMax})`;
    
  const embed = {
    title: `📊 Draft Trends Analysis ${seasonRange}`,
    color: 0x0099ff,
    fields: [],
    timestamp: new Date(),
    footer: {
      text: "Data from WPFL API"
    }
  };
  
  // Since we're always analyzing a specific user now
  const owner = Object.keys(analysis)[0];
  const stats = analysis[owner];
  
  let draftTypeBreakdown = [];
  if (stats.snakeDraftPicks > 0) {
    draftTypeBreakdown.push(`${stats.snakeDraftPicks} snake`);
  }
  if (stats.auctionDraftPicks > 0) {
    draftTypeBreakdown.push(`${stats.auctionDraftPicks} auction`);
  }
  
  embed.description = `Analysis for **${owner}** (${stats.totalPicks} total picks: ${draftTypeBreakdown.join(", ")})`;
  
  // Add note if analyzing years without performance data
  if (seasonMin < 2015) {
    embed.description += `\n⚠️ *Performance metrics only available for 2015+*`;
  }
  
  // Team preferences - show top 3
  if (stats.topTeams && stats.topTeams.length > 0) {
    const teamList = stats.topTeams
      .map(([team, count]) => {
        const percentage = ((count / stats.totalPicks) * 100).toFixed(1);
        return `**${team}** (${count} picks, ${percentage}%)`;
      })
      .join("\n");
    
    embed.fields.push({
      name: "🏈 Top NFL Teams",
      value: teamList,
      inline: true
    });
  }
  
  // Position preferences
  if (stats.favoritePosition) {
    const posPicks = stats.favoritePosition[1];
    const posPercentage = ((posPicks / stats.totalPicks) * 100).toFixed(1);
    embed.fields.push({
      name: "📍 Favorite Position",
      value: `**${stats.favoritePosition[0]}** (${posPicks} picks, ${posPercentage}%)`,
      inline: true
    });
  }
  
  // Show relevant stats based on draft types present
  if (stats.snakeDraftPicks > 0) {
    // Calculate snake-only average position
    const snakePicks = stats.picks.filter(p => p.season < 2016 || !p.auctionValue);
    const snakeAvgPos = snakePicks.reduce((sum, p) => sum + p.draftPosition, 0) / snakePicks.length;
    
    embed.fields.push({
      name: "🐍 Snake Draft Stats",
      value: `Picks: **${stats.snakeDraftPicks}** (2010-2015)\nAvg Position: **${snakeAvgPos.toFixed(1)}**`,
      inline: true
    });
  }
  
  if (stats.auctionDraftPicks > 0) {
    embed.fields.push({
      name: "💰 Auction Stats",
      value: `Picks: **${stats.auctionDraftPicks}** (2016+)\nTotal Spent: **$${stats.auctionStats.totalSpent}**\nAvg Value: **$${stats.auctionStats.avgValue.toFixed(1)}**`,
      inline: true
    });
    
    // ROI and Success Metrics
    if (stats.auctionStats.overallROI) {
      embed.fields.push({
        name: "📈 Draft Performance",
        value: `ROI: **${stats.auctionStats.overallROI} pts/$**\nHit Rate: **${stats.auctionStats.hitRate}%**\nBust Rate: **${stats.auctionStats.bustRate}%**`,
        inline: true
      });
    }
    
    // Position ROI Analysis
    if (Object.keys(stats.auctionStats.positionROI).length > 0) {
      const positionROIList = Object.entries(stats.auctionStats.positionROI)
        .sort(([,a], [,b]) => parseFloat(b.pointsPerDollar) - parseFloat(a.pointsPerDollar))
        .slice(0, 3)
        .map(([pos, data]) => `${pos}: ${data.pointsPerDollar} pts/$ ($${data.totalSpent})`)
        .join("\n");
        
      embed.fields.push({
        name: "💎 Best Position Values",
        value: positionROIList,
        inline: true
      });
    }
  }
  
  // Position by round breakdown
  let roundBreakdown = "";
  if (stats.positionByRound.early) {
    const earlyPositions = Object.entries(stats.positionByRound.early)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([pos, count]) => `${pos} (${count})`)
      .join(", ");
    roundBreakdown += `**Early rounds (1-3):** ${earlyPositions}\n`;
  }
  if (stats.positionByRound.mid) {
    const midPositions = Object.entries(stats.positionByRound.mid)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([pos, count]) => `${pos} (${count})`)
      .join(", ");
    roundBreakdown += `**Mid rounds (4-8):** ${midPositions}\n`;
  }
  if (stats.positionByRound.late) {
    const latePositions = Object.entries(stats.positionByRound.late)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([pos, count]) => `${pos} (${count})`)
      .join(", ");
    roundBreakdown += `**Late rounds (9+):** ${latePositions}`;
  }
  
  if (roundBreakdown) {
    embed.fields.push({
      name: "🎯 Position Preferences by Round",
      value: roundBreakdown,
      inline: false
    });
  }
  
  // Show repeat players
  if (stats.repeatPlayers && stats.repeatPlayers.length > 0) {
    const repeatList = stats.repeatPlayers
      .slice(0, 5) // Show top 5
      .map(p => {
        const years = p.seasons.join(", ");
        return `**${p.player}** - ${p.count}x (${years})`;
      })
      .join("\n");
    
    embed.fields.push({
      name: "🔄 Repeat Picks",
      value: repeatList,
      inline: false
    });
  }
  
  // Show efficiency trend over years
  if (stats.yearlyEfficiency && stats.yearlyEfficiency.length > 1) {
    const trendList = stats.yearlyEfficiency
      .map(y => `**${y.year}**: ${y.pointsPerDollar} pts/$ (avg $${y.avgSpend})`)
      .join("\n");
      
    embed.fields.push({
      name: "📊 Efficiency Trend",
      value: trendList,
      inline: false
    });
  }
  
  // Show bargains and overpays for auction drafts
  if (stats.auctionStats.bargains && stats.auctionStats.bargains.length > 0) {
    const bargainList = stats.auctionStats.bargains
      .slice(0, 3)
      .map(b => `**${b.player}** (${b.season})\n$${b.value} → ${b.totalPoints}pts\n${b.pointsPerDollar} pts/$`)
      .join("\n\n");
    
    embed.fields.push({
      name: "💎 Best Value Picks",
      value: bargainList,
      inline: true
    });
  }
  
  if (stats.auctionStats.overpays && stats.auctionStats.overpays.length > 0) {
    const overpayList = stats.auctionStats.overpays
      .slice(0, 3)
      .map(o => `**${o.player}** (${o.season})\n$${o.value} → ${o.totalPoints}pts\n${o.pointsPerDollar} pts/$`)
      .join("\n\n");
    
    embed.fields.push({
      name: "💸 Worst Value Picks",
      value: overpayList,
      inline: true
    });
  }
  
  // Notable patterns
  let patterns = [];
  
  // Check for team loyalty
  if (stats.favoriteTeam && stats.favoriteTeam[1] >= 5) {
    patterns.push(`🏈 Strong ${stats.favoriteTeam[0]} bias (${stats.favoriteTeam[1]} players drafted)`);
  }
  
  // Check for extreme position preferences
  if (stats.favoritePosition && (stats.favoritePosition[1] / stats.totalPicks) > 0.3) {
    patterns.push(`📍 Heavy ${stats.favoritePosition[0]} drafter`);
  }
  
  // Check for RB-heavy early rounds
  const earlyRBs = stats.positionByRound.early?.["RB"] || 0;
  const totalEarly = Object.values(stats.positionByRound.early || {}).reduce((a, b) => a + b, 0);
  if (totalEarly > 0 && earlyRBs / totalEarly > 0.5) {
    patterns.push(`🏃 RB-first strategy (${((earlyRBs / totalEarly) * 100).toFixed(0)}% of early picks)`);
  }
  
  // Check for Zero-RB strategy
  if (totalEarly > 0 && earlyRBs / totalEarly < 0.2) {
    patterns.push(`🚫 Zero-RB tendency (only ${((earlyRBs / totalEarly) * 100).toFixed(0)}% RBs early)`);
  }
  
  // Snake draft patterns (2010-2015)
  if (stats.snakeDraftPicks > 0 && stats.reachPercentage !== undefined) {
    if (stats.reachPercentage > 40) {
      patterns.push(`🎯 Aggressive snake drafter (${stats.reachPercentage.toFixed(0)}% picks in top 2 rounds)`);
    } else if (stats.reachPercentage < 20) {
      patterns.push(`⏳ Patient snake drafter (only ${stats.reachPercentage.toFixed(0)}% picks in top 2 rounds)`);
    }
  }
  
  // Auction patterns (2016+)
  if (stats.auctionDraftPicks > 0) {
    // Stars and scrubs vs balanced
    if (stats.starsAndScrubsPercentage > 30) {
      patterns.push(`⭐ Stars & Scrubs auction strategy (${stats.starsAndScrubsPercentage.toFixed(0)}% on $40+ players)`);
    } else if (stats.starsAndScrubsPercentage < 15) {
      patterns.push(`⚖️ Balanced auction approach`);
    }
    
    // Check for position-heavy spending
    const topSpendPos = Object.entries(stats.budgetAllocation || {})
      .sort(([,a], [,b]) => parseFloat(b) - parseFloat(a))[0];
    if (topSpendPos && parseFloat(topSpendPos[1]) > 40) {
      patterns.push(`💰 ${topSpendPos[0]}-heavy spender (${topSpendPos[1]}% of budget)`);
    }
    
    // Value hunter
    if (stats.auctionStats.bargains.length >= 5) {
      patterns.push(`🔍 Bargain hunter (${stats.auctionStats.bargains.length} steals in auctions)`);
    }
  }
  
  // Check for loyalty to specific players
  const mostDraftedPlayer = stats.repeatPlayers?.[0];
  if (mostDraftedPlayer && mostDraftedPlayer.count >= 3) {
    patterns.push(`❤️ Loyal to **${mostDraftedPlayer.player}** (${mostDraftedPlayer.count}x)`);
  }
  
  // Check for position streaming (late QB/TE)
  const lateQBs = stats.positionByRound.late?.["QB"] || 0;
  const lateTEs = stats.positionByRound.late?.["TE"] || 0;
  const totalLate = Object.values(stats.positionByRound.late || {}).reduce((a, b) => a + b, 0);
  if (totalLate > 0 && (lateQBs + lateTEs) / totalLate > 0.4) {
    patterns.push(`📊 Streaming strategy (waits on QB/TE)`);
  }
  
  if (patterns.length > 0) {
    embed.fields.push({
      name: "🔍 Notable Patterns",
      value: patterns.join("\n"),
      inline: false
    });
  }
  
  return embed;
}