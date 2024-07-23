// import { Configuration, OpenAIApi } from "openai";
import {
  produceResponseObjectForText,
  produceImmediateResponse,
} from "../helpers/utils.js";

const matcher = /!chat/;

function run(command, request) {
  return {
    text: "pong",
  };
  // const chatString = command.split(" ").slice(1).join(" ");

  // if (chatString.length) {
  //   return new Promise(function (resolve, reject) {
  //     try {
  //       const configuration = new Configuration({
  //         apiKey: process.env.OPEN_API_KEY,
  //       });
  //       const openai = new OpenAIApi(configuration);

  //       openai
  //         .createChatCompletion({
  //           model: "gpt-3.5-turbo",
  //           max_tokens: 230,
  //           messages: [
  //             {
  //               role: "system",
  //               content:
  //                 "You are a helpful AI assistant to a fantasy football chatroom. You can only ever respond in 950 characters or less.",
  //             },
  //             {
  //               role: "user",
  //               content: chatString,
  //             },
  //           ],
  //         })
  //         .then((completion) => {
  //           const responseString =
  //             completion.data?.choices[0]?.message?.content;
  //           return resolve(
  //             produceResponseObjectForText(
  //               responseString || "Talk to AJ something fucked up"
  //             )
  //           );
  //         })
  //         .catch((e) => {
  //           console.error(e);
  //           // reject(e);
  //           return resolve(
  //             produceResponseObjectForText("Talk to AJ something fucked up")
  //           );
  //         });
  //     } catch (e) {
  //       // reject(e);
  //       return resolve(
  //         produceResponseObjectForText("Talk to AJ something fucked up")
  //       );
  //     }
  //   });
  // } else {
  //   return produceImmediateResponse("How did you get here dumb dumb");
  // }
}

export default {
  run,
  matcher,
};
