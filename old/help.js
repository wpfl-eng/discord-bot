var matcher = /!help/;

function run(command, request) {
  return {
    text:
      "Commands:\n" +
      "!pins\n" +
      "!all\n" +
      "!roll\n" +
      "!flip\n" +
      "!ping\n" +
      "!insult\n" +
      "!scores\n" +
      "!closestScores\n" +
      "!standings\n" +
      "!trophies\n" +
      "!power\n" +
      "!activity\n" +
      "!giphy\n",
  };
}

export default {
  run,
  matcher,
};
