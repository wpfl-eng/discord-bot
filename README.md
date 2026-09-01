# Commish Bot

Malevolently Robotting For Life - A Discord bot for fantasy football league management.

## Overview

CommishBot is a feature-rich Discord bot built for the WPFL fantasy football league. It pulls league
data from ESPN and the WPFL history API, and layers on a full virtual economy: casino games,
collectibles, prediction markets, stock trading, trivia, and Wordle. `/ask` answers open-ended
league questions using the Claude Agent SDK, reasoning over the draft report, ten years of history,
the live ESPN season, and the web.

The codebase is TypeScript throughout, run directly with [`tsx`](https://github.com/privatenumber/tsx)
(no build step).

## Prerequisites

- Node.js v20.15.1 (see `engines` in `package.json`)
- PostgreSQL database
- Discord bot application ([Create one here](https://discord.com/developers/applications))
- ESPN Fantasy Football league with API access
- Finnhub API key (only needed for `/stock`)
- OpenAI API key (only needed for `/image`)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/wpfl-eng/discord-bot.git
cd discord-bot
```

2. Install dependencies:
```bash
make install
# or
npm install
```

3. Configure environment variables:
```bash
cp .env.sample .env
```

See [Environment Variables](#environment-variables) below for the full list.

4. Deploy slash commands to Discord:
```bash
npx tsx deploy-commands.ts
```

## Running the Bot

### Development Mode
```bash
npm run dev
```
Uses `tsx watch` for automatic restarts on file changes. (`npm run dev:node` is the nodemon variant.)

### Production Mode
```bash
npm start
```

The bot also starts an Express server on `PORT` (default 5000) that responds to `GET /` for health
checks.

### Other Scripts
```bash
npm test            # Jest unit tests
npm run lint        # ESLint
npm run lint:fix    # ESLint with --fix
npm run typecheck   # tsc --noEmit
npm run format      # Prettier write
npm run format:check
```

## Available Commands

48 slash commands are registered. Each lives in `discordCommands/<name>/<name>.ts`.

### Ask

| Command | Options | Notes |
| --- | --- | --- |
| `/ask` | `question` (required) | Open-ended questions about the league, answered in a public thread |

`/ask` opens a thread on the answer and streams a live ticker of what it is doing — which file it
read, which query it ran, what it is currently reasoning about — then the answer itself, with a
source footer. Anyone in the thread can keep talking to it; each person's questions count against
their own daily limit. It reasons over five sources: the draft-2026 post-draft report (fetched and
shredded to disk), a locally cached decade of WPFL history queried with read-only SQL, the WPFL
history API's computed aggregates, the live ESPN season, and the web.

It needs `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, and migration
`migrations/009_ask_agent.sql`.

### Fantasy Football

| Command | Options | Notes |
| --- | --- | --- |
| `/activity` | — | Recent league transactions (ESPN) |
| `/standings` | `week`, `year` | League standings (ESPN) |
| `/median` | `week` (default 13), `year` (default 2025) | Ranked scores with cut line (ESPN) |
| `/closestscores` | `week`, `year` | Closest scoring matchups (ESPN) |
| `/trophies` | `week`, `year` | Weekly awards (ESPN) |
| `/ewins` | `year`, `week` | Expected vs. actual wins (WPFL API) |
| `/optimal` | `year`, `week` | Optimal coaching / points left on bench (WPFL API) |
| `/draft` | — | Countdown to the draft |

### Draft & Analysis

| Command | Options | Notes |
| --- | --- | --- |
| `/drafttrends` | `user` (required), `seasonmin`, `seasonmax` | Draft tendencies and personality profile (Postgres) |
| `/clutch` | `type` (required: `playoffs` / `close` / `highstakes`), `seasonmin`, `seasonmax` | Who shows up when it matters (WPFL API) |
| `/cursed` | `user` (required), `seasonmin`, `seasonmax` | Statistical nightmares (WPFL API) |

### Economy

| Command | Options | Notes |
| --- | --- | --- |
| `/balance` | `user` | Wallet + bank for you or someone else |
| `/daily` | — | Daily check with streak bonus |
| `/work` | — | Earn coins on a 30-minute cooldown |
| `/deposit` | `amount` (required, number or `all`) | Wallet → bank |
| `/withdraw` | `amount` (required, number or `all`) | Bank → wallet |
| `/eleaderboard` | — | Wealth rankings |
| `/economyhelp` | — | Economy command reference |
| `/shop` | — | Buy bank expansions |
| `/inventory` | `view` \| `sell <item> [quantity]` | Item autocomplete on `sell` |

`/shop` currently stocks a single item, Bank Expansion. `/inventory` holds the Wordle
first-solver Lucky Letter, the only item with a live source. Tuning constants live in
[`economy/economyConfig.ts`](economy/economyConfig.ts).

### Casino

| Command | Options | Notes |
| --- | --- | --- |
| `/gamble` | `amount` (required, number or `all`) | Coin flip |
| `/slots` | `amount` (required, number or `all`) | Football-themed slot machine |
| `/blackjack` | `amount` (required), `table` (`classic` 1-deck S17 / `vegas` 6-deck H17) | Hit/stand/double/split via buttons |
| `/blackjackstats` | `user` | Personal blackjack stats |
| `/blackjackleaderboard` | `category` (games, wins, winrate, blackjacks, profit, streak, biggest_win) | |
| `/videopoker` | `amount` (required, number or `all`) | Jacks or Better |
| `/videopokerstats` | `user` | |
| `/redzone` | `bet` (required, 10-10000 or `all`/`max`) | Push-your-luck touchdown drive |
| `/redzoneleaderboard` | `category` (touchdowns, winrate, drive, profit, streak, biggest_win) | |
| `/roulette` | `bet <amount> <type>` \| `history` | American wheel, auto-spinning rounds, autocompleted bet types |
| `/craps` | `bet <amount> <type>` \| `status` | Pass line, don't pass, field, place 6, place 8 |

### Stock Trading

| Command | Options |
| --- | --- |
| `/stock buy` | `ticker` (required), `amount` (required, coins to spend) |
| `/stock sell` | `ticker` (required), `shares` or `dollars` |
| `/stock portfolio` | — |
| `/stock quote` | `ticker` (required) |

Live quotes come from [Finnhub](https://finnhub.io/). Requires `FINNHUB_API_KEY`.

### Prediction Markets

| Command | Notes |
| --- | --- |
| `/predictions` | Browse Polymarket markets by category and bet with coins |
| `/my-predictions` | Your open prediction bets |
| `/check-predictions` | Settle resolved bets and collect payouts |

Market data comes from the Polymarket Gamma API (`polymarket/`). Folder name `checkpredictions`
maps to command name `check-predictions`; `mypredictions` maps to `my-predictions`.

### Trivia

| Command | Options | Notes |
| --- | --- | --- |
| `/trivia` | `answer` (required) | Submit an answer to the active question |
| `/triviastats` | `user` | |
| `/trivialeaderboard` | `view` (`30day` default, `month`, `alltime`) | |
| `/triviaquestion` | `category` (autocomplete) | Admin only — gated on `TRIVIA_ADMIN_USER_IDS` |

Questions are auto-discovered from `trivia/*Questions.json`. Add a new category by dropping in a
`<name>Questions.json` file — no code change needed.

### Wordle

| Command | Notes |
| --- | --- |
| `/wordle` | 6 guesses, 5-letter word, 1-hour word rotation. First solver earns a Lucky Letter item |

### Member Bets

| Command | Options |
| --- | --- |
| `/betcreate` | `betuser` (required), `description` (required), `amount` (required) |
| `/betlist` | — |

### Utility

| Command | Options |
| --- | --- |
| `/ping` | — |
| `/flip` | — |
| `/roll` | `sides` (required), `dice`, `hidden` |
| `/image` | `query` (required) — DALL-E 3 |
| `/namecolor` | `set <color>` \| `remove` \| `list` |

## Background Features

Not everything is a slash command. `index.ts` and the service modules also run:

- **Trivia scheduler** (`trivia/triviaService.ts`) — cron in `America/New_York`. Posts a question at
  9am, 11am, 1pm, 3pm, 5pm, 7pm and 9pm; auto-closes each two hours later. Season rollover runs at
  midnight on the 1st of each month.
- **Trivia DM answers** — a `messageCreate` handler accepts answers sent to the bot in DMs.
- **Trivia button answers** — button interactions prefixed `trivia_`.
- **Roulette auto-spin** — rounds spin on a timer (`discordCommands/roulette/rouletteState.ts`).
- **Achievements** — 9 achievements awarded off 20 action types
  (`achievements/achievementConfig.ts`), checked from the game commands.
- **Autocomplete routing** — `/craps`, `/roulette`, `/inventory` and `/triviaquestion` export an
  `autocomplete` handler that `index.ts` dispatches to.
- **Express health server** on `PORT` (default 5000).

## Environment Variables

Create `.env` from `.env.sample`.

| Variable | Used for |
| --- | --- |
| `DISCORD_TOKEN` | Bot login |
| `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | `deploy-commands.ts` (guild command registration) |
| `ESPN_S2`, `SWID`, `LEAGUE_ID` | ESPN commands (`/activity`, `/standings`, `/median`, `/closestscores`, `/trophies`) |
| `SLEEPER_LEAGUE_ID` | Sleeper matchup helper (`api/sleeper/sleeper.ts`) |
| `POSTGRES_*` | Vercel Postgres connection |
| `OPEN_API_KEY` | `/image` (DALL-E 3) |
| `FINNHUB_API_KEY` | `/stock` quotes |
| `ANTHROPIC_API_KEY` *or* `CLAUDE_CODE_OAUTH_TOKEN` | `/ask` (the API key takes precedence if both are set) |
| `WPFL_DATA_DIR` | Where `/ask` writes its shredded data (default `$HOME/wpfl-data`) |
| `PORT` | Express health server (default 5000) |
| `TRIVIA_CHANNEL_ID` | Where scheduled trivia posts |
| `TRIVIA_ADMIN_USER_IDS` | Comma-separated IDs allowed to run `/triviaquestion` |
| `ECONOMY_TOWN_SQUARE_CHANNEL_ID`, `ECONOMY_CASINO_CHANNEL_ID` | Channel gating for economy/casino commands |
| `ROULETTE_CHANNEL_ID` | Roulette round announcements |
| `CRAPS_CHANNEL_ID` | Craps table announcements |
| `API_KEY`, `BOT_ID` | Legacy GroupMe-era values kept in `.env.sample` |

## Development Guide

### Project Structure
```
discord-bot/
├── index.ts                  # Entry point: client, command loader, interaction router, Express
├── deploy-commands.ts        # Registers slash commands with Discord (guild scoped)
├── discordCommands/          # Slash command implementations
│   └── commandname/
│       └── commandname.ts    # Must match folder name (case-insensitive)
├── ask/                      # /ask agent: config, auth, runner, caps, hooks, ticker, prompt
├── wpfl/                     # /ask data layer: artifact sync + shred, SQL tool, ESPN/WPFL tools, MCP server
├── economy/                  # Shared economy config + DB access
├── achievements/             # Achievement definitions and award service
├── inventory/                # Item definitions and inventory DB
├── trivia/                   # Trivia service, scheduler, question banks, answer matching
├── wordle/                   # Wordle config, word lists, DB
├── stock/                    # Finnhub client, config, holdings DB
├── polymarket/               # Polymarket Gamma API client and DB
├── blackjack/ craps/ redzone/ videopoker/   # Per-game stat DB modules
├── api/sleeper/              # Sleeper API integration
├── constants/                # espnMembers, sleeperMembers, cached members, insults
├── helpers/                  # Shared utilities (NFL week math, formatting, draft trends)
├── errors/                   # BotError and centralized error handling
├── types/                    # Shared TypeScript types and module declarations
├── sql/                      # Table definitions
├── migrations/               # Numbered SQL migrations
├── scripts/                  # One-off maintenance and data-generation scripts
├── docs/                     # SvelteKit documentation site (deployed to Cloudflare Pages)
└── tests/                    # Jest tests
```

### Command Loading

Both `index.ts` and `deploy-commands.ts` scan `discordCommands/`. For each folder they import **only**
the file whose basename matches the folder name (case-insensitive) — so `videopoker/videoPoker.ts`
is picked up while `videoPokerUtils.ts`, `videoPokerDb.ts` etc. are correctly skipped. If no file
matches the folder name, every `.ts`/`.js` file in that folder is imported as a fallback.

Modules are validated by `isValidCommandModule` (`types/commands.ts`); anything missing `data` or
`execute` is logged and skipped.

### Creating a New Command

1. Create a new directory and file in `/discordCommands`. The file name must match the folder name:
```
discordCommands/
└── mycommand/
    └── mycommand.ts
```

2. Implement the command with required exports (explicit types on everything):

```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('mycommand')
  .setDescription('Description of your command')
  .addStringOption((option) =>
    option.setName('parameter').setDescription('Parameter description').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const paramValue: string = interaction.options.getString('parameter', true);

  await interaction.reply({
    content: `You said: ${paramValue}`,
    ephemeral: true,
  });
}
```

3. Optionally export an `autocomplete` handler:

```typescript
import type { AutocompleteInteraction } from 'discord.js';

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused: string = interaction.options.getFocused();
  await interaction.respond(
    CHOICES.filter((c) => c.startsWith(focused))
      .slice(0, 25)
      .map((c) => ({ name: c, value: c }))
  );
}
```

4. Deploy the new command:
```bash
npx tsx deploy-commands.ts
```

### Working with External APIs

#### ESPN Fantasy Football
Uses a custom fork of the ESPN API. Credentials are read per-command from the environment:
```typescript
import pkg from 'espn-fantasy-football-api/node.js';
const { Client } = pkg;

const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
const espnClient = new Client({ leagueId: Number.parseInt(LEAGUE_ID, 10) });
espnClient.setCookies({ espnS2: ESPN_S2, SWID });
```

#### WPFL History API
Historical league stats (`/ewins`, `/optimal`, `/clutch`, `/cursed`) come from
`https://wpflapi.azurewebsites.net`. Endpoint shapes are documented in `CLAUDE.md`.

#### Sleeper API
Direct API calls to Sleeper:
```typescript
const response = await fetch(
  `https://api.sleeper.app/v1/league/${process.env.SLEEPER_LEAGUE_ID}/matchups/${week}`
);
```

### Database Operations

PostgreSQL via Vercel's client:
```typescript
import { sql } from '@vercel/postgres';

const result = await sql`SELECT * FROM economy_users WHERE user_id = ${userId}`;
```

Roughly 25 tables back the bot, grouped by feature: `economy_users`, `user_inventory`,
`achievements`, `blackjack_stats`, `redzone_stats`, `video_poker_stats`,
`craps_sessions` / `craps_bets` / `craps_stats`, `roulette_rounds` / `roulette_bets`,
`stock_holdings` / `stock_prices`, `prediction_bets`,
`trivia_active` / `trivia_answers` / `trivia_history` / `trivia_scores` / `trivia_seasons`,
`wordle_words` / `wordle_stats` / `wordle_user_games`,
`draft_picks` / `owner_draft_stats` / `draft_computation_status`, `player_scores`, plus the original
`pins` and `Bets`.

Schemas are split between `sql/` (per-feature table definitions) and `migrations/` (numbered SQL
files). There is no automated migration runner — apply them manually.

`migrations/008_remove_nflmon_rob_training.sql` has not been applied. It drops the retired NFLmon
tables, the rob/padlock columns on `economy_users`, and the long-dead `training_grounds` /
`training_slots` tables. The bot runs correctly either way; applying it is irreversible.

### Testing

Run tests with Jest:
```bash
npm test
```

Tests live in `/tests`, organized as `config/`, `helpers/`, `services/`, `trivia/` and `utils/`.
They target pure config and utility modules plus mocked services; external dependencies like the
ESPN client and the database are mocked.

## Configuration

### Member Mappings
Update user mappings in:
- `constants/espnMembers.ts` - Maps ESPN team IDs to Discord users
- `constants/sleeperMembers.ts` - Maps Sleeper user IDs to names
- `constants/cached.ts` - Cached GroupMe-era member data

### Bot Settings
The bot displays "Watching Jaguars Highlights" as its activity status. Modify in `index.ts`.

## Documentation Site

A SvelteKit docs site lives in `docs/`, deployed to Cloudflare Pages:
```bash
cd docs
npm install
npm run dev      # local preview
npm run deploy   # build + wrangler pages deploy
```

## Deployment

The bot is configured for Vercel deployment:
- Uses Vercel PostgreSQL
- Express server provides the health check endpoint

After deploying a change that adds or removes slash commands, re-run the deploy script:
```bash
npx tsx deploy-commands.ts
```
It does a full `PUT` refresh of the guild's commands. Until it runs, removed commands stay visible
in Discord and fail with "The application did not respond".

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure `npm test`, `npm run lint` and `npm run typecheck` all pass
5. Submit a pull request

## Resources

- [Discord.js Guide](https://discordjs.guide/)
- [Discord Developer Portal](https://discord.com/developers/docs)
- [ESPN Fantasy API Documentation](https://github.com/cwendt94/espn-api)
- [Sleeper API Documentation](https://docs.sleeper.app/)
- [Polymarket Gamma API](https://docs.polymarket.com/)
- [Finnhub API](https://finnhub.io/docs/api)
