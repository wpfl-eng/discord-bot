import { sql } from "@vercel/postgres";

// ============ Stats Management ============

/**
 * Get or create a user's Red Zone stats
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @returns {Promise<object>} - User Red Zone stats
 */
export async function getOrCreateStats(userId, username) {
  const result = await sql`
    INSERT INTO redzone_stats (user_id, username, created_at)
    VALUES (${userId}, ${username}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get a user's Red Zone stats
 * @param {string} userId - Discord user ID
 * @returns {Promise<object|null>} - User stats or null
 */
export async function getUserStats(userId) {
  const result = await sql`
    SELECT * FROM redzone_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Record a game result and update all stats atomically
 * Handles streak calculation: positive = TD streak, negative = fumble streak
 * @param {object} data - Game result data
 * @param {string} data.userId - Discord user ID
 * @param {string} data.username - Discord username
 * @param {'touchdown'|'fumble'|'cashout'} data.outcome - Game outcome
 * @param {number} data.bet - Amount wagered
 * @param {number} data.payout - Amount won (0 for fumble)
 * @param {number} data.yardsGained - Total yards gained in this drive
 * @returns {Promise<object>} - Updated user stats
 */
export async function recordGameResult(data) {
  const {
    userId,
    username,
    outcome,
    bet,
    payout,
    yardsGained = 0,
  } = data;

  // Determine increments based on outcome
  const touchdowns = outcome === "touchdown" ? 1 : 0;
  const fumbles = outcome === "fumble" ? 1 : 0;
  const cashouts = outcome === "cashout" ? 1 : 0;

  // Calculate net profit for this game
  const netProfit = payout - bet;

  const result = await sql`
    INSERT INTO redzone_stats (
      user_id, username, games_played, touchdowns, fumbles, cashouts,
      current_td_streak, best_td_streak, worst_fumble_streak,
      total_yards_gained, longest_drive,
      total_wagered, total_won, biggest_win, last_played_at, created_at
    )
    VALUES (
      ${userId}, ${username}, 1, ${touchdowns}, ${fumbles}, ${cashouts},
      CASE
        WHEN ${outcome} = 'touchdown' THEN 1
        WHEN ${outcome} = 'fumble' THEN -1
        ELSE 0
      END,
      CASE WHEN ${outcome} = 'touchdown' THEN 1 ELSE 0 END,
      CASE WHEN ${outcome} = 'fumble' THEN 1 ELSE 0 END,
      ${yardsGained}, ${yardsGained},
      ${bet}, ${payout},
      CASE WHEN ${netProfit} > 0 THEN ${netProfit} ELSE 0 END,
      NOW(), NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username},
      games_played = redzone_stats.games_played + 1,
      touchdowns = redzone_stats.touchdowns + ${touchdowns},
      fumbles = redzone_stats.fumbles + ${fumbles},
      cashouts = redzone_stats.cashouts + ${cashouts},
      current_td_streak = CASE
        WHEN ${outcome} = 'touchdown' AND redzone_stats.current_td_streak >= 0 THEN redzone_stats.current_td_streak + 1
        WHEN ${outcome} = 'touchdown' THEN 1
        WHEN ${outcome} = 'fumble' AND redzone_stats.current_td_streak <= 0 THEN redzone_stats.current_td_streak - 1
        WHEN ${outcome} = 'fumble' THEN -1
        ELSE 0
      END,
      best_td_streak = CASE
        WHEN ${outcome} = 'touchdown' AND redzone_stats.current_td_streak >= 0
          AND redzone_stats.current_td_streak + 1 > redzone_stats.best_td_streak
        THEN redzone_stats.current_td_streak + 1
        WHEN ${outcome} = 'touchdown' AND redzone_stats.current_td_streak < 0
          AND 1 > redzone_stats.best_td_streak
        THEN 1
        ELSE redzone_stats.best_td_streak
      END,
      worst_fumble_streak = CASE
        WHEN ${outcome} = 'fumble' AND redzone_stats.current_td_streak <= 0
          AND ABS(redzone_stats.current_td_streak - 1) > redzone_stats.worst_fumble_streak
        THEN ABS(redzone_stats.current_td_streak - 1)
        WHEN ${outcome} = 'fumble' AND redzone_stats.current_td_streak > 0
          AND 1 > redzone_stats.worst_fumble_streak
        THEN 1
        ELSE redzone_stats.worst_fumble_streak
      END,
      total_yards_gained = redzone_stats.total_yards_gained + ${yardsGained},
      longest_drive = CASE
        WHEN ${yardsGained} > redzone_stats.longest_drive THEN ${yardsGained}
        ELSE redzone_stats.longest_drive
      END,
      total_wagered = redzone_stats.total_wagered + ${bet},
      total_won = redzone_stats.total_won + ${payout},
      biggest_win = CASE
        WHEN ${netProfit} > redzone_stats.biggest_win THEN ${netProfit}
        ELSE redzone_stats.biggest_win
      END,
      last_played_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// ============ Leaderboards ============

/**
 * Get Red Zone leaderboard by category
 * @param {'touchdowns'|'winrate'|'drive'|'profit'|'streak'|'biggest_win'} category - Leaderboard category
 * @param {number} limit - Number of results
 * @returns {Promise<array>} - Leaderboard entries
 */
export async function getLeaderboard(category, limit = 10) {
  let result;

  switch (category) {
    case "touchdowns":
      result = await sql`
        SELECT user_id, username, touchdowns, games_played, fumbles,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * touchdowns / games_played, 1)
            ELSE 0
          END as td_rate
        FROM redzone_stats
        ORDER BY touchdowns DESC
        LIMIT ${limit}
      `;
      break;

    case "winrate":
      result = await sql`
        SELECT user_id, username, touchdowns, games_played,
          ROUND(100.0 * touchdowns / games_played, 1) as td_rate
        FROM redzone_stats
        WHERE games_played >= 10
        ORDER BY (touchdowns::float / games_played) DESC
        LIMIT ${limit}
      `;
      break;

    case "drive":
      result = await sql`
        SELECT user_id, username, longest_drive, total_yards_gained, games_played
        FROM redzone_stats
        ORDER BY longest_drive DESC
        LIMIT ${limit}
      `;
      break;

    case "profit":
      result = await sql`
        SELECT user_id, username,
          (total_won - total_wagered) as net_profit,
          total_wagered, total_won, games_played
        FROM redzone_stats
        ORDER BY (total_won - total_wagered) DESC
        LIMIT ${limit}
      `;
      break;

    case "streak":
      result = await sql`
        SELECT user_id, username, best_td_streak, current_td_streak, games_played
        FROM redzone_stats
        ORDER BY best_td_streak DESC
        LIMIT ${limit}
      `;
      break;

    case "biggest_win":
      result = await sql`
        SELECT user_id, username, biggest_win, games_played
        FROM redzone_stats
        ORDER BY biggest_win DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql`
        SELECT user_id, username, touchdowns, games_played
        FROM redzone_stats
        ORDER BY touchdowns DESC
        LIMIT ${limit}
      `;
  }

  return result.rows;
}

