import tmi from 'tmi.js';
import dotenv from 'dotenv';
import { io as streamLabsIo } from 'socket.io-client';
import { state } from './constants.js';
import { Configuration, OpenAIApi } from 'openai';
import { CensorSensor } from 'censor-sensor';
import { abbadabbabotSay } from './utils.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import {
  handleJoinCommand,
  handleLeaveCommand,
  handleNextCommand,
  handleRandomCommand,
  handlePositionCommand
} from './commands/queueCommands.js';

import {
  handleOpenCommand,
  handleCloseCommand,
  handleFirstsFirstCommand,
  handleClearAllCommand,
  handleClearTurnsCommand,
  handleClearCommand,
  handleAutoPickCommand
} from './commands/queueManagement.js';

import {
  handleSubTracker,
  handleBitTracker,
  handleDonationTracker,
  handleSpinTracker
} from './commands/trackerCommands.js';

import {
  handleCrowdSoundCommand,
  handleDedCommand,
  handleDedCountCommand,
  handleDedResetCommand,
  handleDedSetCommand,
  handleWakeupCommand
} from './commands/miscCommands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);
const censor = new CensorSensor();
censor.disableTier(2);
censor.disableTier(3);
censor.disableTier(4);
censor.disableTier(5);

const bot_display_name = process.env.bot_account;

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.bot_account,
    password: process.env.oauth,
  },
  channels: [process.env.twitch_channel],
});

const streamlabsSocket = streamLabsIo(
  `https://sockets.streamlabs.com?token=${process.env.streamlabs_socket_token}`,
  {transports: ['websocket']}
);

