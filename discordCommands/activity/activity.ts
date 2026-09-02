import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import pkg from 'espn-fantasy-football-api/node.js';
const { Client } = pkg;
import type { ActivityAction } from 'espn-fantasy-football-api/node.js';
import { espnMembers } from '../../constants/espnMembers.js';
import { getCurrentNFLSeason } from '../../helpers/utils.js';
import { formatDistanceToNow, subDays, format } from 'date-fns';

export const data = new SlashCommandBuilder()
  .setName('activity')
  .setDescription('Returns recent league transactions');

export const execute = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const { LEAGUE_ID, ESPN_S2, SWID } = process.env;
  if (!LEAGUE_ID || !ESPN_S2 || !SWID) {
    await interaction.reply({
      content: 'Missing required environment variables',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const myClient = new Client({ leagueId: Number.parseInt(LEAGUE_ID, 10) });
    myClient.setCookies({ espnS2: ESPN_S2, SWID });

    // The season, not the calendar year. In January and February -- the
    // fantasy playoffs and the championship -- they differ, and this asked
    // ESPN for a season that had not started yet.
    const currentSeason: number = getCurrentNFLSeason();
    const activityData: ActivityAction[][] = await myClient.getRecentActivity({
      seasonId: currentSeason,
    });

    const strResponse = formatActivityResponse(activityData);

    await interaction.editReply({ content: strResponse });
  } catch (error: unknown) {
    console.error('Activity command error:', error);
    await interaction.editReply({
      content: 'An error occurred while fetching league activity. Please try again later.',
    });
  }
};

const formatActivityResponse = (data: ActivityAction[][]): string => {
  const yesterday = subDays(new Date(), 1);
  let strResponse = 'League Activity in the past 24 hours:\n';

  const recentActivity = data
    .flatMap((activity) =>
      activity
        .filter((action) => new Date(action.date) >= yesterday)
        .map((action) => getActivityResponse(action))
    )
    .filter(Boolean);

  if (recentActivity.length > 0) {
    strResponse += recentActivity.join('');
  } else {
    strResponse = 'No activity in the past 24 hours.';
  }

  return strResponse.trim();
};

const getActivityResponse = (action: ActivityAction): string => {
  const { team, ids, bidAmount, date } = action;
  // `team` and `player` are both lookups the fork can miss: a message naming a team no longer in
  // the league, or a player neither on a roster nor returned by the player-card endpoint. The
  // 'Unknown' fallbacks were always here.
  const memberName = espnMembers.find((member) => member.id === team?.id)?.name ?? 'Unknown';
  // The fork resolves the name now, across both shapes an activity player can arrive in. Reading
  // it by hand here meant `playerPoolEntry?.player.fullName` -- unguarded at `.player`, so a
  // playerPoolEntry without a player threw inside the command.
  const playerName = action.playerName ?? 'Unknown Player';
  const activityTime = format(new Date(date), "MMM d, yyyy 'at' h:mm a");
  const timeAgo = formatDistanceToNow(new Date(date), { addSuffix: true });

  let actionString = '';
  switch (action.action) {
    case 'FA ADDED':
      actionString = `${memberName} added ${playerName} from Free Agency`;
      break;
    case 'DROPPED':
      actionString = `${memberName} dropped ${playerName}`;
      break;
    case 'TRADED': {
      const tradedTo = espnMembers.find((member) => member.id === ids.to)?.name ?? 'Unknown';
      actionString = `${memberName} traded ${playerName} to ${tradedTo}`;
      break;
    }
    case 'WAIVER ADDED':
      actionString = `${memberName} added ${playerName} from the waivers for $${bidAmount}`;
      break;
    default:
      return '';
  }

  return `${actionString} (${activityTime}, ${timeAgo})\n`;
};
