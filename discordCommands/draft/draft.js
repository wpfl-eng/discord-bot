import { SlashCommandBuilder } from "discord.js";
import { formatInTimeZone } from "date-fns-tz";
import { intervalToDuration } from "date-fns";
import { enUS } from "date-fns/locale";

export const data = new SlashCommandBuilder()
  .setName("draft")
  .setDescription("Print a countdown for the draft");

export async function execute(interaction) {
  // Define the draft time
  const draftTime = new Date("2024-09-03T20:00:00-04:00"); // Date in EST
  const draftTimeZone = "America/New_York";

  // Get the current time in the draft's time zone
  const now = new Date();

  // Calculate the time remaining
  const duration = intervalToDuration({
    start: now,
    end: draftTime,
  });

  // Format the time remaining into a string
  const timeRemaining =
    `${duration.days} day${duration.days !== 1 ? "s" : ""} ` +
    `${duration.hours} hour${duration.hours !== 1 ? "s" : ""} ` +
    `${duration.minutes} minute${duration.minutes !== 1 ? "s" : ""}`;

  // Format the draft time in a readable format
  const formattedDraftTime = formatInTimeZone(
    draftTime,
    draftTimeZone,
    "MMMM d, yyyy 'at' h:mm a zzz",
    { locale: enUS }
  );

  // Prepare the response message
  const responseMessage = `
🏈 **Fantasy Football Draft Countdown** 🏈
    Draft Date: ${formattedDraftTime}
    Time Remaining: ${timeRemaining}

    May the odds be ever in your favor! 🍀
  `.trim();

  // Send the countdown message
  await interaction.reply({
    content: responseMessage,
    ephemeral: false,
  });
}
