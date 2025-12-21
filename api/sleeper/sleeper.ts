import { sleeperMembers, type SleeperMember } from '../../constants/sleeperMembers.js';

/**
 * Raw matchup data from Sleeper API
 */
interface SleeperMatchupData {
  roster_id: number;
  matchup_id: number;
  points: number;
  starters: string[];
  players: string[];
  custom_points: number | null;
}

/**
 * Represents a single matchup team
 */
class Matchup {
  name: string;
  starters: string[];
  rosterId: number;
  players: string[];
  matchupId: number;
  points: number;
  customPoints: number | null;

  constructor(matchupData: SleeperMatchupData) {
    const memberInfo: SleeperMember | undefined = sleeperMembers.find(
      (member) => member.rosterId === matchupData.roster_id
    );
    this.name = memberInfo?.name ?? 'Unknown';

    this.starters = matchupData.starters;
    this.rosterId = matchupData.roster_id;
    this.players = matchupData.players;
    this.matchupId = matchupData.matchup_id;
    this.points = matchupData.points;
    this.customPoints = matchupData.custom_points;
  }
}

/**
 * Collection of matchups with grouping capability
 */
class Matchups extends Array<Matchup> {
  constructor(json: SleeperMatchupData[]) {
    super();
    json.forEach((matchupData) => {
      this.push(new Matchup(matchupData));
    });
  }

  groupByMatchupId(): Matchup[][] {
    const grouped = this.reduce<Record<number, Matchup[]>>((acc, obj) => {
      if (!acc[obj.matchupId]) {
        acc[obj.matchupId] = [];
      }
      acc[obj.matchupId].push(obj);
      return acc;
    }, {});

    return Object.values(grouped).map((group) => {
      if (group.length === 2) {
        return [group[0], group[1]];
      }
      // If there are not exactly 2 matchups with the same matchupId,
      // just return the group as is.
      return group;
    });
  }
}

export async function getMatchups(week: number = 1): Promise<Matchups> {
  const response = await fetch(
    `https://api.sleeper.app/v1/league/${process.env.SLEEPER_LEAGUE_ID}/matchups/${week}`
  );
  const json = (await response.json()) as SleeperMatchupData[];
  return new Matchups(json);
}

export { Matchup, Matchups, type SleeperMatchupData };
