import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "url";

// Make sure your .env is setup
// node deploy-commands.js
// Need clientId, guildId, token
// will look through /discordCommands/* as well as files directly in /discordCommands

const commands = [];
// Get the current file path and directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const foldersPath = path.join(__dirname, "discordCommands");

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

  console.log("Command Files:", commandFiles);
  console.log("Command Folders:", commandFolders);

  // Process command files in the root of discordCommands
  for (const file of commandFiles) {
    if (file.endsWith(".js")) {
      const filePath = path.join(foldersPath, file);
      const fileUrl = pathToFileURL(filePath).href;
      const command = await import(fileUrl);
      // Set a new item in the Collection with the key as the command name and the value as the exported module
      if ("data" in command && "execute" in command) {
        commands.push(command.data.toJSON());
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
      .filter((file) => file.endsWith(".js"));

    for (const file of folderCommandFiles) {
      const filePath = path.join(commandsPath, file);
      const fileUrl = pathToFileURL(filePath).href;
      const command = await import(fileUrl);
      // Set a new item in the Collection with the key as the command name and the value as the exported module
      if ("data" in command && "execute" in command) {
        commands.push(command.data.toJSON());
      } else {
        console.log(
          `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
        );
      }
    }
  }
} catch (err) {
  console.error("Error reading command folders:", err);
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// and deploy your commands!
(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`
    );

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );

    console.log(
      `Successfully reloaded ${data.length} application (/) commands.`
    );
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    console.error(error);
  }
})();
