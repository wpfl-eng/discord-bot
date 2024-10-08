const matcher = /!scores/;
import pkg from "espn-fantasy-football-api/node.js";
const { Client } = pkg;
import {
  produceResponseObjectForText,
  produceImmediateResponse,
} from "../helpers/utils.js";
import { espnMembers } from "../constants/espnMembers.js";
import { differenceInHours } from "date-fns";

function isGetMatchupByWeek(splitCommand) {
  return (
    splitCommand.length === 2 && !isNaN(splitCommand[1]) && splitCommand[1] < 20
  );
}

function isGetMatchupByWeekAndYear(splitCommand) {
  return (
    splitCommand.length === 3 &&
    !isNaN(splitCommand[1]) &&
    !isNaN(splitCommand[2]) &&
    splitCommand[2] < 2050 &&
    splitCommand[1] < 20
  );
}

function getMatchup(matchupWeek, matchupYear) {
  if (matchupYear < 2018) {
    return produceImmediateResponse("Cant view activity before 2018");
  }
  let response = `Week ${matchupWeek} ${matchupYear} Scoring:\n`;
  console.log(matchupYear, matchupWeek);
  return new Promise(function (resolve, reject) {
    const myClient = new Client({
      leagueId: Number.parseInt(process.env.LEAGUE_ID),
    });
    myClient.setCookies({
      espnS2: process.env.ESPN_S2,
      SWID: process.env.SWID,
    });

    myClient
      .getBoxscoreForWeek({
        seasonId: Number.parseInt(matchupYear),
        matchupPeriodId: Number.parseInt(matchupWeek),
        scoringPeriodId: Number.parseInt(matchupWeek),
      })
      .then((matchups) => {
        console.log(matchups[0].homeRoster[0]);
        matchups.forEach((matchup) => {
          const homeMemberName = espnMembers.find(
            (member) => member.id === matchup.homeTeamId
          ).name;
          const awayMemberName = espnMembers.find(
            (member) => member.id === matchup.awayTeamId
          ).name;

          // Add scores to response
          response =
            response +
            `${homeMemberName}: ${matchup.homeScore} --- ${awayMemberName}: ${matchup.awayScore}\n`;
        });
        console.log(response);
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
  });
}

function helpMessage() {
  return produceImmediateResponse(
    "Usage:\n" +
      "!scores  # list scores of current week\n" +
      "!scores {week}  # view specific week score in current season\n" +
      "!scores {week} {year}  # view specific score in specific week\n" +
      "!scores help # return this message\n"
  );
}

function run(command, request) {
  const splitCommand = command.split(" ");
  let matchupYear = 2023;
  let matchupWeek = 1;

  if (command.trim() === "!scores") {
    // Weeks between First Tuesday of season until now
    const dateDiff =
      Math.floor(
        differenceInHours(new Date(), new Date(2023, 8, 1)) / (7 * 24)
      ) | 0;

    if (dateDiff >= 1) {
      matchupWeek = dateDiff;
    }
    return getMatchup(matchupWeek, matchupYear);
  }
  if (splitCommand.length === 2 && splitCommand[1] === "help") {
    return helpMessage();
  }
  if (isGetMatchupByWeek(splitCommand)) {
    matchupWeek = splitCommand[1];
    return getMatchup(matchupWeek, matchupYear);
  }
  if (isGetMatchupByWeekAndYear(splitCommand)) {
    matchupYear = splitCommand[2];
    matchupWeek = splitCommand[1];
    return getMatchup(matchupWeek, matchupYear);
  }
  return helpMessage();
}

export default {
  run,
  matcher,
};
