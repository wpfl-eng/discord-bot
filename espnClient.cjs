const fork = require('espn-fantasy-football-api/node');

// Destructured bindings and a shorthand object, not `Client: fork.Client`:
// TypeScript keeps the class as a type only through a binding, and Node's
// CommonJS export detection only sees shorthand keys, so the other shape
// broke both `import type` users and the ESM import on the pi.
const { Client, NFLGame } = fork;

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

module.exports = { Client, NFLGame, WINNING_TEAM };
