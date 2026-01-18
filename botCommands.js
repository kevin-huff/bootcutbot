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
  recordContribution as recordTormentContribution
} from './tormentMeterService.js';

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

function resolveSubPlanCents(methods = {}, userstate = {}) {
  const plan = (methods.plan || userstate['msg-param-sub-plan'] || '').toString().toLowerCase();
  switch (plan) {
    case '2000':
      return 999;
    case '3000':
      return 2499;
    case 'prime':
      return 499;
    case '1000':
    default:
      return 499;
  }
}

async function recordTormentSubs({
  count = 1,
  methods = {},
  userstate = {},
  source = 'subscription',
  metadata = {}
}) {
  const quantity = Math.max(1, Number(count) || 0);
  const cents = resolveSubPlanCents(methods, userstate) * quantity;
  if (cents <= 0) {
    return;
  }
  try {
    await recordTormentContribution({
      amountCents: cents,
      source,
      metadata: {
        count: quantity,
        plan: methods.plan || userstate['msg-param-sub-plan'] || '1000',
        username: userstate['display-name'] || userstate.username || null,
        ...metadata
      }
    });
  } catch (error) {
    console.error('Failed to record torment meter subscription contribution:', error);
  }
}

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
    console.log('[CHEER] Received:', userstate.bits, 'bits from', userstate['display-name']);
    if(userstate.bits == 99) io.emit('kermit_sex', userstate);
    if(userstate.bits == 399) io.emit('jarjar', userstate);
    if(userstate.bits == 299) io.emit('draculaAngel', userstate);
    if(userstate.bits == 450) io.emit('ash_spit', userstate);

    // Add time for bits: 100 bits = $1 = 60 seconds
    const bitAmount = parseInt(userstate.bits) || 0;
    if (bitAmount > 0) {
      const secondsToAdd = Math.floor(bitAmount * 0.6); // 100 bits = 60 seconds
      console.log(`[CHEER] ⏱️ TIMER: Adding ${secondsToAdd}s for ${bitAmount} bits`);
      const socketHandlers = global.app.get('socketHandlers');
      if (socketHandlers && socketHandlers.handleSubathonAddTime) {
        await socketHandlers.handleSubathonAddTime(secondsToAdd, `bits_${bitAmount}`, io);
        console.log(`[CHEER] ⏱️ TIMER: Successfully added ${secondsToAdd}s`);
      } else {
        console.error('[CHEER] ❌ TIMER: socketHandlers not found!');
      }
    }

    // Track bits for stats
    await handleBitTracker(userstate.bits, io);

    // Add to spin progress (100 bits = $1)
    if (bitAmount > 0) {
      const bitDollarValue = bitAmount / 100;
      console.log(`[CHEER] 🎡 SPINS: Adding $${bitDollarValue.toFixed(2)} to donation progress`);
      handleDonationTracker(bitDollarValue, io);
    }

    // Add to torment meter
    if (bitAmount > 0) {
      try {
        console.log(`[CHEER] 🔥 TORMENT: Adding ${bitAmount} cents`);
        await recordTormentContribution({
          amountCents: bitAmount,
          source: 'bits',
          metadata: {
            username: userstate['display-name'] || userstate.username || null,
            message: message || null
          }
        });
        console.log(`[CHEER] 🔥 TORMENT: Successfully added ${bitAmount} cents`);
      } catch (error) {
        console.error('[CHEER] ❌ TORMENT: Failed to record:', error);
      }
    }
  });

  // Subscription events
  client.on("subscription", async (channel, username, method, message, userstate) => {
    const subPlan = userstate['msg-param-sub-plan'] || '1000';
    const subValueCents = resolveSubPlanCents(method, userstate);
    const subValueDollars = subValueCents / 100;
    console.log(`[SUB] New subscription from ${username} (${subPlan} = $${subValueDollars})`);
    // Add 5 minutes for new sub
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      console.log(`[SUB] ⏱️ TIMER: Adding 300s (5 min) for sub`);
      await socketHandlers.handleSubathonAddTime(5 * 60, `sub_${username}`, io);
      console.log(`[SUB] ⏱️ TIMER: Successfully added 300s`);
    } else {
      console.error('[SUB] ❌ TIMER: socketHandlers not found!');
    }
    handleSubTracker(1, io);
    // Add to spin progress (tier-based value)
    console.log(`[SUB] 🎡 SPINS: Adding $${subValueDollars} to donation progress`);
    handleDonationTracker(subValueDollars, io);
    console.log(`[SUB] 🔥 TORMENT: Recording sub contribution`);
    await recordTormentSubs({
      count: 1,
      methods: method,
      userstate,
      source: 'subscription',
      metadata: {
        username,
        message: message || null
      }
    });
  });
  
  client.on("resub", async (channel, username, months, message, userstate, methods) => {
    const subPlan = userstate['msg-param-sub-plan'] || '1000';
    const subValueCents = resolveSubPlanCents(methods, userstate);
    const subValueDollars = subValueCents / 100;
    console.log(`[RESUB] ${username} resubbed for ${months} months (${subPlan} = $${subValueDollars})`);
    // Add 5 minutes for resub
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      console.log(`[RESUB] ⏱️ TIMER: Adding 300s (5 min) for resub`);
      await socketHandlers.handleSubathonAddTime(5 * 60, `resub_${username}_${months}m`, io);
      console.log(`[RESUB] ⏱️ TIMER: Successfully added 300s`);
    } else {
      console.error('[RESUB] ❌ TIMER: socketHandlers not found!');
    }
    handleSubTracker(1, io);
    // Add to spin progress (tier-based value)
    console.log(`[RESUB] 🎡 SPINS: Adding $${subValueDollars} to donation progress`);
    handleDonationTracker(subValueDollars, io);
    console.log(`[RESUB] 🔥 TORMENT: Recording resub contribution`);
    await recordTormentSubs({
      count: 1,
      methods,
      userstate,
      source: 'resub',
      metadata: {
        username,
        months,
        message: message || null
      }
    });
  });
  
  client.on("subgift", async (channel, username, streakMonths, recipient, methods, userstate) => {
    // Check if this is part of a mystery gift (gift bomb) - if so, skip timer/torment
    // since we already handled it in submysterygift
    const isPartOfMysteryGift = userstate['msg-param-community-gift-id'];
    if (isPartOfMysteryGift) {
      console.log(`[GIFTSUB] ${username} -> ${recipient} (part of gift bomb, skipping timer/torment)`);
      return;
    }

    const subPlan = userstate['msg-param-sub-plan'] || '1000';
    const subValueCents = resolveSubPlanCents(methods, userstate);
    const subValueDollars = subValueCents / 100;
    console.log(`[GIFTSUB] ${username} gifted sub to ${recipient} (${subPlan} = $${subValueDollars})`);
    // Add 5 minutes for gift sub
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      console.log(`[GIFTSUB] ⏱️ TIMER: Adding 300s (5 min) for gift sub`);
      await socketHandlers.handleSubathonAddTime(5 * 60, `giftsub_from_${username}_to_${recipient}`, io);
      console.log(`[GIFTSUB] ⏱️ TIMER: Successfully added 300s`);
    } else {
      console.error('[GIFTSUB] ❌ TIMER: socketHandlers not found!');
    }
    handleSubTracker(1, io);
    // Add to spin progress (tier-based value)
    console.log(`[GIFTSUB] 🎡 SPINS: Adding $${subValueDollars} to donation progress`);
    handleDonationTracker(subValueDollars, io);
    console.log(`[GIFTSUB] 🔥 TORMENT: Recording gift sub contribution`);
    await recordTormentSubs({
      count: 1,
      methods,
      userstate,
      source: 'gift_sub',
      metadata: {
        gifter: username,
        recipient,
        streakMonths
      }
    });
  });

  client.on('submysterygift', async (channel, username, numbOfSubs, methods, userstate) => {
    const subPlan = userstate['msg-param-sub-plan'] || '1000';
    const subValueCents = resolveSubPlanCents(methods, userstate);
    const subValueDollars = subValueCents / 100;
    console.log(`[GIFTBOMB] ${username} gifted ${numbOfSubs} subs! (${subPlan} = $${subValueDollars} each)`);
    // Add 5 minutes per gifted sub
    const totalSeconds = 5 * 60 * numbOfSubs;
    const socketHandlers = global.app.get('socketHandlers');
    if (socketHandlers && socketHandlers.handleSubathonAddTime) {
      console.log(`[GIFTBOMB] ⏱️ TIMER: Adding ${totalSeconds}s (${numbOfSubs} x 5 min) for gift bomb`);
      await socketHandlers.handleSubathonAddTime(totalSeconds, `giftbomb_${username}_x${numbOfSubs}`, io);
      console.log(`[GIFTBOMB] ⏱️ TIMER: Successfully added ${totalSeconds}s`);
    } else {
      console.error('[GIFTBOMB] ❌ TIMER: socketHandlers not found!');
    }
    handleSubTracker(numbOfSubs, io);
    // Add to spin progress (tier-based value)
    const giftValue = numbOfSubs * subValueDollars;
    console.log(`[GIFTBOMB] 🎡 SPINS: Adding $${giftValue.toFixed(2)} to donation progress`);
    handleDonationTracker(giftValue, io);
    console.log(`[GIFTBOMB] 🔥 TORMENT: Recording ${numbOfSubs} gift subs contribution`);
    await recordTormentSubs({
      count: numbOfSubs,
      methods,
      userstate,
      source: 'gift_sub_bulk',
      metadata: {
        gifter: username,
        count: numbOfSubs
      }
    });
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
      const donorName = eventData.message[0]?.name || 'anonymous';
      const donationAmount = parseFloat(eventData.message[0].amount);
      const donationMessage = eventData.message[0]?.message || '';
      console.log(`[DONATION] $${donationAmount} from ${donorName}: "${donationMessage}"`);

      // Check if this is a merch purchase - skip timer add to avoid double counting
      if (donationMessage.toLowerCase().includes('merch')) {
        console.log('[DONATION] Skipping merch purchase (handled by 4th wall webhook)');
        handleDonationTracker(donationAmount, io);
        return;
      }

      // Add 1 minute per dollar to timer
      const secondsToAdd = Math.floor(donationAmount) * 60;
      if (secondsToAdd > 0) {
        const socketHandlers = global.app.get('socketHandlers');
        if (socketHandlers && socketHandlers.handleSubathonAddTime) {
          console.log(`[DONATION] ⏱️ TIMER: Adding ${secondsToAdd}s ($${donationAmount} = ${Math.floor(donationAmount)} min)`);
          await socketHandlers.handleSubathonAddTime(secondsToAdd, `donation_${donorName}`, io);
          console.log(`[DONATION] ⏱️ TIMER: Successfully added ${secondsToAdd}s`);
        } else {
          console.error('[DONATION] ❌ TIMER: socketHandlers not found!');
        }
      }
      handleDonationTracker(donationAmount, io);
    }
  });
}

export { initializeBotCommands, client };
