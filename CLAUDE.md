# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules - DO NOT VIOLATE

- **NEVER create mock data or simplified components** unless explicitly told to do so

- **NEVER replace existing complex components with simplified versions** - always fix the actual problem

- **ALWAYS work with the existing codebase** - do not create new simplified alternatives

- **ALWAYS find and fix the root cause** of issues instead of creating workarounds

- When debugging issues, focus on fixing the existing implementation, not replacing it

- When something doesn't work, debug and fix it - don't start over with a simple version

- DO NOT WORRY ABOUT SLEEPER. WE ARENT DOING SLEEPER.

- Ultrathink and use sequential thinking

## TypeScript and Linting

- ALWAYS add explicit types to all function parameters, variables, and return types

- Fix all linter and TypeScript errors immediately - don't leave them for the user to fix

- When making changes to multiple files, check each one for type errors

**MANDATORY BEHAVIOR:**
1. **Acknowledge limitations**: Always state explicitly when files are too large to read completely. Never pretend to have read the entire file if you couldn't.
2. **Fix ONLY what is explicitly requested** - no additional "improvements" or optimizations without permission
3. **Never assume existing code needs improvement** - production code exists as-is for reasons that may not be immediately apparent
4. **Always explain WHY before suggesting changes** - provide clear reasoning for any proposed improvements

**ALLOWED:** 
- Suggesting improvements IF you explain the specific benefits and risks clearly
- Asking "I notice X, would it be beneficial to fix this because Y?"

1. **Evidence-based responses only**: Never claim arelationship without direct evidence from the code.
 
2. **Clear source tracking**: Always cite line numbers and file paths for any statements about code structure.
 
3. **Query limitations**: State what you were not able to check, and what searches might still be needed for complete confidence.
 
4. **Confidence levels**: Use explicit confidence indicators:
   - "Confirmed" (when directly observed in code)
   - "Likely" (when inferred from strong evidence)
   - "Possible" (when suggested by partial evidence)
   - "Unknown" (when no evidence was found)

## Commands

### Discord Command Deployment
After adding or modifying slash commands, deploy them to Discord:
```bash
npx tsx deploy-commands.ts
```

### Development
```bash
npm run dev        # tsx watch index.ts
npm start          # tsx index.ts
npm test           # Jest
npm run lint       # ESLint (lint:fix to autofix)
npm run typecheck  # tsc --noEmit
npm run format     # Prettier (format:check to verify)
```

There is no build step — TypeScript runs directly through `tsx`.

## Architecture

This is a Discord bot for fantasy football league management (CommishBot). It pulls league data from
ESPN and the WPFL history API, and layers on a virtual economy: casino games, collectibles,
prediction markets, stock trading, trivia, and Wordle. It also answers open-ended league questions
through `/ask`, an agent built on the Claude Agent SDK. 48 slash commands are registered.

### Core Structure
- **Entry point**: `index.ts` - Initializes Discord client, loads commands dynamically, routes button/autocomplete/DM interactions, runs Express health check server
- **Commands**: Located in `/discordCommands/[commandname]/[commandname].ts`
- **External APIs**: ESPN Fantasy Football (custom fork), WPFL history API, Polymarket Gamma API, Finnhub, Sleeper API, OpenAI
- **Database**: PostgreSQL via @vercel/postgres (~25 tables; schemas in `/sql`, numbered
  migrations in `/migrations`). **There is no migration runner and no tracking table** -
  nothing anywhere records which migrations have been applied.

  That means applied-state is only knowable by inspecting the schema for a migration's
  effects: 008 is applied iff the `nflmon_*` tables are gone, 009 iff
  `economy_users.wallet` is `bigint` rather than `integer`, 013 iff `casino_table_state`
  exists. Check before assuming - **do not record applied-state in this file.** This
  bullet previously asserted 008 was "deliberately NOT applied" long after it had in fact
  been applied, and that claim was repeated downstream as fact.

  Apply one with `npx tsx scripts/runMigration.ts <file>` (`--dry-run` prints the SQL
  without executing). Files are written to be idempotent (`IF EXISTS` / `IF NOT EXISTS`).

  Two carry traps:
  - `008_remove_nflmon_rob_training.sql` is **irreversible** - it drops NFLmon
    collections, stats and trade history. `scripts/backupMigration008.ts` dumps the data
    first. The bot runs correctly either way; no code references those tables.
  - `009_widen_economy_money_columns.sql` must ship **with** `db/pgTypes.ts`.
    node-postgres returns BIGINT as a *string*, so applying 009 without that module
    silently turns `EconomyUser.wallet` into a string while TypeScript still declares it
    a number, and `wallet + amount` concatenates instead of adding. `pgTypes` is
    side-effect imported at the top of `index.ts`.

  `010`-`013` (casino) carry no such trap - they only add stats columns and the
  table-persistence table, and every game plays correctly without them.
