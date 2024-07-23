var matcher = /!insult(s|\s.*)/;
import insults from "../constants/insults.js";

function run(command, request) {
  var splitCommand = command.split(" ");

  if (splitCommand.length >= 2) {
    var personToInsult = splitCommand[1];
    var newQuote =
      personToInsult +
      " " +
      insults[Math.floor(Math.random() * insults.length)];

    return {
      text: newQuote,
    };
  }
}

export default {
  run,
  matcher,
};
