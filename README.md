# Commish Bot

Malevolently Robotting For Life - A Discord bot for fantasy football league management.

## Overview

CommishBot is a feature-rich Discord bot designed for fantasy football leagues. It integrates with ESPN and Sleeper fantasy platforms to provide standings, matchups, betting features, and various fun commands for league members.

## Prerequisites

- Node.js v20.15.1 or higher
- PostgreSQL database
- Discord bot application ([Create one here](https://discord.com/developers/applications))
- ESPN Fantasy Football league with API access
- Sleeper Fantasy Football league (optional)

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

Edit `.env` with your credentials:
- **Discord**: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- **ESPN Fantasy**: `ESPN_S2`, `SWID`, `LEAGUE_ID` 
- **Sleeper**: `SLEEPER_LEAGUE_ID`
- **Database**: PostgreSQL connection string
- **APIs**: `OPEN_API_KEY`, `API_KEY`, `BOT_ID`

4. Deploy slash commands to Discord:
```bash
node deploy-commands.js
```

## Running the Bot

### Development Mode
```bash
npm run dev
```
Uses nodemon for automatic restarts on file changes.

### Production Mode
```bash
npm start
```

The bot includes an Express server on port 5000 for health checks.

## Available Commands

- `/activity` - Activity tracking
- `/betcreate` - Create bets between league members
- `/betlist` - View active bets
- `/closestscores` - Find closest scoring matchups
- `/draft` - Draft-related features
- `/ewins` - Calculate expected wins
- `/flip` - Coin flip
- `/image` - Generate images
- `/optimal` - Show optimal lineup
- `/ping` - Test bot responsiveness
- `/roll` - Roll dice
- `/standings` - Display league standings
- `/trophies` - Weekly awards and achievements

## Development Guide

### Project Structure
```
discord-bot/
├── index.js              # Main entry point
├── discordCommands/      # Slash command implementations
│   └── commandname/
│       └── commandname.js
├── api/                  # External API integrations
│   └── sleeper/
├── constants/            # User mappings and static data
├── helpers/              # Utility functions
├── tests/                # Jest test files
└── sql/                  # Database schemas
```

### Creating a New Command

1. Create a new directory and file in `/discordCommands`:
```
discordCommands/
└── mycommand/
    └── mycommand.js
```

2. Implement the command with required exports:

```javascript
import { SlashCommandBuilder } from "discord.js";

// Define the slash command configuration
export const data = new SlashCommandBuilder()
  .setName("mycommand")
  .setDescription("Description of your command")
  .addStringOption((option) =>
    option
      .setName("parameter")
      .setDescription("Parameter description")
      .setRequired(true)
  );

// Handle command execution
export async function execute(interaction) {
  // Get option values
  const paramValue = interaction.options.getString("parameter");
  
  // Process command logic
  
  // Reply to the interaction
  await interaction.reply({ 
    content: "Response message", 
    ephemeral: true  // Set to false for public responses
  });
}
```

3. Deploy the new command:
```bash
node deploy-commands.js
```

### Working with External APIs

#### ESPN Fantasy Football
The bot uses a custom fork of the ESPN API:
```javascript
import { Client } from "espn-fantasy-football-api/node.js";

const espnClient = new Client({ leagueId: LEAGUE_ID });
espnClient.setCookies({ espnS2: ESPN_S2, SWID: SWID });
```

#### Sleeper API
Direct API calls to Sleeper:
```javascript
const response = await fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/...`);
```

### Database Operations

Uses PostgreSQL with Vercel's client:
```javascript
import { sql } from "@vercel/postgres";

// Example query
const result = await sql`SELECT * FROM pins WHERE id = ${pinId}`;
```

### Testing

Run tests with Jest:
```bash
npm test
```

Example test structure:
```javascript
import { execute } from "../discordCommands/mycommand/mycommand.js";

describe("MyCommand", () => {
  it("should return expected response", async () => {
    const mockInteraction = {
      options: {
        getString: jest.fn().mockReturnValue("test"),
      },
      reply: jest.fn(),
    };
    
    await execute(mockInteraction);
    
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("expected text"),
      ephemeral: true,
    });
  });
});
```

## Configuration

### Member Mappings
Update user mappings in:
- `/constants/espnMembers.js` - Maps ESPN team IDs to Discord users
- `/constants/sleeperMembers.js` - Maps Sleeper user IDs to names

### Bot Settings
The bot displays "Watching Jaguars Highlights" as its activity status. Modify in `index.js`.

## Deployment

The bot is configured for Vercel deployment:
- Uses Vercel PostgreSQL
- Includes `app.json` for deployment configuration
- Express server provides health check endpoint

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Resources

- [Discord.js Guide](https://discordjs.guide/)
- [Discord Developer Portal](https://discord.com/developers/docs)
- [ESPN Fantasy API Documentation](https://github.com/cwendt94/espn-api)
- [Sleeper API Documentation](https://docs.sleeper.app/)
