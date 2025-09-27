import { Configuration, OpenAIApi } from 'openai';
import { CensorSensor } from 'censor-sensor';
import ElevenLabs from 'elevenlabs-node';
import fetch from 'node-fetch';
import crypto from 'crypto';
import jsoning from 'jsoning';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { state } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const voice = new ElevenLabs({
  apiKey: process.env.elevenlabs_key,
  voiceId: process.env.elevenlabs_voice_id,
});

const censor = new CensorSensor();
censor.disableTier(2);
censor.disableTier(3);
censor.disableTier(4);
censor.disableTier(5);

const splotStates = {};
const hellfireSpotIds = new Set(['6']);
const heavenfireSpotIds = new Set();

const initializeSettings = () => {
  // Initialize settings from DB or environment variables
};

const get_random_splot = () => {
  const historical_splots_db = new jsoning("db/historical_splots.json");
  const historical_splots = historical_splots_db.all();
  const splot_values = Object.keys(historical_splots);
  const randomIndex = crypto.randomInt(splot_values.length);
  const random_splot = splot_values[randomIndex];
  return random_splot;
};

const abbadabbabotSay = async (channel, client, tags, message, prefix = "", postfix = "") => {
  console.log("ai_enabled", state.ai_enabled);
  if (state.ai_enabled) {
    const messageContent = `${tags.username}: ` + message;
    const newMessage = {
      role: "user",
      content: messageContent,
    };
    const messageArray = [
      {
        role: "system",
        content: process.env.openai_system_text_string,
      },
      newMessage,
    ];
    console.log("usermessage", messageArray);
    try {
      const response = await openai.createChatCompletion({
        model: process.env.openai_chatbot_model_id,
        messages: messageArray,
        temperature: 1.1,
        frequency_penalty: 0,
        presence_penalty: 0,
        user: tags.username,
      });
      const censored_response = removeURLs(
        censor.cleanProfanity(response.data.choices[0]["message"]["content"].trim())
      )
        .replace(/^Abbadabbabot: /, "")
        .replace(/^"|"$/g, "");

      const newResponse = {
        role: "assistant",
        content: censored_response,
      };
      client.say(channel, prefix + censored_response + postfix);
      return new Promise((resolve) => {
        resolve("resolved");
      });
    } catch (error) {
      state.ai_enabled = false;
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
        error = error.response.status;
      } else {
        console.log(error.message);
        error = error.message;
      }
      client.say(channel, prefix + "- ai offline - " + "prompt: " + message + postfix);
      return new Promise((resolve) => {
        resolve("resolved");
      });
    }
  } else {
    client.say(channel, prefix + "- ai offline - " + "prompt: " + message + postfix);
    return new Promise((resolve) => {
      resolve("resolved");
    });
  }
};

const say = (channel, client, tags, message, prefix = "", postfix = "") => {
  client.say(channel, prefix + message + postfix);
  return new Promise((resolve) => {
    resolve("resolved");
  });
};

const removeURLs = (text) => {
  return text.replace(/(https?:\/\/[^\s]+)/g, "");
};

const ordinal_suffix_of = (i) => {
  var j = i % 10,
    k = i % 100;
  if (j == 1 && k != 11) {
    return i + "st";
  }
  if (j == 2 && k != 12) {
    return i + "nd";
  }
  if (j == 3 && k != 13) {
    return i + "rd";
  }
  return i + "th";
};

const gen_and_play_tts = async (io, message, model = "eleven_multilingual_v2") => {
  const voiceResponse = await voice.textToSpeech({
    textInput: message,
    fileName: `./public/audio/output.mp3`,
    stability: 0.3,
    similarityBoost: 0.9,
    modelId: model,
    style: 0.3,
    responseType: "stream",
    speakerBoost: true,
  }).then((res) => {
    console.log("tts done");
    io.emit("play_tts", message);
  });
};

const getCustomMessage = (soundType) => {
    switch (soundType) {
      case 'lol':
        return "LUL";
      case 'clap':
        return "plsApplause";
      case 'fart':
        return "Someone let one rip! 💨";
      case 'moan':
        return "The crowd is feeling it! 🥵";
      case 'boo':
        return "The crowd is not happy! 😡";
      default:
        return soundType.charAt(0).toUpperCase() + soundType.slice(1);
    }
  };

export {
  splotStates,
  hellfireSpotIds,
  heavenfireSpotIds,
  initializeSettings,
  get_random_splot,
  abbadabbabotSay,
  say,
  removeURLs,
  ordinal_suffix_of,
  gen_and_play_tts,
  getCustomMessage
};
