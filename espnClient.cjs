const fork = require('espn-fantasy-football-api/node');

// A build of the fork can lack the runtime constants its typings declare: the
// pi's install of the very commit pinned here exported NFLGame but not
// WINNING_TEAM (2026-09-14), and the bot crash-looped at import. The values
// are the fork's documented ones, so a missing export falls back rather than
// taking the process down.
const WINNING_TEAM = fork.WINNING_TEAM ?? {
  HOME: 'HOME',
  AWAY: 'AWAY',
  TIE: 'TIE',
  UNDECIDED: 'UNDECIDED',
};

module.exports = { Client: fork.Client, NFLGame: fork.NFLGame, WINNING_TEAM };
