import OpenAI from "openai";
import {
  produceResponseObjectForText,
  produceImmediateResponse,
} from "../helpers/utils.js";

const matcher = /!image/;

// function run(command, request) {
//   const chatString = command.split(" ").slice(1).join(" ");

//   if (chatString.length) {
//     return new Promise(function (resolve, reject) {
//       try {
//         const openai = new OpenAI({
//           apiKey: process.env.OPENAI_API_KEY, // This is also the default, can be omitted
//         });
//         const response = await openai.images.generate({
//           model: "dall-e-3",
//           prompt: chatString,
//           n: 1,
//           size: "1024x1024",
//         });
//         image_url = response.data[0].url;
//         return resolve(
//           produceResponseObjectForText(
//             image_url || "Talk to AJ something fucked up"
//           )
//         );
//       } catch (e) {
//         // reject(e);
//         return resolve(
//           produceResponseObjectForText("Talk to AJ something fucked up")
//         );
//       }
//     });
//   } else {
//     return produceImmediateResponse("How did you get here dumb dumb");
//   }
// }

async function run(command, request) {
  const chatString = command.split(" ").slice(1).join(" ");

  if (chatString.length) {
    try {
      const openai = new OpenAI({
        apiKey: process.env.OPEN_API_KEY, // This is also the default, can be omitted
      });
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: chatString,
        n: 1,
        size: "1024x1024",
      });

      const image_url = response.data[0].url;
      return produceResponseObjectForText(
        image_url || "Talk to AJ something went wrong returning a url"
      );
    } catch (e) {
      console.error("!image error: ", e);
      return produceResponseObjectForText(
        "Talk to AJ something went wrong on generation step"
      );
    }
  } else {
    return produceImmediateResponse("How did you get here dumb dumb");
  }
}

export default {
  run,
  matcher,
};
