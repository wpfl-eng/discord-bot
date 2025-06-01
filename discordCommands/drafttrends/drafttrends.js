import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sql } from "@vercel/postgres";
import { 
  DRAFT_CONSTANTS, 
  truncateFieldValue, 
  validateSeasonRange,
  getDraftArchetype
} from "../../helpers/draftTrendsUtils.js";

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
      .setDescription(`Minimum season year (default: ${DRAFT_CONSTANTS.MIN_SEASON})`)
      .setRequired(false)
      .setMinValue(DRAFT_CONSTANTS.MIN_SEASON)
      .setMaxValue(DRAFT_CONSTANTS.MAX_SEASON)
  )
  .addIntegerOption((option) =>
    option
      .setName("seasonmax")
      .setDescription(`Maximum season year (default: ${DRAFT_CONSTANTS.MAX_SEASON})`)
      .setRequired(false)
      .setMinValue(DRAFT_CONSTANTS.MIN_SEASON)
      .setMaxValue(DRAFT_CONSTANTS.MAX_SEASON)
  );

/**
 * Executes the draft trends command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - Discord interaction
 */
export async function execute(interaction) {
  // Defer IMMEDIATELY - we have 3 seconds to acknowledge
  try {
    await interaction.deferReply();
  } catch (error) {
    console.error("[DRAFTTRENDS] Failed to defer reply:", error);
    return;
  }
  
  const timestamp = new Date().toISOString();
  console.log(`[DRAFTTRENDS ${timestamp}] Command started and deferred`);

  try {
    const userName = interaction.options.getString("user");
    const inputSeasonMin = interaction.options.getInteger("seasonmin");
    const inputSeasonMax = interaction.options.getInteger("seasonmax");
    
    const { seasonMin, seasonMax } = validateSeasonRange(inputSeasonMin, inputSeasonMax);
    console.log(`[DRAFTTRENDS] User: ${userName}, Season: ${seasonMin}-${seasonMax}`);
    
    // First, check if we have precomputed data for this range
    let statsResult;
    try {
      console.log("[DRAFTTRENDS] Querying database for precomputed stats...");
      statsResult = await sql`
        SELECT * FROM owner_draft_stats 
        WHERE LOWER(owner) = LOWER(${userName})
        AND season_min = ${seasonMin}
        AND season_max = ${seasonMax}
        ORDER BY computed_at DESC
        LIMIT 1`;
      console.log(`[DRAFTTRENDS] Query returned ${statsResult.rows.length} rows`);
    } catch (dbError) {
      console.error("[DRAFTTRENDS] Database query error:", dbError);
      await interaction.editReply("Database connection error. Please try again later.");
      return;
    }
    
    if (statsResult.rows.length === 0) {
      console.log("[DRAFTTRENDS] No data for specific range, checking full range...");
      // Check if we have data for the full range as a fallback
      let fullRangeResult;
      try {
        console.log("[DRAFTTRENDS] Querying for full range (2010-2024)...");
        fullRangeResult = await sql`
          SELECT * FROM owner_draft_stats 
          WHERE LOWER(owner) = LOWER(${userName})
          AND season_min = 2010
          AND season_max = 2024
          ORDER BY computed_at DESC
          LIMIT 1`;
        console.log(`[DRAFTTRENDS] Full range query returned ${fullRangeResult.rows.length} rows`);
      } catch (dbError) {
        console.error("[DRAFTTRENDS] Database query error (full range):", dbError);
        await interaction.editReply("Database connection error. Please try again later.");
        return;
      }
      
      if (fullRangeResult.rows.length === 0) {
        console.log("[DRAFTTRENDS] No data found for user, getting owner list for suggestions...");
        // Try to find similar names for suggestions
        let ownersResult;
        try {
          console.log("[DRAFTTRENDS] Querying all owners...");
          ownersResult = await sql`
            SELECT DISTINCT owner FROM owner_draft_stats
            ORDER BY owner`;
          console.log(`[DRAFTTRENDS] Found ${ownersResult.rows.length} total owners`);
        } catch (dbError) {
          console.error("[DRAFTTRENDS] Database query error (owners):", dbError);
          await interaction.editReply("Database connection error. Please try again later.");
          return;
        }
        
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
        
        console.log("[DRAFTTRENDS] Sending no data found message...");
        await interaction.editReply(replyMsg);
        console.log("[DRAFTTRENDS] Message sent, returning");
        return;
      }
      
      // Use full range data but note it in the response
      statsResult.rows = fullRangeResult.rows;
    }
    
    const stats = statsResult.rows[0];
    console.log("[DRAFTTRENDS] Got stats for:", stats.owner);
    console.log("[DRAFTTRENDS] Stats object keys:", Object.keys(stats));
    
    // Parse the JSON stats
    if (stats.stats_json) {
      console.log("[DRAFTTRENDS] Parsing JSON stats...");
      try {
        stats.complexStats = JSON.parse(stats.stats_json);
        console.log("[DRAFTTRENDS] JSON parsed successfully");
      } catch (parseError) {
        console.error("[DRAFTTRENDS] Failed to parse JSON:", parseError);
        stats.complexStats = {};
      }
    } else {
      console.log("[DRAFTTRENDS] No JSON stats found");
    }
    
    // Format and send the response with enhanced embed
    let embeds;
    try {
      console.log("[DRAFTTRENDS] Creating enhanced embed...");
      embeds = createEnhancedDraftTrendsEmbed(stats);
      console.log(`[DRAFTTRENDS] Created ${embeds.length} embeds`);
    } catch (embedError) {
      console.error("[DRAFTTRENDS] Error creating embed:", embedError);
      console.error("[DRAFTTRENDS] Stack trace:", embedError.stack);
      // Fall back to simple response
      await interaction.editReply(`Draft analysis for **${stats.owner}**: ${stats.total_picks} total picks (${stats.snake_picks} snake, ${stats.auction_picks} auction)`);
      return;
    }
    
    console.log("[DRAFTTRENDS] Sending embed response...");
    
    // Validate embeds before sending
    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
      console.log(`[DRAFTTRENDS] Embed ${i + 1}: ${embed.data.fields?.length || 0} fields`);
      
      // Check field sizes
      if (embed.data.fields) {
        embed.data.fields.forEach((field, idx) => {
          if (field.value.length > 1024) {
            console.warn(`[DRAFTTRENDS] Field ${idx} "${field.name}" too long: ${field.value.length} chars`);
          }
        });
      }
      
      // Check description size
      if (embed.data.description && embed.data.description.length > 4096) {
        console.warn(`[DRAFTTRENDS] Description too long: ${embed.data.description.length} chars`);
      }
    }
    
    try {
      await interaction.editReply({ embeds: embeds });
      console.log("[DRAFTTRENDS] Response sent successfully!");
    } catch (sendError) {
      console.error("[DRAFTTRENDS] Error sending embeds:", sendError);
      console.error("[DRAFTTRENDS] Error details:", sendError.message);
      
      // Try sending a simple fallback message
      try {
        await interaction.editReply(`Draft analysis for **${stats.owner}**: ${stats.total_picks} total picks (${stats.snake_picks} snake, ${stats.auction_picks} auction)`);
        console.log("[DRAFTTRENDS] Sent fallback message");
      } catch (fallbackError) {
        console.error("[DRAFTTRENDS] Fallback also failed:", fallbackError);
      }
      
      throw sendError;
    }
    
  } catch (error) {
    console.error("[DRAFTTRENDS] Error in command:", error);
    console.error("[DRAFTTRENDS] Stack trace:", error.stack);
    try {
      await interaction.editReply("An error occurred while analyzing draft trends. Make sure the precomputation script has been run: `node precompute-draft-trends.js`");
    } catch (replyError) {
      console.error("[DRAFTTRENDS] Failed to send error message:", replyError);
    }
  }
}

