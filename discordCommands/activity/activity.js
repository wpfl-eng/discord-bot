import { SlashCommandBuilder } from "discord.js";
import pkg from "espn-fantasy-football-api/node.js";
const { Client } = pkg;
import { espnMembers } from "../../constants/espnMembers.js";
import { formatDistanceToNow, subDays, format } from "date-fns";

// Define the slash command
export const data = new SlashCommandBuilder()
  .setName("activity")
  .setDescription("Returns recent league transactions");

// Main execution function for the slash command
export const execute = async (interaction) => {
  // Check for required environment variables
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    return await interaction.reply({
      content: "Missing required environment variables",
      ephemeral: true,
    });
  }

  // Defer the reply to allow for processing time
  await interaction.deferReply();

  try {
    // Initialize ESPN client
    const myClient = new Client({ leagueId: parseInt(LEAGUE_ID, 10) });
    myClient.setCookies({ espnS2: ESPN_S2, SWID });

    // Get the current year for the seasonId
    const currentYear = new Date().getFullYear();

    // Fetch recent activity data
    const data = await myClient.getRecentActivity({ seasonId: currentYear });

    // Format the activity response
    const strResponse = formatActivityResponse(data);

    // Send the formatted response
    await interaction.editReply({ content: strResponse });
  } catch (error) {
    console.error("Activity command error:", error);
    await interaction.editReply({
      content:
        "An error occurred while fetching league activity. Please try again later.",
      ephemeral: true,
    });
  }
};

// Format the activity data into a readable string
const formatActivityResponse = (data) => {
  const yesterday = subDays(new Date(), 1);
  let strResponse = "League Activity in the past 24 hours:\n";

  const recentActivity = data
    .flatMap((activity) =>
      activity
        .filter((action) => new Date(action.date) >= yesterday)
        .map((action) => getActivityResponse(action))
    )
    .filter(Boolean);

  if (recentActivity.length > 0) {
    strResponse += recentActivity.join("");
  } else {
    strResponse = "No activity in the past 24 hours.";
  }

  return strResponse.trim();
};

// Generate a response string for a single activity
const getActivityResponse = (action) => {
  const { team, ids, player, bidAmount, date } = action;
  const memberName =
    espnMembers.find((member) => member.id === team.id)?.name ?? "Unknown";
  const playerName =
    player.playerPoolEntry?.player.fullName ?? player.player.fullName;
  const activityTime = format(new Date(date), "MMM d, yyyy 'at' h:mm a");
  const timeAgo = formatDistanceToNow(new Date(date), { addSuffix: true });

  let actionString = "";
  switch (action.action) {
    case "FA ADDED":
      actionString = `${memberName} added ${playerName} from Free Agency`;
      break;
    case "DROPPED":
      actionString = `${memberName} dropped ${playerName}`;
      break;
    case "TRADED":
      const tradedTo =
        espnMembers.find((member) => member.id === ids.to)?.name ?? "Unknown";
      actionString = `${memberName} traded ${playerName} to ${tradedTo}`;
      break;
    case "WAIVER ADDED":
      actionString = `${memberName} added ${playerName} from the waivers for $${bidAmount}`;
      break;
    default:
      return "";
  }

  return `${actionString} (${activityTime}, ${timeAgo})\n`;
};
