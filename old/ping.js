var matcher = /!ping/;

function run(command, request) {
  return {
    text: "pong",
  };
}

export default {
  run,
  matcher,
};
