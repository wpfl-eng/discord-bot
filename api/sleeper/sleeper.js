import { sleeperMemebers } from "../../constants/sleeperMembers.js";

class Matchup {
  constructor(matchupData) {
    const memberInfo =
      sleeperMemebers.find(
        (member) => member.rosterId === matchupData.roster_id
      ) || {};
    this.name = memberInfo.name || "Unknown";

    this.starters = matchupData.starters;
    this.rosterId = matchupData.roster_id;
    this.players = matchupData.players;
    this.matchupId = matchupData.matchup_id;
    this.points = matchupData.points;
    this.customPoints = matchupData.custom_points;
  }
}

class Matchups extends Array {
  constructor(json) {
    super();
    json.forEach((matchupData) => {
      this.push(new Matchup(matchupData));
    });
  }

  groupByMatchupId() {
    const grouped = this.reduce((acc, obj) => {
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

export const getMatchups = async (week = 1) => {
  const response = await fetch(
    `https://api.sleeper.app/v1/league/${process.env.SLEEPER_LEAGUE_ID}/matchups/${week}`
  );
  const json = await response.json();
  return new Matchups(json);
};
