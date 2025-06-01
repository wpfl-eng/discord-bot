#!/usr/bin/env node

import { sql } from "@vercel/postgres";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// Ensure we have required environment variables
if (!process.env.POSTGRES_URL) {
  console.error("Error: POSTGRES_URL environment variable is not set");
  process.exit(1);
}

console.log("Starting draft trends precomputation...");

async function createTables() {
  console.log("Creating tables if they don't exist...");
  
  try {
    // Main draft picks table
    await sql`
      CREATE TABLE IF NOT EXISTS draft_picks (
        id SERIAL PRIMARY KEY,
        owner VARCHAR(100) NOT NULL,
        player VARCHAR(200),
        player_nfl_team VARCHAR(10),
        player_nfl_position VARCHAR(10),
        league VARCHAR(50),
        draft_position INTEGER,
        auction_value INTEGER,
        season INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_owner_season ON draft_picks(owner, season)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_player_season ON draft_picks(player, season)`;
    
    // Player scores table
    await sql`
      CREATE TABLE IF NOT EXISTS player_scores (
        id SERIAL PRIMARY KEY,
        player VARCHAR(200) NOT NULL,
        season INTEGER NOT NULL,
        total_points DECIMAL(10,2) DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(player, season)
      )`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_player_season_scores ON player_scores(player, season)`;
    
    // Precomputed owner stats table
    await sql`
      CREATE TABLE IF NOT EXISTS owner_draft_stats (
        id SERIAL PRIMARY KEY,
        owner VARCHAR(100) NOT NULL,
        season_min INTEGER NOT NULL,
        season_max INTEGER NOT NULL,
        total_picks INTEGER DEFAULT 0,
        snake_picks INTEGER DEFAULT 0,
        auction_picks INTEGER DEFAULT 0,
        avg_draft_position DECIMAL(10,2),
        earliest_pick INTEGER,
        latest_pick INTEGER,
        auction_total_spent INTEGER DEFAULT 0,
        auction_avg_value DECIMAL(10,2),
        auction_max_bid INTEGER,
        auction_min_bid INTEGER,
        auction_roi DECIMAL(10,2),
        auction_hit_rate DECIMAL(10,2),
        auction_bust_rate DECIMAL(10,2),
        stats_json TEXT,
        computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(owner, season_min, season_max)
      )`;
    
    await sql`CREATE INDEX IF NOT EXISTS idx_owner_stats ON owner_draft_stats(owner)`;
    
    // Computation status table
    await sql`
      CREATE TABLE IF NOT EXISTS draft_computation_status (
        id SERIAL PRIMARY KEY,
        status VARCHAR(50) NOT NULL,
        season_min INTEGER,
        season_max INTEGER,
        total_records INTEGER,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;
    
    console.log("Tables created successfully!");
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  }
}

async function fetchAndStoreDraftData(seasonMin = 2010, seasonMax = 2024) {
  console.log(`Fetching draft data for seasons ${seasonMin}-${seasonMax}...`);
  
  // Update status
  const statusResult = await sql`
    INSERT INTO draft_computation_status (status, season_min, season_max, started_at)
    VALUES ('running', ${seasonMin}, ${seasonMax}, NOW())
    RETURNING id`;
  const statusId = statusResult.rows[0].id;
  
  try {
    // Fetch all draft data
    const apiUrl = `https://wpflapi.azurewebsites.net/api/draft/history?seasonMin=${seasonMin}&seasonMax=${seasonMax}`;
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const draftData = await response.json();
    console.log(`Fetched ${draftData.length} draft picks`);
    
    // Clear existing draft picks for this range
    await sql`DELETE FROM draft_picks WHERE season >= ${seasonMin} AND season <= ${seasonMax}`;
    
    // Insert draft picks in batches
    const batchSize = 100;
    for (let i = 0; i < draftData.length; i += batchSize) {
      const batch = draftData.slice(i, i + batchSize);
      
      // Build insert values
      const values = batch.map(pick => ({
        owner: pick.owner,
        player: pick.player || null,
        player_nfl_team: pick.playerNflTeam || null,
        player_nfl_position: pick.playerNflPosition || null,
        league: pick.league || null,
        draft_position: pick.draftPosition || null,
        auction_value: pick.auctionValue || null,
        season: pick.season
      }));
      
      // Insert batch
      for (const value of values) {
        await sql`
          INSERT INTO draft_picks (owner, player, player_nfl_team, player_nfl_position, league, draft_position, auction_value, season)
          VALUES (${value.owner}, ${value.player}, ${value.player_nfl_team}, ${value.player_nfl_position}, ${value.league}, ${value.draft_position}, ${value.auction_value}, ${value.season})`;
      }
      
      console.log(`Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(draftData.length/batchSize)}`);
    }
    
    // Update status
    await sql`
      UPDATE draft_computation_status 
      SET total_records = ${draftData.length}
      WHERE id = ${statusId}`;
    
    return statusId;
  } catch (error) {
    // Update status with error
    await sql`
      UPDATE draft_computation_status 
      SET status = 'error', 
          completed_at = NOW(),
          error_message = ${error.message}
      WHERE id = ${statusId}`;
    throw error;
  }
}

async function fetchAndStorePlayerScores(seasonMin = 2015, seasonMax = 2024) {
  console.log(`Fetching player scores for seasons ${seasonMin}-${seasonMax}...`);
  
  try {
    // Clear existing scores for this range
    await sql`DELETE FROM player_scores WHERE season >= ${seasonMin} AND season <= ${seasonMax}`;
    
    // Fetch year by year to avoid timeouts
    for (let year = seasonMin; year <= seasonMax; year++) {
      console.log(`Fetching scores for ${year}...`);
      
      const scoresUrl = `https://wpflapi.azurewebsites.net/api/playerscores?seasonMin=${year}&seasonMax=${year}`;
      const response = await fetch(scoresUrl);
      
      if (!response.ok) {
        console.error(`Failed to fetch scores for ${year}: ${response.status}`);
        continue;
      }
      
      const scoresData = await response.json();
      console.log(`Processing ${scoresData.length} score records for ${year}...`);
      
      // Aggregate scores by player and season
      const playerSeasonScores = {};
      
      scoresData.forEach(score => {
        const key = `${score.player}_${score.season}`;
        if (!playerSeasonScores[key]) {
          playerSeasonScores[key] = {
            player: score.player,
            season: score.season,
            totalPoints: 0,
            gamesPlayed: 0
          };
        }
        playerSeasonScores[key].totalPoints += score.points;
        playerSeasonScores[key].gamesPlayed++;
      });
      
      // Insert aggregated scores
      const scores = Object.values(playerSeasonScores);
      for (const score of scores) {
        await sql`
          INSERT INTO player_scores (player, season, total_points, games_played)
          VALUES (${score.player}, ${score.season}, ${score.totalPoints}, ${score.gamesPlayed})
          ON CONFLICT (player, season) 
          DO UPDATE SET 
            total_points = ${score.totalPoints},
            games_played = ${score.gamesPlayed}`;
      }
      
      console.log(`Inserted ${scores.length} player scores for ${year}`);
    }
  } catch (error) {
    console.error("Error fetching player scores:", error);
    throw error;
  }
}

async function computeOwnerStats(seasonMin = 2010, seasonMax = 2024) {
  console.log(`Computing owner stats for seasons ${seasonMin}-${seasonMax}...`);
  
  try {
    // Get unique owners
    const ownersResult = await sql`
      SELECT DISTINCT owner 
      FROM draft_picks 
      WHERE season >= ${seasonMin} AND season <= ${seasonMax}
      ORDER BY owner`;
    
    const owners = ownersResult.rows.map(row => row.owner);
    console.log(`Found ${owners.length} unique owners`);
    
    // Clear existing stats for this range
    await sql`
      DELETE FROM owner_draft_stats 
      WHERE season_min = ${seasonMin} AND season_max = ${seasonMax}`;
    
    // Compute stats for each owner
    for (const owner of owners) {
      console.log(`Computing stats for ${owner}...`);
      
      // Get all picks for this owner
      const picksResult = await sql`
        SELECT * FROM draft_picks 
        WHERE owner = ${owner} 
        AND season >= ${seasonMin} 
        AND season <= ${seasonMax}
        ORDER BY season, draft_position`;
      
      const picks = picksResult.rows;
      
      if (picks.length === 0) continue;
      
      // Compute basic stats
      const stats = {
        owner: owner,
        seasonMin: seasonMin,
        seasonMax: seasonMax,
        totalPicks: picks.length,
        snakePicks: picks.filter(p => !p.auction_value || p.auction_value === 0 || p.season < 2016).length,
        auctionPicks: picks.filter(p => p.auction_value && p.auction_value > 0 && p.season >= 2016).length,
        avgDraftPosition: picks.reduce((sum, p) => sum + (p.draft_position || 0), 0) / picks.length,
        earliestPick: Math.min(...picks.map(p => p.draft_position || Infinity)),
        latestPick: Math.max(...picks.map(p => p.draft_position || 0))
      };
      
      // Auction-specific stats
      const auctionPicks = picks.filter(p => p.auction_value && p.auction_value > 0 && p.season >= 2016);
      if (auctionPicks.length > 0) {
        stats.auctionTotalSpent = auctionPicks.reduce((sum, p) => sum + p.auction_value, 0);
        stats.auctionAvgValue = stats.auctionTotalSpent / auctionPicks.length;
        stats.auctionMaxBid = Math.max(...auctionPicks.map(p => p.auction_value));
        stats.auctionMinBid = Math.min(...auctionPicks.map(p => p.auction_value));
        
        // Calculate ROI if we have player scores
        if (seasonMax >= 2015) {
          const roiStats = await calculateROIStats(auctionPicks);
          stats.auctionRoi = roiStats.roi;
          stats.auctionHitRate = roiStats.hitRate;
          stats.auctionBustRate = roiStats.bustRate;
        }
      }
      
      // Complex stats stored as JSON
      const complexStats = {
        teamFrequency: {},
        positionFrequency: {},
        positionByRound: { early: {}, mid: {}, late: {} },
        repeatPlayers: [],
        topTeams: [],
        favoritePosition: null,
        yearlyBreakdown: {},
        draftTrends: {
          positionTrends: {},
          reachRate: 0,
          valueHunting: 0,
          consistency: 0,
          adaptability: 0
        },
        rivalries: [],
        streaks: {
          currentHotStreak: 0,
          currentColdStreak: 0,
          bestDraftYear: null,
          worstDraftYear: null
        },
        tradingPatterns: {
          mostTradedWith: [],
          tradingFrequency: 0
        },
        specialtyPicks: {
          rookieRate: 0,
          sleepers: [],
          busts: [],
          steals: []
        }
      };
      
      // Calculate frequencies
      picks.forEach(pick => {
        // Team frequency
        const team = pick.player_nfl_team || "Unknown";
        complexStats.teamFrequency[team] = (complexStats.teamFrequency[team] || 0) + 1;
        
        // Position frequency
        const position = pick.player_nfl_position || "Unknown";
        complexStats.positionFrequency[position] = (complexStats.positionFrequency[position] || 0) + 1;
        
        // Position by round
        if (pick.draft_position) {
          const round = Math.ceil(pick.draft_position / 12);
          const roundCategory = round <= 3 ? "early" : round <= 8 ? "mid" : "late";
          complexStats.positionByRound[roundCategory][position] = 
            (complexStats.positionByRound[roundCategory][position] || 0) + 1;
        }
        
        // Yearly breakdown
        const year = pick.season;
        if (!complexStats.yearlyBreakdown[year]) {
          complexStats.yearlyBreakdown[year] = {
            picks: 0,
            avgPosition: 0,
            positions: {}
          };
        }
        complexStats.yearlyBreakdown[year].picks++;
        complexStats.yearlyBreakdown[year].avgPosition += pick.draft_position || 0;
        complexStats.yearlyBreakdown[year].positions[position] = 
          (complexStats.yearlyBreakdown[year].positions[position] || 0) + 1;
      });
      
      // Calculate averages for yearly breakdown
      Object.keys(complexStats.yearlyBreakdown).forEach(year => {
        const yearData = complexStats.yearlyBreakdown[year];
        yearData.avgPosition = yearData.avgPosition / yearData.picks;
      });
      
      // Find top teams
      complexStats.topTeams = Object.entries(complexStats.teamFrequency)
        .filter(([team]) => team !== "Unknown")
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([team, count]) => ({ team, count, percentage: (count / picks.length * 100).toFixed(1) }));
      
      // Find favorite position
      const favPos = Object.entries(complexStats.positionFrequency)
        .filter(([pos]) => pos !== "Unknown")
        .sort(([,a], [,b]) => b - a)[0];
      if (favPos) {
        complexStats.favoritePosition = {
          position: favPos[0],
          count: favPos[1],
          percentage: (favPos[1] / picks.length * 100).toFixed(1)
        };
      }
      
      // Find repeat players
      const playerCounts = {};
      picks.forEach(pick => {
        if (pick.player) {
          if (!playerCounts[pick.player]) {
            playerCounts[pick.player] = { count: 0, seasons: [], positions: new Set(), teams: new Set() };
          }
          playerCounts[pick.player].count++;
          playerCounts[pick.player].seasons.push(pick.season);
          if (pick.player_nfl_position) playerCounts[pick.player].positions.add(pick.player_nfl_position);
          if (pick.player_nfl_team) playerCounts[pick.player].teams.add(pick.player_nfl_team);
        }
      });
      
      complexStats.repeatPlayers = Object.entries(playerCounts)
        .filter(([, data]) => data.count >= 2)
        .sort(([,a], [,b]) => b.count - a.count)
        .slice(0, 10)
        .map(([player, data]) => ({
          player,
          count: data.count,
          seasons: data.seasons.sort(),
          positions: Array.from(data.positions),
          teams: Array.from(data.teams)
        }));
      
      // Calculate advanced metrics
      
      // Draft consistency score (lower variance = more consistent)
      const draftPositions = picks.map(p => p.draft_position).filter(p => p);
      if (draftPositions.length > 0) {
        const avgPos = draftPositions.reduce((a, b) => a + b, 0) / draftPositions.length;
        const variance = draftPositions.reduce((sum, pos) => sum + Math.pow(pos - avgPos, 2), 0) / draftPositions.length;
        complexStats.draftTrends.consistency = Math.max(0, 100 - (Math.sqrt(variance) * 2)).toFixed(1);
      }
      
      // Reach rate (picking players earlier than ADP)
      const earlyPicks = picks.filter(p => p.draft_position && p.draft_position <= 36).length;
      complexStats.draftTrends.reachRate = picks.length > 0 ? ((earlyPicks / picks.length) * 100).toFixed(1) : 0;
      
      // Value hunting score (late round picks that repeat)
      const lateRoundRepeats = complexStats.repeatPlayers.filter(rp => {
        const avgDraftPos = picks
          .filter(p => p.player === rp.player && p.draft_position)
          .reduce((sum, p) => sum + p.draft_position, 0) / rp.count;
        return avgDraftPos > 100;
      }).length;
      complexStats.draftTrends.valueHunting = (lateRoundRepeats * 20); // Score out of 100
      
      // Position trend analysis
      Object.entries(complexStats.yearlyBreakdown).forEach(([year, data]) => {
        Object.entries(data.positions).forEach(([pos, count]) => {
          if (!complexStats.draftTrends.positionTrends[pos]) {
            complexStats.draftTrends.positionTrends[pos] = [];
          }
          complexStats.draftTrends.positionTrends[pos].push({
            year: parseInt(year),
            count: count,
            percentage: (count / data.picks * 100).toFixed(1)
          });
        });
      });
      
      // Sort position trends by year
      Object.keys(complexStats.draftTrends.positionTrends).forEach(pos => {
        complexStats.draftTrends.positionTrends[pos].sort((a, b) => a.year - b.year);
      });
      
      // Identify hot/cold streaks and best/worst years
      if (auctionPicks.length > 0 && stats.auctionRoi) {
        // Group by year for streak analysis
        const yearlyROI = {};
        auctionPicks.forEach(pick => {
          if (!yearlyROI[pick.season]) {
            yearlyROI[pick.season] = [];
          }
          yearlyROI[pick.season].push(pick);
        });
        
        // Find best and worst draft years
        let bestYear = null;
        let worstYear = null;
        let bestROI = -Infinity;
        let worstROI = Infinity;
        
        Object.entries(yearlyROI).forEach(([year, yearPicks]) => {
          // Simple ROI calculation based on auction values
          const avgValue = yearPicks.reduce((sum, p) => sum + p.auction_value, 0) / yearPicks.length;
          if (avgValue > bestROI) {
            bestROI = avgValue;
            bestYear = year;
          }
          if (avgValue < worstROI) {
            worstROI = avgValue;
            worstYear = year;
          }
        });
        
        complexStats.streaks.bestDraftYear = bestYear;
        complexStats.streaks.worstDraftYear = worstYear;
      }
      
      // Insert computed stats
      await sql`
        INSERT INTO owner_draft_stats (
          owner, season_min, season_max, total_picks, snake_picks, auction_picks,
          avg_draft_position, earliest_pick, latest_pick, auction_total_spent,
          auction_avg_value, auction_max_bid, auction_min_bid, auction_roi,
          auction_hit_rate, auction_bust_rate, stats_json
        ) VALUES (
          ${stats.owner}, ${stats.seasonMin}, ${stats.seasonMax}, ${stats.totalPicks},
          ${stats.snakePicks}, ${stats.auctionPicks}, ${stats.avgDraftPosition},
          ${stats.earliestPick === Infinity ? null : stats.earliestPick}, 
          ${stats.latestPick}, ${stats.auctionTotalSpent || 0},
          ${stats.auctionAvgValue || null}, ${stats.auctionMaxBid || null},
          ${stats.auctionMinBid || null}, ${stats.auctionRoi || null},
          ${stats.auctionHitRate || null}, ${stats.auctionBustRate || null},
          ${JSON.stringify(complexStats)}
        )`;
    }
    
    console.log("Finished computing owner stats!");
  } catch (error) {
    console.error("Error computing owner stats:", error);
    throw error;
  }
}