/**
 * Get a user's rank on a specific leaderboard
 * @param {string} userId - Discord user ID
 * @param {'touchdowns'|'profit'} category - Category to rank
 * @returns {Promise<number|null>} - User's rank (1-based) or null
 */
export async function getUserRank(userId, category = "touchdowns") {
  const stats = await getUserStats(userId);
  if (!stats) return null;

  let result;

  switch (category) {
    case "touchdowns":
      result = await sql`
        SELECT COUNT(*) + 1 as rank
        FROM redzone_stats
        WHERE touchdowns > ${stats.touchdowns}
      `;
      break;

    case "profit":
      const netProfit = stats.total_won - stats.total_wagered;
      result = await sql`
        SELECT COUNT(*) + 1 as rank
        FROM redzone_stats
        WHERE (total_won - total_wagered) > ${netProfit}
      `;
      break;

    default:
      result = await sql`
        SELECT COUNT(*) + 1 as rank
        FROM redzone_stats
        WHERE touchdowns > ${stats.touchdowns}
      `;
  }

  return parseInt(result.rows[0]?.rank) || 1;
}

/**
 * Get total number of Red Zone players
 * @returns {Promise<number>} - Total player count
 */
export async function getTotalPlayers() {
  const result = await sql`
    SELECT COUNT(*) as count FROM redzone_stats
  `;
  return parseInt(result.rows[0]?.count) || 0;
}
