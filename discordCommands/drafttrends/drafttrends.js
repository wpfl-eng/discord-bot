import { SlashCommandBuilder } from "discord.js";
import { sql } from "@vercel/postgres";

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
    
    // First, check if we have precomputed data for this range
    const statsResult = await sql`
      SELECT * FROM owner_draft_stats 
      WHERE LOWER(owner) = LOWER(${userName})
      AND season_min = ${seasonMin}
      AND season_max = ${seasonMax}
      ORDER BY computed_at DESC
      LIMIT 1`;
    
    if (statsResult.rows.length === 0) {
      // Check if we have data for the full range as a fallback
      const fullRangeResult = await sql`
        SELECT * FROM owner_draft_stats 
        WHERE LOWER(owner) = LOWER(${userName})
        AND season_min = 2010
        AND season_max = 2024
        ORDER BY computed_at DESC
        LIMIT 1`;
      
      if (fullRangeResult.rows.length === 0) {
        // Try to find similar names for suggestions
        const ownersResult = await sql`
          SELECT DISTINCT owner FROM owner_draft_stats
          ORDER BY owner`;
        
        const allOwners = ownersResult.rows.map(row => row.owner);
        const lowerUserName = userName.toLowerCase();
        
        const suggestions = allOwners
          .filter(owner => {
            const lowerOwner = owner.toLowerCase();
            return lowerOwner.includes(lowerUserName) || 
                   lowerUserName.includes(lowerOwner) ||
                   lowerOwner.split(' ').some(part => lowerUserName.includes(part)) ||
                   lowerUserName.split(' ').some(part => lowerOwner.includes(part));
          })
          .slice(0, 5);
        
        let replyMsg = `No precomputed data found for "${userName}".\n\n**To use this command:**\n1. Run the precomputation script: \`node precompute-draft-trends.js ${seasonMin} ${seasonMax}\`\n2. Then try this command again`;
        
        if (suggestions.length > 0) {
          replyMsg += `\n\n**Did you mean one of these?**\n${suggestions.map(s => `• ${s}`).join("\n")}`;
        }
        
        await interaction.editReply(replyMsg);
        return;
      }
      
      // Use full range data but note it in the response
      await interaction.editReply(`No precomputed data for ${seasonMin}-${seasonMax}. Using cached data for 2010-2024...`);
      statsResult.rows = fullRangeResult.rows;
    }
    
    const stats = statsResult.rows[0];
    
    // Parse the JSON stats
    if (stats.stats_json) {
      stats.complexStats = JSON.parse(stats.stats_json);
    }
    
    // Format and send the response with enhanced embed
    const embeds = createEnhancedDraftTrendsEmbed(stats);
    await interaction.editReply({ embeds: embeds });
    
  } catch (error) {
    console.error("Error in drafttrends command:", error);
    await interaction.editReply("An error occurred while analyzing draft trends. Make sure the precomputation script has been run: `node precompute-draft-trends.js`");
  }
}

