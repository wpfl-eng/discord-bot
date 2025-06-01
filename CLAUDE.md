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

### Draft Trends Precomputation
The drafttrends command requires precomputed data. Run this after drafts or weekly during season:
```bash
node precompute-draft-trends.js
# Or with custom date range:
node precompute-draft-trends.js 2020 2024
```

### Discord Command Deployment
After adding or modifying slash commands, deploy them to Discord:
```bash
node deploy-commands.js
```

## Architecture

This is a Discord bot for fantasy football league management (CommishBot) that integrates with ESPN and Sleeper fantasy platforms.

### Core Structure
- **Entry point**: `index.js` - Initializes Discord client, loads commands dynamically, runs Express health check server
- **Commands**: Located in `/discordCommands/[commandname]/[commandname].js`
- **External APIs**: ESPN Fantasy Football (custom fork), Sleeper API, OpenAI
- **Database**: PostgreSQL via @vercel/postgres (tables: pins, Bets)

### Command Pattern
Each command must export:
```javascript
export const data = new SlashCommandBuilder()
  .setName("commandname")
  .setDescription("Description")
  // Add options as needed

export async function execute(interaction) {
  // Handle the interaction
  await interaction.reply({ content: "Response", ephemeral: true });
}
```

### Environment Configuration
Required environment variables (create `.env` from `.env.sample`):
- Discord: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- ESPN: `ESPN_S2`, `SWID`, `LEAGUE_ID`
- Sleeper: `SLEEPER_LEAGUE_ID`
- Database: PostgreSQL connection variables
- Other: `OPEN_API_KEY`, `API_KEY`, `BOT_ID`

### Key Dependencies
- `discord.js` v14 - Modern Discord bot framework
- Custom ESPN API fork: `git+https://github.com/aboorde/ESPN-Fantasy-Football-API.git`
- Direct Sleeper API calls to `api.sleeper.app`

### Testing
Uses Jest for unit testing. Tests are in `/tests` directory and mock external dependencies like the ESPN client.

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