/**
 * Creates enhanced embed for draft trends analysis
 * @param {Object} stats - Owner draft statistics
 * @returns {Array<EmbedBuilder>} Array containing main and prediction embeds
 */
function createEnhancedDraftTrendsEmbed(stats) {
  console.log("[EMBED] Starting embed creation");
  console.log("[EMBED] Stats owner:", stats.owner);
  console.log("[EMBED] Season range:", stats.season_min, "-", stats.season_max);
  
  const seasonRange = stats.season_min === stats.season_max 
    ? `(${stats.season_min})` 
    : `(${stats.season_min}-${stats.season_max})`;
    
  const mainEmbed = new EmbedBuilder()
    .setTitle(`🎯 ${stats.owner}'s Draft DNA ${seasonRange}`)
    .setColor(0xFF6B35)
    .setDescription(truncateFieldValue(generatePersonalityProfile(stats), 4096))
    .setTimestamp()
    .setFooter({ text: "WPFL Draft Intelligence™" });
  
  console.log("[EMBED] Main embed created");
  
  const complexStats = stats.complexStats || {};
  
  // Power Rankings Section
  const powerMetrics = calculatePowerMetrics(stats, complexStats);
  mainEmbed.addFields({
    name: "⚡ Power Metrics",
    value: truncateFieldValue([
      `**Draft IQ**: ${powerMetrics.draftIQ}/100`,
      `**Consistency**: ${complexStats.draftTrends?.consistency || 'N/A'}/100`,
      `**Risk Tolerance**: ${powerMetrics.riskScore}/100`,
      `**Value Hunter**: ${complexStats.draftTrends?.valueHunting || 0}/100`
    ].join("\n")),
    inline: true
  });
  
  // Signature Moves
  const signatureMoves = getSignatureMoves(stats, complexStats);
  if (signatureMoves.length > 0) {
    mainEmbed.addFields({
      name: "🎨 Signature Moves",
      value: truncateFieldValue(signatureMoves.map(move => `• ${move}`).join("\n")),
      inline: true
    });
  }
  
  // Elite Stats (Things they're top 3 in)
  const eliteStats = getEliteStats(stats, complexStats);
  if (eliteStats.length > 0) {
    mainEmbed.addFields({
      name: "🏆 Elite Traits",
      value: truncateFieldValue(eliteStats.map(stat => `• ${stat}`).join("\n")),
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
    
    mainEmbed.addFields({
      name: "🧬 Team DNA",
      value: truncateFieldValue(teamDNA),
      inline: true
    });
  }
  
  // Position Architecture
  const positionArchitecture = getPositionArchitecture(complexStats);
  if (positionArchitecture) {
    mainEmbed.addFields({
      name: "🏗️ Draft Architecture",
      value: truncateFieldValue(positionArchitecture),
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
    
    mainEmbed.addFields({
      name: "💝 Ride or Die Players",
      value: truncateFieldValue(loyaltyStars),
      inline: false
    });
  }
  
  // Create second embed for predictions
  const predictionEmbed = new EmbedBuilder()
    .setTitle(`🔮 2025 Draft Predictions for ${stats.owner}`)
    .setColor(0x9D4EDD)
    .setFooter({ text: "Powered by WPFL Predictive Analytics" });
  
  // Bold Predictions
  const predictions = generateBoldPredictions(stats, complexStats);
  predictionEmbed.addFields({
    name: "🎯 Bold Predictions",
    value: truncateFieldValue(predictions.map((pred, idx) => `**${idx + 1}.** ${pred}`).join("\n\n")),
    inline: false
  });
  
  // Sleeper Alerts
  const sleeperAlerts = generateSleeperAlerts(stats, complexStats);
  if (sleeperAlerts.length > 0) {
    predictionEmbed.addFields({
      name: "😴 Sleeper Alerts",
      value: truncateFieldValue(sleeperAlerts.join("\n")),
      inline: false
    });
  }
  
  // Strategic Recommendations
  const recommendations = generateStrategicRecommendations(stats, complexStats);
  predictionEmbed.addFields({
    name: "📊 Strategic Edge",
    value: truncateFieldValue(recommendations.join("\n")),
    inline: false
  });
  
  console.log("[EMBED] Returning embeds array");
  return [mainEmbed, predictionEmbed];
}

/**
 * Generates a personality profile for a draft analyst
 * @param {Object} stats - Owner statistics
 * @returns {string} Formatted personality profile
 */
function generatePersonalityProfile(stats) {
  const profiles = [];
  
  // Get primary archetype
  profiles.push(getDraftArchetype(stats));
  
  // Add flavor text
  const totalYears = stats.season_max - stats.season_min + 1;
  profiles.push(`*${totalYears} years of draft dominance analyzed*`);
  
  return profiles.join("\n");
}

/**
 * Calculates power metrics for draft analysis
 * @param {Object} stats - Basic owner statistics
 * @param {Object} complexStats - Complex statistics object
 * @returns {Object} Power metrics including draftIQ and riskScore
 */
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

/**
 * Generates bold predictions for future drafts
 * @param {Object} stats - Owner statistics
 * @param {Object} complexStats - Complex statistics object
 * @returns {Array<string>} Array of prediction strings
 */
function generateBoldPredictions(stats, complexStats) {
  console.log("[PREDICTIONS] Generating predictions...");
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
  
  console.log(`[PREDICTIONS] Generated ${predictions.length} predictions`);
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