function initializeBotCommands(io) {
  client.connect();

  // Special bit amounts for effects
  client.on("cheer", async (channel, userstate, message) => {
    console.log('userstate of cheer', userstate);
    if(userstate.bits == 99) io.emit('kermit_sex', userstate);
    if(userstate.bits == 399) io.emit('jarjar', userstate);
    if(userstate.bits == 299) io.emit('draculaAngel', userstate);
    if(userstate.bits == 450) io.emit('ash_spit', userstate);
    
    // Track bits for stats but don't add time (now handled by EventSub)
    await handleBitTracker(userstate.bits, io);
  });

  // Subscription events
  client.on("subscription", async (channel, username, method, message, userstate) => {
    // Add 5 minutes for new sub
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      //await socketHandlers.handleSubathonAddTime(5 * 60, `sub_${username}`, io);
    } else {
      console.error('Socket handlers not found for subscription');
    }
    handleSubTracker(1, io);
  });
  
  client.on("resub", async (channel, username, months, message, userstate, methods) => {
    // Add 5 minutes for resub
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      //await socketHandlers.handleSubathonAddTime(5 * 60, `resub_${username}_${months}m`, io);
    } else {
      console.error('Socket handlers not found for resub');
    }
    handleSubTracker(1, io);
  });
  
  client.on("subgift", async (channel, username, streakMonths, recipient, methods, userstate) => {
    // Add 5 minutes for gift sub
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      //await socketHandlers.handleSubathonAddTime(5 * 60, `giftsub_from_${username}_to_${recipient}`, io);
    } else {
      console.error('Socket handlers not found for gift sub');
    }
    handleSubTracker(1, io);
  });

  // Message handling
  client.on("message", async (channel, tags, message, self) => {
    const isMod = tags.mod || tags["user-type"] === "mod";
    const isBroadcaster = ["abbabox", "zilchgnu"].includes(tags.username);
    const isModUp = isMod || isBroadcaster;
    try {
      // Handle Tangia messages
      if (tags.username === 'tangiabot' && message.includes('sent') && message.includes('with Tangia')) {
        const socketHandlers = global.app.get('socketHandlers');
        if (socketHandlers && socketHandlers.handleSubathonAddTime) {
          // Add 1 minute (equivalent to 100 bits)
          await socketHandlers.handleSubathonAddTime(60, 'tangia_alert', io);
        } else {
          console.error('Socket handlers not found for Tangia alert');
        }
      }
      //Special abbadabbabot
      if (message.toLowerCase().startsWith("!abbadabbabot")) {
        if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
          var stripped_message = message.replace('!abbadabbabot ','');
          const abbabot_response = abbadabbabotSay(channel, client, tags, stripped_message);
        }
      }
      // Queue Commands
      if (message.toLowerCase().startsWith("!join")) {
        await handleJoinCommand(channel, tags, client);
      }
      if (message.toLowerCase().startsWith("!leave")) {
        await handleLeaveCommand(channel, tags, client);
      }
      if (message.toLowerCase().startsWith("!next") && isModUp) {
        await handleNextCommand(channel, tags, client, io);
      }
      if (message.toLowerCase().startsWith("!random") && isModUp) {
        await handleRandomCommand(channel, tags, client, io);
      }
      if (message.toLowerCase().startsWith("!position")) {
        await handlePositionCommand(channel, tags, client);
      }

      // Queue Management Commands
      if (message.toLowerCase() === "!open" && isModUp) {
        console.log('open command');
        await handleOpenCommand(channel, tags, client, io);
      }
      if (message.toLowerCase() === "!close" && isModUp) {
        await handleCloseCommand(channel, tags, client, io);
      }
      if (message.toLowerCase() === "!firsts_first" && isModUp) {
        await handleFirstsFirstCommand(channel, tags, client);
      }
      if (message.toLowerCase() === "!clear_all" && isModUp) {
        await handleClearAllCommand(channel, tags, client, io);
      }
      if (message.toLowerCase() === "!clear_turns" && isModUp) {
        await handleClearTurnsCommand(channel, tags, client, io);
      }
      if (message.toLowerCase() === "!clear" && isModUp) {
        await handleClearCommand(channel, tags, client);
      }
      if ((message.toLowerCase().startsWith("!auto_pick") || message.toLowerCase().startsWith("!ap")) && isModUp) {
        await handleAutoPickCommand(message, tags, channel, client);
      }

      // Death Counter Commands
      if (message.toLowerCase() === "!ded" && isModUp) {
        await handleDedCommand(channel, tags, io, client);
      }
      if (message.toLowerCase() === "!ded_count") {
        await handleDedCountCommand(channel, tags, client);
      }
      if (message.toLowerCase() === "!ded_reset" && isModUp) {
        await handleDedResetCommand(channel, tags, client, io);
      }
      if (message.toLowerCase().startsWith("!ded_set") && isModUp) {
        await handleDedSetCommand(channel, tags, io, message, client);
      }

      // Tracker Commands
      if (message.toLowerCase().startsWith("!add_sub") && isModUp) {
        const subCount = message.split(" ")[1] || "1";
        await handleSubTracker(subCount, io);
      }
      if (message.toLowerCase().startsWith("!add_bit") && isModUp) {
        const bitCount = message.split(" ")[1] || "1";
        await handleBitTracker(bitCount, io);
      }
      if (message.toLowerCase().startsWith("!add_spin") && isModUp) {
        const spinCount = message.split(" ")[1] || "1";
        await handleSpinTracker(spinCount, io);
      }

      // Misc Commands
      if (message.toLowerCase().startsWith("!wakeup")) {
        await handleWakeupCommand(channel, tags, client);
      }
      // Test Commands for Bit Alerts
      if (message.toLowerCase() === "!test_kermit" && isModUp) {
        io.emit('kermit_sex', { 'display-name': tags['display-name'] });
        abbadabbabotSay(channel, client, tags, `Testing Kermit alert triggered by @${tags["display-name"]}`);
      }
      if (message.toLowerCase() === "!test_jarjar" && isModUp) {
        io.emit('jarjar', { 'display-name': tags['display-name'] });
        abbadabbabotSay(channel, client, tags, `Testing Jar Jar alert triggered by @${tags["display-name"]}`);
      }
      if (message.toLowerCase() === "!test_dracula" && isModUp) {
        io.emit('draculaAngel', { 'display-name': tags['display-name'] });
        abbadabbabotSay(channel, client, tags, `Testing Dracula Angel alert triggered by @${tags["display-name"]}`);
      }
      if (message.toLowerCase() === "!test_ashspit" && isModUp) {
        io.emit('ash_spit', { 'display-name': tags['display-name'] });
        abbadabbabotSay(channel, client, tags, `Testing Ash Spit alert triggered by @${tags["display-name"]}`);
      }
      // Test Commands for Fart Sounds
      const fartTestMatch = message.toLowerCase().match(/^!test_fart(\d{1,2})$/);
      if (fartTestMatch && isModUp) {
        const fartId = `fart_${fartTestMatch[1]}`;
        io.emit('play_sound', { type: fartId });
        abbadabbabotSay(channel, client, tags, `Testing ${fartId} alert triggered by @${tags["display-name"]}`);
      }
      // Crowd Sound Commands
      if (tags['display-name'].toLowerCase() !== bot_display_name.toLowerCase()) {
        if (state.clap_regex.test(message.toLowerCase())) {
          await handleCrowdSoundCommand(channel, tags, io, 'clap', client);
        }
        if (state.laugh_regex.test(message.toLowerCase())) {
          await handleCrowdSoundCommand(channel, tags, io, 'lol', client);
        }
        if (state.fart_regex.test(message.toLowerCase()) && tags.subscriber) {
          await handleCrowdSoundCommand(channel, tags, io, 'fart', client);
        }
        if (state.moan_regex.test(message.toLowerCase()) && tags.subscriber) {
          await handleCrowdSoundCommand(channel, tags, io, 'moan', client);
        }
        if (state.boo_regex.test(message.toLowerCase()) && tags.subscriber) {
          await handleCrowdSoundCommand(channel, tags, io, 'boo', client);
        }
      }

      // AI Commands
      if (message.toLowerCase() === "!toggle_ai") {
        if (isBroadcaster || tags.username == "zilchgnu") {
          state.ai_enabled = !state.ai_enabled;
          const ai_enabled_status = state.ai_enabled ? "enabled" : "disabled";
          abbadabbabotSay(channel, client, tags, `Let chat know AI is now ${ai_enabled_status}.`);
        }
      }

      // Menu Commands
      if (message.toLowerCase() === "!menu" || message.toLowerCase() === "!commands") {
        abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} they can use menu to find abbadabbabot chat commands.`, '', ' ' + process.env.queue_list_url + '/menu');
      }
      if (message.toLowerCase() === "!list") {
        abbadabbabotSay(channel, client, tags, `Announce to @${tags["display-name"]} that we have a list that they can use to find their place in the queue.`, '', ' ' + process.env.queue_list_url);
      }

    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  // Streamlabs Socket Events
  streamlabsSocket.on('event', async (eventData) => {
    if (eventData.type === 'donation') {
      console.log('donation:', eventData.message);
      let donation_amount = parseFloat(eventData.message[0].amount);
      // Add 1 minute per dollar
      const minutes = Math.floor(donation_amount);
      if (minutes > 0) {
        const socketHandlers = global.app.get('socketHandlers');
        if (socketHandlers && socketHandlers.handleSubathonAddTime) {
          // Check if this is a merch purchase by looking at the message
          if (eventData.message[0].message && eventData.message[0].message.toLowerCase().includes('merch')) {
            console.log('Skipping merch purchase donation to avoid double counting');
            return;
          }
        } else {
          console.error('Socket handlers not found for Streamlabs donation');
        }
      }
      handleDonationTracker(donation_amount, io);
    }
  });
}

export { initializeBotCommands, client };
