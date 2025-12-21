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

  // Separate files and directories
  const commandFiles = commandEntries.filter((entry) =>
    fs.statSync(path.join(foldersPath, entry)).isFile()
  );
  const commandFolders = commandEntries.filter((entry) =>
    fs.statSync(path.join(foldersPath, entry)).isDirectory()
  );

  console.log('Command Files:', commandFiles);
  console.log('Command Folders:', commandFolders);

  // Process command files in the root of discordCommands
  for (const file of commandFiles) {
    if (file.endsWith('.js') || file.endsWith('.ts')) {
      const filePath = path.join(foldersPath, file);
      const fileUrl = pathToFileURL(filePath).href;
      const commandModule = await import(fileUrl);
      // Validate before using the command
      if (isValidCommandModule(commandModule)) {
        commands.push(commandModule.data.toJSON());
      } else {
        console.log(
          `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
        );
      }
    }
  }

  // Process command files in subdirectories
  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const folderCommandFiles = fs
      .readdirSync(commandsPath)
      .filter((file) => file.endsWith('.js') || file.endsWith('.ts'));

    for (const file of folderCommandFiles) {
      const filePath = path.join(commandsPath, file);
      const fileUrl = pathToFileURL(filePath).href;
      const commandModule = await import(fileUrl);
      // Validate before using the command
      if (isValidCommandModule(commandModule)) {
        commands.push(commandModule.data.toJSON());
      } else {
        console.log(
          `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
        );
      }
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
