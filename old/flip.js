const matcher = /!flip/;

function run(command, request) {
  const flip = Math.floor(Math.random() * 2) === 0 ? "heads" : "tails";
  return {
    text: flip,
  };
}

export default {
  run,
  matcher,
};
