import { crowd_sound_db, deaths_db } from './db.js';
import { abbadabbabotSay, say, getCustomMessage } from '../utils.js';

async function handleCrowdSoundCommand(channel, tags, io, soundType, client) {
  let current_sounds = await crowd_sound_db.get(soundType) || [];
  const current_timestamp = Date.now();
  current_sounds = current_sounds.filter(sound => current_timestamp - sound.timestamp <= 300000);

  const contributed = current_sounds.some(sound => sound.user === tags['display-name']);
  if (!contributed) {
    const sound = {
      user: tags["display-name"],
      timestamp: current_timestamp
    };
    current_sounds.push(sound);
    await crowd_sound_db.set(soundType, current_sounds);
  } else {
    console.log(`user already contributed a ${soundType}`);
    return;
  }

  const threshold = parseInt(process.env[`${soundType.toUpperCase()}_THRESHOLD`]);
  if (current_sounds.length >= threshold) {
    io.emit(`${soundType}_threshold`, true);
    say(channel, client, tags, getCustomMessage(soundType));
    await crowd_sound_db.set(soundType, []);
  }
}

async function handleDedCommand(channel, tags, io, client) {
  var deaths = await deaths_db.get("deaths");
  deaths++;
  await deaths_db.set("deaths", deaths);
  io.emit('updateDeathCount', deaths);
  abbadabbabotSay(channel, client, tags, `Tell chat that abbabox just has killed ${deaths} players in his RPG.`, '', ` - ${deaths} deaths`);
}

async function handleDedCountCommand(channel, tags, client) {
  const deaths = await deaths_db.get("deaths");
  abbadabbabotSay(channel, client, tags, `Tell chat that abbabox has killed ${deaths} players in his RPG.`, '', `- ${deaths} deaths`);
}

async function handleDedResetCommand(channel, tags, client, io) {
  await deaths_db.set("deaths", 0);
  io.emit('updateDeathCount', 0);
  abbadabbabotSay(channel, client, tags, `Tell chat about how harsh of a GM abba is`, '', `- deaths set to 0`);
}

async function handleDedSetCommand(channel, tags, io, message, client) {
  const death_count = message.split("!ded_set")[1].trim();
  await deaths_db.set("deaths", death_count);
  io.emit('updateDeathCount', death_count);
  abbadabbabotSay(channel, client, tags, `Tell chat about how harsh of a GM abba is`, '', `- deaths set to ${death_count}`);
}

async function handleWakeupCommand(channel, tags, client) {
  const greetings = [
    `Can you give your Abbabox a message in this chat? Let him know it's stream time and we need him to wake up.`,
    `Can you give your Abbabox a message in this chat? Tell abbabox that his Bathtime is over people are waiting for him.`,
    `Riff on the quote to try and pressure Abbabox to start stream already: An abba is never late, nor is he early. He arrives precisely when he means to.`,
    `Wake up, Abbabox! The chat is exploding with excitement, and we need your epic presence now!`,
    `Tell Abbabox that the chat is on fire with anticipation! Time to make some streaming magic!`,
    `Hey @abbabox, the chat is doing the "wake up" dance for you! Come on and join the party!`,
    `Abbabox, it's go time! The chat is ready to rock, and we need our streaming hero!`,
    `Paging Abbabox! Your streaming adventure awaits, and the chat is eager to begin!`,
    `Tell @abbabox the virtual coffee is ready, and it's time to wake up and start the stream!`,
    `Abbabox, the chat is buzzing louder than a beehive! Let's get this stream rolling!`,
    `Message for @abbabox: The chat is full of "Wake up" chants! Let's not keep them waiting any longer!`
  ];
  const random_index = Math.floor(Math.random() * greetings.length);
  abbadabbabotSay(channel, client, tags, `*Abbabox is running late, try and get him to start stream.*: ${greetings[random_index]}`);
}

export {
  handleCrowdSoundCommand,
  handleDedCommand,
  handleDedCountCommand,
  handleDedResetCommand,
  handleDedSetCommand,
  handleWakeupCommand
};