function createEnhancedDraftTrendsEmbed(stats) {
  const seasonRange = stats.season_min === stats.season_max 
    ? `(${stats.season_min})` 
    : `(${stats.season_min}-${stats.season_max})`;
    
  const mainEmbed = {
    title: `🎯 ${stats.owner}'s Draft DNA ${seasonRange}`,
    color: 0xFF6B35,
    description: generatePersonalityProfile(stats),
    fields: [],
    timestamp: new Date(),
    footer: {
      text: "WPFL Draft Intelligence™"
    }
  };
  
  const complexStats = stats.complexStats || {};
  
  // Power Rankings Section
  const powerMetrics = calculatePowerMetrics(stats, complexStats);
  mainEmbed.fields.push({
    name: "⚡ Power Metrics",
    value: [
      `**Draft IQ**: ${powerMetrics.draftIQ}/100`,
      `**Consistency**: ${complexStats.draftTrends?.consistency || 'N/A'}/100`,
      `**Risk Tolerance**: ${powerMetrics.riskScore}/100`,
      `**Value Hunter**: ${complexStats.draftTrends?.valueHunting || 0}/100`
    ].join("\n"),
    inline: true
  });
  
  // Signature Moves
  const signatureMoves = getSignatureMoves(stats, complexStats);
  if (signatureMoves.length > 0) {
    mainEmbed.fields.push({
      name: "🎨 Signature Moves",
      value: signatureMoves.map(move => `• ${move}`).join("\n"),
      inline: true
    });
  }
  
  // Elite Stats (Things they're top 3 in)
  const eliteStats = getEliteStats(stats, complexStats);
  if (eliteStats.length > 0) {
    mainEmbed.fields.push({
      name: "🏆 Elite Traits",
      value: eliteStats.map(stat => `• ${stat}`).join("\n"),
      inline: false
    });
  }
  
  // Team DNA
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const teamDNA = complexStats.topTeams
      .slice(0, 3)
      .map((team, idx) => {
        const emoji = idx === 0 ? "👑" : idx === 1 ? "🥈" : "🥉";
        return `${emoji} **${team.team}** - ${team.count} picks (${team.percentage}%)`;
      })
      .join("\n");
    
    mainEmbed.fields.push({
      name: "🧬 Team DNA",
      value: teamDNA,
      inline: true
    });
  }
  
  // Position Architecture
  const positionArchitecture = getPositionArchitecture(complexStats);
  if (positionArchitecture) {
    mainEmbed.fields.push({
      name: "🏗️ Draft Architecture",
      value: positionArchitecture,
      inline: true
    });
  }
  
  // Loyalty Index
  if (complexStats.repeatPlayers && complexStats.repeatPlayers.length > 0) {
    const loyaltyStars = complexStats.repeatPlayers
      .slice(0, 3)
      .map(p => {
        const emoji = p.count >= 4 ? "💎" : p.count >= 3 ? "⭐" : "🌟";
        return `${emoji} **${p.player}** (${p.count}x) - ${p.seasons.join(", ")}`;
      })
      .join("\n");
    
    mainEmbed.fields.push({
      name: "💝 Ride or Die Players",
      value: loyaltyStars,
      inline: false
    });
  }
  
  // Create second embed for predictions
  const predictionEmbed = {
    title: `🔮 2025 Draft Predictions for ${stats.owner}`,
    color: 0x9D4EDD,
    fields: [],
    footer: {
      text: "Powered by WPFL Predictive Analytics"
    }
  };
  
  // Bold Predictions
  const predictions = generateBoldPredictions(stats, complexStats);
  predictionEmbed.fields.push({
    name: "🎯 Bold Predictions",
    value: predictions.map((pred, idx) => `**${idx + 1}.** ${pred}`).join("\n\n"),
    inline: false
  });
  
  // Sleeper Alerts
  const sleeperAlerts = generateSleeperAlerts(stats, complexStats);
  if (sleeperAlerts.length > 0) {
    predictionEmbed.fields.push({
      name: "😴 Sleeper Alerts",
      value: sleeperAlerts.join("\n"),
      inline: false
    });
  }
  
  // Strategic Recommendations
  const recommendations = generateStrategicRecommendations(stats, complexStats);
  predictionEmbed.fields.push({
    name: "📊 Strategic Edge",
    value: recommendations.join("\n"),
    inline: false
  });
  
  return [mainEmbed, predictionEmbed];
}

function generatePersonalityProfile(stats) {
  const profiles = [];
  const complexStats = stats.complexStats || {};
  
  // Determine primary archetype
  if (stats.auction_max_bid > 65) {
    profiles.push("**🦈 SHARK MENTALITY**");
  } else if (stats.auction_avg_value < 12) {
    profiles.push("**🦊 VALUE VULTURE**");
  } else if (complexStats.draftTrends?.consistency > 80) {
    profiles.push("**🎯 PRECISION DRAFTER**");
  } else if (complexStats.repeatPlayers?.length > 5) {
    profiles.push("**💘 LOYALTY LEGEND**");
  } else {
    profiles.push("**🎲 CHAOS AGENT**");
  }
  
  // Add flavor text
  const totalYears = stats.season_max - stats.season_min + 1;
  profiles.push(`*${totalYears} years of draft dominance analyzed*`);
  
  return profiles.join("\n");
}

