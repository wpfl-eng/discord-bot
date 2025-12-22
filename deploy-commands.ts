import 'dotenv/config';
import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'url';
import { isValidCommandModule } from './types/commands.js';

// Make sure your .env is setup
// npx tsx deploy-commands.ts
// Need clientId, guildId, token
// will look through /discordCommands/* as well as files directly in /discordCommands

const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
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

  // Process import results
  for (const { filePath, module, error } of importResults) {
    if (error) {
      console.error(`[ERROR] Failed to import ${filePath}:`, error);
      continue;
    }
    if (isValidCommandModule(module)) {
      commands.push(module.data.toJSON());
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
      );
    }
  }
} catch (err) {
  console.error('Error reading command folders:', err);
}

// Validate required environment variables
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  console.error('Error: DISCORD_TOKEN environment variable is not set');
  process.exit(1);
}

if (!clientId || !guildId) {
  console.error('Error: DISCORD_CLIENT_ID and DISCORD_GUILD_ID environment variables must be set');
  process.exit(1);
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    if (Array.isArray(data)) {
      console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } else {
      console.log('Successfully refreshed application commands.');
    }
    process.exit(0);
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    console.error(error);
    process.exit(1);
  }
})();