- **Misc Data**: `/data`

### Feature Modules
Shared logic lives outside `/discordCommands` so multiple commands can use it:
- `economy/` - `economyConfig.ts` (all payout/cooldown/limit tuning) and `economyDb.ts`
- `achievements/` - 8 achievements awarded off 18 action types; `checkForAchievements` is called from game commands
- `inventory/` - item definitions and inventory DB (only the Wordle Lucky Letter has a live source)
- `trivia/` - `triviaService.ts` (cron scheduler), `categoryLoader.ts`, `answerMatcher.ts`, `*Questions.json` banks
- `wordle/`, `stock/`, `polymarket/` - config + DB + API client per feature
- `blackjack/`, `craps/`, `redzone/`, `videopoker/` - per-game stats DB modules
- `ask/` - the `/ask` agent: `askConfig.ts` (all tuning, including model), `askAuth.ts`,
  `askDb.ts`, `askRunner.ts`, `caps.ts`, `concurrency.ts`, `hooks.ts`, `systemPrompt.ts`,
  `ticker.ts`
- `wpfl/` - the data layer behind `/ask`: artifact fetch and shred, `INDEX.md` generation, the
  cached WPFL decade, the read-only DuckDB SQL tool, the ESPN and WPFL API tools, and the
  in-process MCP server that exposes all eight
- `errors/`, `helpers/`, `constants/`, `types/` - shared support code

Some features keep their config next to the command instead: `discordCommands/roulette/`,
`discordCommands/craps/` and `discordCommands/blackjack/` each hold their own `*Config.ts`
or `*Utils.ts`, `*State.ts`, `*Render.ts` and engine files.

`casino/` holds what all three table games share: one palette (`casinoTheme`), one
currency formatter (`casinoFormat`), the Components V2 builders and budget guards
(`casinoRender`), board painting (`casinoPaint`), modals (`casinoModal`), result-frame
pacing (`casinoPacing`), rendered hero images (`casinoHero`), the cross-game hub
(`casinoHub`), and between-round persistence (`casinoPersistence`, `casinoBoot`).

### Command Loading
Both `index.ts` and `deploy-commands.ts` scan `discordCommands/` and, for each folder, import **only**
the file whose basename matches the folder name (case-insensitive). That is why
`videopoker/videoPoker.ts` loads while `videoPokerUtils.ts` and `videoPokerDb.ts` are skipped. If no
file matches the folder name, every `.ts`/`.js` file in the folder is imported as a fallback.
Modules are validated by `isValidCommandModule` (`types/commands.ts`) — anything missing `data` or
`execute` is logged and skipped.

Folder name does not have to equal command name: `checkpredictions/` registers `/check-predictions`
and `mypredictions/` registers `/my-predictions`.

### Background Behavior
- **`/ask` freshness and continuation** - no timers. The published artifact is re-fetched lazily
  (etag check, 6h staleness window) on `ready` and at the top of every `/ask`; ordinary messages
  in an `/ask` thread continue that agent session through `messageCreate`
