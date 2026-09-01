import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Collection, GatewayIntentBits, Events, ActivityType, Partials } from 'discord.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { TriviaService } from './trivia/triviaService.js';
import { isValidCommandModule } from './types/commands.js';
import {
  continueThread,
  checkIdentityMapping,
  onThreadArchived,
} from './discordCommands/ask/ask.js';
import { ensureFresh } from './wpfl/artifactSync.js';
import { logError } from './errors/errorHandler.js';

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// Initialize trivia service and attach to client for command access
const triviaService = new TriviaService(client);
client.triviaService = triviaService;

// When the client is ready, run this code (only once)
client.once('ready', async () => {
  console.log('Ready!');
  triviaService.init();

  // /ask setup. Both are non-fatal: a stale shred still answers, and an
  // unresolved snowflake only costs that member their implicit "my team".
  // They share nothing, and the sync can take seconds, so they run together
  // rather than holding boot one behind the other.
  const guildId: string | undefined = process.env.DISCORD_GUILD_ID;
  await Promise.all([
    (async (): Promise<void> => {
      if (guildId === undefined) return;
      try {
        await checkIdentityMapping(await client.guilds.fetch(guildId));
      } catch (error) {
        logError('ask', 'Could not verify the league identity mapping', error);
      }
    })(),
    (async (): Promise<void> => {
      try {
        console.log('[ASK] Artifact sync:', JSON.stringify(await ensureFresh()));
      } catch (error) {
        logError('ask', 'Artifact sync failed at startup', error);
      }
    })(),
  ]);
});

client.commands = new Collection();

// Get the current file path and directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const foldersPath = path.join(__dirname, 'discordCommands');

try {
  // Read the content of the discordCommands folder
  const commandEntries = fs.readdirSync(foldersPath);

  // Optimization 1: Single-pass stat - one stat call per entry instead of two
  const commandFiles: string[] = [];
  const commandFolders: string[] = [];

  for (const entry of commandEntries) {
    const stat = fs.statSync(path.join(foldersPath, entry));
    if (stat.isFile()) {
      commandFiles.push(entry);
    } else if (stat.isDirectory()) {
      commandFolders.push(entry);
    }
  }

  console.log('Command Files:', commandFiles);
  console.log('Command Folders:', commandFolders);

  // Collect all command file paths for parallel import
  const commandFilePaths: string[] = [];

  // Add root command files (files directly in discordCommands/)
  for (const file of commandFiles) {
    if (file.endsWith('.js') || file.endsWith('.ts')) {
      commandFilePaths.push(path.join(foldersPath, file));
    }
  }

  // Optimization 2: Smart command file detection - only import main command file per folder
  for (const folder of commandFolders) {
    const folderPath = path.join(foldersPath, folder);
    const folderFiles = fs
      .readdirSync(folderPath)
      .filter((file) => file.endsWith('.js') || file.endsWith('.ts'));

    // Find main command file: match folder name (case-insensitive)
    const mainCommandFile = folderFiles.find((file) => {
      const baseName = path.basename(file, path.extname(file)).toLowerCase();
      return baseName === folder.toLowerCase();
    });

    if (mainCommandFile) {
      // Only add the main command file, skip utility files
      commandFilePaths.push(path.join(folderPath, mainCommandFile));
    } else {
      // Fallback: if no match, add all files (maintains compatibility)
      console.log(`[INFO] No main command file found for folder: ${folder}, scanning all files`);
      for (const file of folderFiles) {
        commandFilePaths.push(path.join(folderPath, file));
      }
    }
  }

  console.log(`Loading ${commandFilePaths.length} command files...`);

  // Optimization 3: Parallel imports - import all files concurrently
  const importResults = await Promise.all(
    commandFilePaths.map(async (filePath) => {
      const fileUrl = pathToFileURL(filePath).href;
      try {
        const module = await import(fileUrl);
        return { filePath, module, error: null };
      } catch (error) {
        return { filePath, module: null, error };
      }
    })
  );

  // Process import results and register commands
  for (const { filePath, module, error } of importResults) {
    if (error) {
      console.error(`[ERROR] Failed to import ${filePath}:`, error);
      continue;
    }
    if (isValidCommandModule(module)) {
      client.commands.set(module.data.name, module);
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
      );
    }
  }
} catch (err) {
  console.error('Error reading command folders:', err);
}
// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle button interactions for trivia
  if (interaction.isButton() && interaction.customId.startsWith('trivia_')) {
    const triviaService = client.triviaService;
    if (triviaService) {
      try {
        await triviaService.handleButtonAnswer(interaction);
      } catch (error) {
        console.error('[TRIVIA] Button handler error:', error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'An error occurred processing your answer. Please try again.',
              ephemeral: true,
            });
          }
        } catch (replyError) {
          // Interaction may have expired
          console.error('[TRIVIA] Could not send error reply:', replyError);
        }
      }
    }
    return;
  }

  // Handle autocomplete interactions
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Autocomplete error for ${interaction.commandName}:`, error);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    }
  }
});

// Handle DMs for trivia answers, and ordinary messages in an /ask thread
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.guild === null) {
    await triviaService.handleDM(message);
    return;
  }

  // An /ask thread continues as ordinary conversation (design §6.2). This runs
  // on every guild message, so the cheap checks come first and the database is
  // only consulted once they pass.
  try {
    await continueThread(message);
  } catch (error) {
    logError('ask', 'Thread continuation failed', error);
  }
});

// An archived thread's session is closed rather than resumed (design §6.2):
// the SDK prunes its transcript on its own schedule, so resuming one that has
// aged out fails instead of starting fresh.
client.on(Events.ThreadUpdate, async (before, after) => {
  await onThreadArchived(before, after);
});

client.on('ready', () => {
  client.user?.setActivity('Jaguars Highlights', {
    type: ActivityType.Watching,
  });
});

const app = express();
app.use(express.json());

app.get('/', (_req: Request, res: Response) => res.send('CommishBot, reporting for duty.'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}...`));
