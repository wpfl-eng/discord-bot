import { getMatchups } from "../../api/sleeper/sleeper.js";
import {
  getCurrentNFLWeek,
  produceResponseObjectForText,
} from "../../helpers/utils.js";

var matcher = /!matchup/;

function run(command, request) {
  return new Promise((resolve, reject) => {
    try {
      const currentWeek = getCurrentNFLWeek();
      let response = `Matchups Week ${currentWeek}:\n`;
      getMatchups(currentWeek)
        .then((matchups) => {
          const groupedMatchups = matchups.groupByMatchupId();
          for (const matchupGroup of groupedMatchups) {
            const homeTeam = matchupGroup[0];
            const awayTeam = matchupGroup[1];
            response =
              response +
              `${homeTeam.name}: ${homeTeam.points} --- ${awayTeam.name}: ${awayTeam.points}\n`;
          }
          return resolve(produceResponseObjectForText(response));
        })
        .catch((err) => {
          console.error(err);
          return reject(
            produceResponseObjectForText(
              "API returned an error. You did something stupid or it's broken. Try again later"
            )
          );
        });
    } catch (e) {
      console.error(e);
      return reject(
        produceResponseObjectForText(
          "API returned an error. You did something stupid or it's broken. Try again later"
        )
      );
    }
  });
}

export default {
  run,
  matcher,
};