- **Trivia scheduler** (`trivia/triviaService.ts:150`) - cron in `America/New_York`; posts at 9/11/13/15/17/19/21, auto-closes each 2h later, season rollover at midnight on the 1st
- **Trivia DMs** - `messageCreate` handler accepts answers sent to the bot directly
- **Roulette auto-spin** - rounds spin on a timer in `discordCommands/roulette/rouletteState.ts`
- **Craps shooter** - the shooter throws with a ROLL button; the table rolls for them
  after a grace period, and the dice pass on a seven-out only
- **Blackjack table** - one shared multi-seat table; every seat acts at once on a shared
  clock, and stakes ride between rounds until changed
- **Casino hub** - a summary of all three tables refreshed in `ECONOMY_CASINO_CHANNEL_ID`
- **Autocomplete** - `/craps`, `/roulette`, `/inventory`, `/triviaquestion` export an `autocomplete` handler dispatched by `index.ts`

### Command Pattern
Each command must export:
```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName("commandname")
  .setDescription("Description")
  // Add options as needed

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Handle the interaction
  await interaction.reply({ content: "Response", ephemeral: true });
}
```

### Environment Configuration
Required environment variables (create `.env` from `.env.sample`):
- Discord: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- ESPN: `ESPN_S2`, `SWID`, `LEAGUE_ID`
- Sleeper: `SLEEPER_LEAGUE_ID`
- Database: PostgreSQL connection variables (`POSTGRES_*`)
- `/ask`: `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_OAUTH_TOKEN` (the key wins if both are set);
  optional `WPFL_DATA_DIR` (defaults to `$HOME/wpfl-data`)
- Stock: `FINNHUB_API_KEY`
- Trivia: `TRIVIA_CHANNEL_ID`, `TRIVIA_ADMIN_USER_IDS` (comma-separated; gates `/triviaquestion`)
- Channels: `ECONOMY_TOWN_SQUARE_CHANNEL_ID`, `ECONOMY_CASINO_CHANNEL_ID` (casino hub),
  `ROULETTE_CHANNEL_ID`, `CRAPS_CHANNEL_ID`, `BLACKJACK_CHANNEL_ID`
- Other: `OPEN_API_KEY`, `PORT`, `API_KEY`, `BOT_ID`

### Key Dependencies
- `discord.js` v14 - Modern Discord bot framework
- `tsx` - runs TypeScript directly, no build step
- `node-cron` - trivia scheduling
- `@anthropic-ai/claude-agent-sdk` - the `/ask` agent runtime (ships a native binary as an
  optional dependency; never install with `--omit=optional`)
- `@duckdb/node-api` - read-only SQL over the shredded artifact and the cached WPFL decade
  (also a native optional dependency)
- `zod` - tool input schemas for the MCP server
- `@vercel/postgres` - database access
- Custom ESPN API fork: `git+https://github.com/aboorde/ESPN-Fantasy-Football-API.git`
- Direct Sleeper API calls to `api.sleeper.app`

### Testing
Uses Jest for unit testing. Tests are in `/tests`, organized as `config/`, `helpers/`, `services/`,
`trivia/` and `utils/`. They cover pure config and utility modules plus mocked services; external
dependencies like the ESPN client and the database are mocked.

## APIs you have access to 
- Custom ESPN API fork: `git+https://github.com/aboorde/ESPN-Fantasy-Football-API.git`

OVERALL YEAR MIN 2015

- https://wpflapi.azurewebsites.net/api/expectedwins?seasonMax=2024&seasonMin=2024&includePlayoffs=false
-- Sample response
```
[
  {
    "owner": "AJ Boorde",
    "expectedWins": 10.67,
    "actualWins": 12.00,
    "seasonMin": 2024,
    "seasonMax": 2024,
    "weekMin": 1,
    "weekMax": 17
  },
  {
    "owner": "David Adler",
    "expectedWins": 10.52,
    "actualWins": 9.00,
    "seasonMin": 2024,
    "seasonMax": 2024,
    "weekMin": 1,
    "weekMax": 17
  },
  ...
]
```