function calculatePowerMetrics(stats, complexStats) {
  let draftIQ = 50; // Base score
  
  // ROI bonus
  if (stats.auction_roi) {
    const roiScore = parseFloat(stats.auction_roi);
    draftIQ += Math.min(25, roiScore * 5);
  }
  
  // Hit rate bonus
  if (stats.auction_hit_rate) {
    draftIQ += parseFloat(stats.auction_hit_rate) / 4;
  }
  
  // Risk score based on max bid and variance
  let riskScore = 0;
  if (stats.auction_max_bid > 50) {
    riskScore += (stats.auction_max_bid - 50);
  }
  if (stats.auction_avg_value > 20) {
    riskScore += 20;
  }
  riskScore = Math.min(100, riskScore * 1.5);
  
  return {
    draftIQ: Math.min(100, Math.round(draftIQ)),
    riskScore: Math.round(riskScore)
  };
}

function getSignatureMoves(stats, complexStats) {
  const moves = [];
  
  // Position-based signatures
  if (complexStats.favoritePosition?.position === "RB" && parseFloat(complexStats.favoritePosition.percentage) > 35) {
    moves.push("🏃 **RB Hammerer** - Pounds the RB position");
  } else if (complexStats.favoritePosition?.position === "WR" && parseFloat(complexStats.favoritePosition.percentage) > 40) {
    moves.push("📡 **WR Whisperer** - Elite WR talent scout");
  }
  
  // Auction signatures
  if (stats.auction_max_bid > 70) {
    moves.push(`💸 **Big Game Hunter** - Record bid: $${stats.auction_max_bid}`);
  }
  if (stats.auction_avg_value < 10 && stats.auction_picks > 10) {
    moves.push("🔍 **Bargain Bin Boss** - Master of the $1-10 range");
  }
  
  // Team loyalty signatures
  if (complexStats.topTeams?.[0]?.count >= 8) {
    moves.push(`${complexStats.topTeams[0].team} **Team Captain** - ${complexStats.topTeams[0].count} players drafted`);
  }
  
  // Round-based signatures
  const earlyRounds = complexStats.positionByRound?.early || {};
  const totalEarly = Object.values(earlyRounds).reduce((a, b) => a + b, 0);
  const earlyWRs = earlyRounds["WR"] || 0;
  const earlyRBs = earlyRounds["RB"] || 0;
  
  if (totalEarly > 0 && earlyWRs / totalEarly > 0.6) {
    moves.push("📻 **Zero-RB Zealot** - WR early and often");
  } else if (totalEarly > 0 && earlyRBs / totalEarly > 0.6) {
    moves.push("🥩 **Bellcow Believer** - RBs rule the early rounds");
  }
  
  return moves.slice(0, 4); // Limit to 4 signature moves
}

function getEliteStats(stats, complexStats) {
  const eliteTraits = [];
  
  // Check for league-leading stats
  if (stats.auction_roi && parseFloat(stats.auction_roi) > 12) {
    eliteTraits.push(`🎯 **Elite ROI**: ${stats.auction_roi} points per dollar`);
  }
  
  if (complexStats.draftTrends?.consistency > 85) {
    eliteTraits.push(`🎪 **Master of Consistency**: ${complexStats.draftTrends.consistency}/100 score`);
  }
  
  if (complexStats.repeatPlayers?.length > 7) {
    eliteTraits.push(`💕 **Loyalty King**: ${complexStats.repeatPlayers.length} repeat relationships`);
  }
  
  if (stats.auction_hit_rate && parseFloat(stats.auction_hit_rate) > 65) {
    eliteTraits.push(`🎰 **Hit Rate Hero**: ${stats.auction_hit_rate}% success rate`);
  }
  
  return eliteTraits;
}

function getPositionArchitecture(complexStats) {
  if (!complexStats.positionByRound) return null;
  
  const architecture = [];
  
  // Early round strategy
  const early = complexStats.positionByRound.early || {};
  const earlyTotal = Object.values(early).reduce((a, b) => a + b, 0);
  if (earlyTotal > 0) {
    const topEarly = Object.entries(early)
      .sort(([,a], [,b]) => b - a)[0];
    if (topEarly) {
      const percentage = ((topEarly[1] / earlyTotal) * 100).toFixed(0);
      architecture.push(`**Early**: ${topEarly[0]}-heavy (${percentage}%)`);
    }
  }
  
  // Mid round tendencies
  const mid = complexStats.positionByRound.mid || {};
  const midTotal = Object.values(mid).reduce((a, b) => a + b, 0);
  if (midTotal > 0) {
    const topMid = Object.entries(mid)
      .sort(([,a], [,b]) => b - a)[0];
    if (topMid) {
      const percentage = ((topMid[1] / midTotal) * 100).toFixed(0);
      architecture.push(`**Mid**: ${topMid[0]} focus (${percentage}%)`);
    }
  }
  
  // Late round habits
  const late = complexStats.positionByRound.late || {};
  const lateQB = late["QB"] || 0;
  const lateTE = late["TE"] || 0;
  const lateTotal = Object.values(late).reduce((a, b) => a + b, 0);
  
  if (lateTotal > 0 && (lateQB + lateTE) / lateTotal > 0.5) {
    architecture.push(`**Late**: Streaming specialist`);
  } else if (lateTotal > 0) {
    architecture.push(`**Late**: Depth builder`);
  }
  
  return architecture.join("\n");
}

