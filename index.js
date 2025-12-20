import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
  Partials,
  EmbedBuilder,
} from "discord.js";
import { fileURLToPath, pathToFileURL } from "url";
import { TriviaService } from "./trivia/triviaService.js";
import { TrainingNotificationService } from "./training/trainingNotificationService.js";
import * as nflmonDb from "./nflmon/nflmonDb.js";
import * as nflmonService from "./nflmon/nflmonService.js";

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

// Initialize training notification service
const trainingNotificationService = new TrainingNotificationService(client);
client.trainingNotificationService = trainingNotificationService;

// When the client is ready, run this code (only once)
client.once("ready", () => {
  console.log("Ready!");
  triviaService.init();
  trainingNotificationService.init();
});

client.commands = new Collection();

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
        client.commands.set(command.data.name, command);
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
        client.commands.set(command.data.name, command);
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
// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);

// Trade error messages
const TRADE_ERRORS = {
  NOT_FOUND: "Trade not found.",
  NOT_RECIPIENT: "You cannot accept/reject this trade.",
  NOT_PENDING: "This trade is no longer pending.",
  EXPIRED: "This trade has expired.",
  FROM_NFLMON_UNAVAILABLE: "The offered NFLmon is no longer available.",
  FROM_NFLMON_TRAINING: "The offered NFLmon is in training.",
  TO_NFLMON_UNAVAILABLE: "The requested NFLmon is no longer available.",
  TO_NFLMON_TRAINING: "Your NFLmon is in training. Untrain it first.",
  INSUFFICIENT_COINS: "The sender no longer has enough coins.",
  TRANSACTION_FAILED: "Transaction failed. Please try again.",
};

/**
 * Handle NFLmon trade button interactions (accept/reject from DMs)
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleNflmonTradeButton(interaction) {
  try {
    const [, , action, tradeIdStr] = interaction.customId.split("_");
    const tradeId = parseInt(tradeIdStr);
    const userId = interaction.user.id;

    if (action === "accept") {
      const result = await nflmonDb.acceptTrade(userId, tradeId);

      if (!result.success) {
        const errorMsg = TRADE_ERRORS[result.error] || "Trade failed.";
        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff0000)
              .setTitle("Trade Failed")
              .setDescription(errorMsg),
          ],
          components: [],
        });
        return;
      }

      // Get player names for result
      const fromPlayer = nflmonService.getPlayer(result.fromNflmon.player_id);
      const toPlayer = result.toNflmon
        ? nflmonService.getPlayer(result.toNflmon.player_id)
        : null;

      const resultEmbed = nflmonService.buildTradeResultEmbed(
        true,
        fromPlayer,
        toPlayer,
        result.trade.coins_offered
      );

      await interaction.update({
        embeds: [resultEmbed],
        components: [],
      });

      // Announce trade completion publicly
      try {
        const channelId = process.env.GENERAL_CHANNEL_ID;
        if (channelId) {
          const channel = await interaction.client.channels.fetch(channelId);
          if (channel) {
            const fromName = fromPlayer?.name || "Unknown";
            const toName = toPlayer?.name;
            const announceEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("Trade Completed!")
              .setDescription(
                `**${result.trade.from_username}** traded **${fromName}** ` +
                  `to **${result.trade.to_username}**` +
                  (toName ? ` for **${toName}**` : "") +
                  (result.trade.coins_offered > 0 ? ` + ${result.trade.coins_offered} coins` : "")
              );
            await channel.send({ embeds: [announceEmbed] });
          }
        }
      } catch (announceError) {
        console.log("[NFLMON] Could not announce trade:", announceError.message);
      }
    } else if (action === "reject") {
      await nflmonDb.rejectTrade(userId, tradeId);

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x808080)
            .setTitle("Trade Rejected")
            .setDescription("You declined the trade offer."),
        ],
        components: [],
      });
    }
  } catch (error) {
    console.error("[NFLMON] Trade button error:", error);
    try {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("Error")
            .setDescription("An error occurred processing this trade."),
        ],
        components: [],
      });
    } catch (updateError) {
      // Button may have already been handled
      console.log("[NFLMON] Could not update trade button:", updateError.message);
    }
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle NFLmon trade button interactions (especially from DMs)
  if (interaction.isButton() && interaction.customId.startsWith("nflmon_trade_")) {
    await handleNflmonTradeButton(interaction);
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
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  }
});

// Handle DMs for trivia answers
client.on("messageCreate", async (message) => {
  if (message.guild === null && !message.author.bot) {
    await triviaService.handleDM(message);
  }
});

client.on("ready", () => {
  client.user.setActivity("Jaguars Highlights", {
    type: ActivityType.Watching,
  });
});

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("CommishBot, reporting for duty."));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}...`));