- https://wpflapi.azurewebsites.net/api/optimalcoaching/pointsfor/2024?week=16
-- sample response
```
[
  {
    "owner": "AJ Boorde",
    "actualPointsFor": 1806.16,
    "optimalPointsFor": 1910.00,
    "season": 2024,
    "week": 16
  },
  ...
]
```
for optimalcoaching, the api returns the aggregate of the week prior, so week 1 will just be week 1 and week 18 is all weeks combined




- https://wpflapi.azurewebsites.net/api/draft/draftedpoints?seasonMin=2024&seasonMax=2024&weekMax=15
-- sample response
```
[
  {
    "owner": "AJ Boorde",
    "draftedPoints": 1195.12,
    "rosteredOptimalPoints": 0.0,
    "actualPoints": 0.0
  },
  ...
]
```

- https://wpflapi.azurewebsites.net/api/draft/history?seasonMax=2024&seasonMin=2020&draftPositionMin=1&draftPositionMax=6&auctionValueMin=20&auctionValueMax=100&playerNflPosition=WR&playerNflTeam=Cin&owner=Nixon%20Ball
-- response 
```
[
  {
    "id": 3580,
    "owner": "Nixon Ball",
    "player": "Ja'Marr Chase",
    "playerNflTeam": "CIN",
    "playerNflPosition": "WR",
    "averageDraftPosition": null,
    "league": "WPFL",
    "draftPosition": 5,
    "auctionValue": 69,
    "season": 2024
  },
  ...
]
```

- https://wpflapi.azurewebsites.net/api/fantasyMatchupWinners?seasonMax=2023&seasonMin=2021&weekMax=5&weekMin=3
-- response
```
[
  {
    "id": 2271,
    "week": "3",
    "season": "2021",
    "teamA": "Mike Simpson",
    "teamAPoints": 87.040,
    "teamB": "Todd Ellis",
    "teamBPoints": 82.240,
    "homeTeam": "Todd Ellis",
    "isPlayoffs": false,
    "fantasyLeague": "WPFL",
    "margin": 4.800
  },
  ...
]
```

- https://wpflapi.azurewebsites.net/api/playerscores?seasonMin=2021&seasonMax=2024&weekMin=1&weekMax=6&rosterSlot=&playerNflPosition=QB&playerNflTeam=Jax
-- response
```
[
    {
        "playerScoreId": 27498,
        "owner": "David Adler",
        "player": "Trevor Lawrence",
        "week": 1,
        "season": 2021,
        "playerOpponent": "HOU",
        "playerHome": "0",
        "points": 19.080,
        "rosterSlot": "QB",
        "playerNflTeam": "JAX",
        "playerNflPosition": "QB",
        "fantasyLeague": "WPFL"
    },
    {
        "playerScoreId": 27656,
        "owner": "David Adler",
        "player": "Trevor Lawrence",
        "week": 2,
        "season": 2021,
        "playerOpponent": "DEN",
        "playerHome": "1",
        "points": 6.820,
        "rosterSlot": "BE",
        "playerNflTeam": "JAX",
        "playerNflPosition": "QB",
        "fantasyLeague": "WPFL"
    },
]
```

- https://wpflapi.azurewebsites.net/api/draft/history?seasonMax=2024&seasonMin=2015
-- response
```
[
      {
        "id": 961,
        "owner": "Jimmy Simpson",
        "player": "Le'Veon Bell",
        "playerNflTeam": "Pit",
        "playerNflPosition": "RB",
        "averageDraftPosition": null,
        "league": "WPFL",
        "draftPosition": 1,
        "auctionValue": null,
        "season": 2015
    },
    {
        "id": 962,
        "owner": "Nixon Ball",
        "player": "Eddie Lacy",
        "playerNflTeam": "GB",
        "playerNflPosition": "RB  ",
        "averageDraftPosition": null,
        "league": "WPFL",
        "draftPosition": 2,
        "auctionValue": null,
        "season": 2015
    },
    ...
]

Important information regarding data from these endpoints
-- 2010-2024 is the current data extractable from the endpoint
-- 2015 is the start of tracking player data
-- 2016 is the first year of auction draft