function generateBoldPredictions(stats, complexStats) {
  const predictions = [];
  
  // Team-based prediction
  if (complexStats.topTeams?.[0]) {
    const team = complexStats.topTeams[0].team;
    predictions.push(`Will draft at least 2 ${team} players, including one in the first 4 rounds`);
  }
  
  // Position-based prediction
  if (complexStats.favoritePosition) {
    const pos = complexStats.favoritePosition.position;
    const percentage = parseFloat(complexStats.favoritePosition.percentage);
    if (percentage > 30) {
      predictions.push(`${pos} picks will account for ${Math.round(percentage * 1.1)}% of their draft (up from ${percentage}%)`);
    }
  }
  
  // Spending prediction for auction
  if (stats.auction_max_bid > 60) {
    predictions.push(`Will spend $${Math.round(stats.auction_max_bid * 0.9)}-${Math.round(stats.auction_max_bid * 1.1)} on their top player`);
  } else if (stats.auction_avg_value < 15) {
    predictions.push(`No player will cost more than $${Math.round(stats.auction_max_bid * 1.2)} - value hunting mode activated`);
  }
  
  // Loyalty prediction
  const topRepeat = complexStats.repeatPlayers?.[0];
  if (topRepeat && topRepeat.count >= 3) {
    predictions.push(`If available, there's a 90% chance they draft a player with the last name "${topRepeat.player.split(' ').pop()}"`);
  }
  
  // Wild card prediction based on patterns
  if (complexStats.draftTrends?.reachRate > 30) {
    predictions.push(`Will "reach" for their guy at least twice, ignoring ADP rankings`);
  } else {
    predictions.push(`Will find this year's league winner in rounds 7-10`);
  }
  
  return predictions.slice(0, 4);
}

function generateSleeperAlerts(stats, complexStats) {
  const alerts = [];
  
  // Based on favorite teams
  if (complexStats.topTeams && complexStats.topTeams.length > 0) {
    const team = complexStats.topTeams[0].team;
    alerts.push(`👀 Watch for ${team} rookies and camp standouts`);
  }
  
  // Based on value hunting score
  if (complexStats.draftTrends?.valueHunting > 60) {
    alerts.push(`💎 Specializes in late-round gems - monitor their picks after round 10`);
  }
  
  // Based on position trends
  if (complexStats.positionByRound?.late?.["WR"] > 5) {
    alerts.push(`📡 Late-round WR specialist - they know something you don't`);
  }
  
  return alerts;
}

function generateStrategicRecommendations(stats, complexStats) {
  const recommendations = [];
  
  // Exploit their tendencies
  if (complexStats.favoritePosition?.position === "RB" && parseFloat(complexStats.favoritePosition.percentage) > 35) {
    recommendations.push(`🎣 **Bait Strategy**: Let them overspend on RBs while you grab elite WRs`);
  }
  
  // Counter their strengths
  if (stats.auction_roi && parseFloat(stats.auction_roi) > 10) {
    recommendations.push(`⚔️ **Counter**: Bid up their value targets by $3-5 to disrupt their strategy`);
  }
  
  // Trading opportunities
  if (complexStats.topTeams?.[0]) {
    recommendations.push(`💰 **Trade Bait**: Stock ${complexStats.topTeams[0].team} players for future trades`);
  }
  
  // Psychological warfare
  if (complexStats.repeatPlayers?.length > 0) {
    const playerLastName = complexStats.repeatPlayers[0].player.split(' ').pop();
    recommendations.push(`🧠 **Mind Games**: Mention ${playerLastName} rumors during the draft`);
  }
  
  return recommendations.slice(0, 3);
}