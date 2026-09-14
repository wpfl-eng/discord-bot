// Destructured straight from require(), and a shorthand object: TypeScript
// keeps Client and NFLGame usable as types only when they are bound directly
// from the require, and Node's CommonJS export detection only sees shorthand
// keys. Binding through an intermediate variable, or writing
// `Client: fork.Client`, broke one or the other on the pi (2026-09-14).
const { Client, NFLGame } = require('espn-fantasy-football-api/node');
const { WINNING_TEAM: forkWinningTeam } = require('espn-fantasy-football-api/node');

// A build of the fork can lack the runtime constants its typings declare: the
// pi's install of the very commit pinned here exported NFLGame but not
// WINNING_TEAM, and the bot crash-looped at import. The values are the
// fork's documented ones, so a missing export falls back rather than taking
// the process down.
const WINNING_TEAM = forkWinningTeam ?? {
  HOME: 'HOME',
  AWAY: 'AWAY',
  TIE: 'TIE',
  UNDECIDED: 'UNDECIDED',
};

module.exports = { Client, NFLGame, WINNING_TEAM };