async function calculateROIStats(auctionPicks) {
  const performanceValues = [];
  
  // Get player scores for these picks
  for (const pick of auctionPicks) {
    if (pick.player && pick.season >= 2015) {
      const scoreResult = await sql`
        SELECT total_points, games_played 
        FROM player_scores 
        WHERE player = ${pick.player} AND season = ${pick.season}`;
      
      if (scoreResult.rows.length > 0) {
        const score = scoreResult.rows[0];
        if (score.total_points > 0) {
          performanceValues.push({
            pick: pick,
            totalPoints: parseFloat(score.total_points),
            gamesPlayed: score.games_played,
            pointsPerDollar: parseFloat(score.total_points) / pick.auction_value,
            pointsPerGame: parseFloat(score.total_points) / score.games_played
          });
        }
      }
    }
  }
  
  if (performanceValues.length === 0) {
    return { roi: null, hitRate: null, bustRate: null };
  }
  
  // Calculate average points per dollar
  const avgPointsPerDollar = performanceValues.reduce((sum, pv) => sum + pv.pointsPerDollar, 0) / performanceValues.length;
  
  // Calculate overall ROI
  const totalInvestment = performanceValues.reduce((sum, pv) => sum + pv.pick.auction_value, 0);
  const totalReturn = performanceValues.reduce((sum, pv) => sum + pv.totalPoints, 0);
  const roi = totalReturn / totalInvestment;
  
  // Calculate bust rate (players who returned < 50 points per $10 spent)
  const busts = performanceValues.filter(pv => pv.totalPoints < (pv.pick.auction_value * 5));
  const bustRate = (busts.length / performanceValues.length) * 100;
  
  // Calculate hit rate (players who exceeded average value)
  const hits = performanceValues.filter(pv => pv.pointsPerDollar > avgPointsPerDollar);
  const hitRate = (hits.length / performanceValues.length) * 100;
  
  return {
    roi: roi.toFixed(2),
    hitRate: hitRate.toFixed(1),
    bustRate: bustRate.toFixed(1)
  };
}

async function main() {
  const args = process.argv.slice(2);
  const seasonMin = args[0] ? parseInt(args[0]) : 2010;
  const seasonMax = args[1] ? parseInt(args[1]) : 2024;
  
  console.log(`Running precomputation for seasons ${seasonMin}-${seasonMax}`);
  
  let statusId;
  try {
    // Create tables
    await createTables();
    
    // Fetch and store draft data
    statusId = await fetchAndStoreDraftData(seasonMin, seasonMax);
    
    // Fetch and store player scores (only for 2015+)
    if (seasonMax >= 2015) {
      await fetchAndStorePlayerScores(Math.max(seasonMin, 2015), seasonMax);
    }
    
    // Compute owner stats
    await computeOwnerStats(seasonMin, seasonMax);
    
    // Update status to completed
    await sql`
      UPDATE draft_computation_status 
      SET status = 'completed', completed_at = NOW()
      WHERE id = ${statusId}`;
    
    console.log("Precomputation completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error during precomputation:", error);
    if (statusId) {
      await sql`
        UPDATE draft_computation_status 
        SET status = 'error', 
            completed_at = NOW(),
            error_message = ${error.message}
        WHERE id = ${statusId}`;
    }
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);