import { queue_db, turns_db, settings_db, historical_turns_db } from './db.js';
import { abbadabbabotSay, ordinal_suffix_of } from '../utils.js';
import { state } from '../constants.js';

async function isUserInChat(username) {
  return true;
}

async function handleJoinCommand(channel, tags, client) {
  let queue = await queue_db.get("queue");
  if (!queue) queue = [];

  if (state.queue_open) {
    const in_queue = queue.findIndex((q) => q.username == tags.username);
    if (in_queue < 0) {
      const turn_counter = await turns_db.get("turns");
      const turn_count = turn_counter ? turn_counter.reduce((acc, cur) => (cur.username === tags.username ? ++acc : acc), 0) : 0;
      tags.turn_count = turn_count;
      await queue_db.push("queue", tags);
      const place_in_queue = queue.length + 1;
      const place_ordinal = ordinal_suffix_of(place_in_queue);

      if (state.firsts_first && turn_count > 0) {
        const turn_ordinal = ordinal_suffix_of(turn_count + 1);
        client.say(
          channel,
          `@${tags["display-name"]}, added to queue! You're ${place_ordinal} in the queue, this will be your ${turn_ordinal} turn. Note: Firsts Turns First Mode is on, so any players who haven't gone yet will be picked before you.`
        );
      } else {
        client.say(
          channel,
          `@${tags["display-name"]}, added to queue! You're ${place_ordinal} in the queue.`
        );
      }
    } else {
      const place_in_queue = in_queue + 1;
      const place_ordinal = ordinal_suffix_of(place_in_queue);
      client.say(
        channel,
        `@${tags["display-name"]} you're already queued silly. You're ${place_ordinal} in the queue.`
      );
    }
  } else {
    abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} that the queue is closed in a sensual way.`, '', `- @${tags["display-name"]} Queue Closed`);
  }
}

async function handleLeaveCommand(channel, tags, client) {
  let queue = await queue_db.get("queue");
  if (!queue) queue = [];

  const in_queue = queue.findIndex((q) => q.username == tags.username);
  if (in_queue < 0) {
    abbadabbabotSay(channel, client, tags, `Tell ${tags["display-name"]} you can't find them in the queue`, '', `- @${tags["display-name"]}`);
  } else {
    queue.splice(in_queue, 1);
    await queue_db.set("queue", queue);
    abbadabbabotSay(channel, client, tags, `Tell chat that ${tags["display-name"]} has left the queue and let them know they'll be missed`, '', `- @${tags["display-name"]}`);
  }
}

async function handleNextCommand(channel, tags, client, io) {
  let queue = await queue_db.get("queue");
  if (!queue) queue = [];

  let turn_counter = await turns_db.get("turns");
  if (!turn_counter) turn_counter = [];

  let current_player;
  if (state.firsts_first) {
    let found_zero_turn = false;
    for (let i = 0; i < queue.length; i++) {
      current_player = queue[i];
      const turn_count = turn_counter.reduce(
        (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
        0
      );
      if (turn_count === 0) {
        found_zero_turn = true;
        queue.splice(i, 1);
        break;
      }
    }
    if (!found_zero_turn) {
      client.say(channel, `No Zero Turn Players found. Picking the next player.`);
      current_player = queue.shift();
    }
  } else {
    current_player = queue.shift();
  }

  const in_chat = await isUserInChat(current_player.username);
  if (in_chat) {
    state.current_turn = current_player["display-name"];
    await turns_db.push("turns", current_player);
    io.emit('new_turn', `${current_player["display-name"]}`);
    const turn_count = turn_counter.reduce(
      (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
      0
    );
    if (turn_count > 0) {
      const turn_ordinal = ordinal_suffix_of(turn_count + 1);
      client.say(
        channel,
        `@abbabox - @${current_player["display-name"]} has been chosen again, this is your ${turn_ordinal} turn.`
      );
    } else {
      abbadabbabotSay(channel, client, tags, `Tell @${current_player["display-name"]} to step on up to the battle board of doom!`, '@abbabox ', `- @${current_player["display-name"]} is next`);
    }
    await queue_db.set("queue", queue);
    await settings_db.math("turn_count", "add", 1);
    await historical_turns_db.math(current_player["display-name"].toLowerCase(), "add", 1);
  } else {
    queue.push(current_player);
    await queue_db.set("queue", queue);
    client.say(
      channel,
      `@abbabox - @${current_player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !next again`
    );
  }
}

async function handleRandomCommand(channel, tags, client, io) {
  let queue = await queue_db.get("queue");
  if (!queue) queue = [];

  let turn_counter = await turns_db.get("turns");
  if (!turn_counter) turn_counter = [];

  let current_player;
  if (state.firsts_first) {
    let found_zero_turn = false;
    let dupe_queue = queue.slice();
    while (dupe_queue.length > 0) {
      const random_index = Math.floor(Math.random() * dupe_queue.length);
      current_player = dupe_queue[random_index];
      const turn_count = turn_counter.reduce(
        (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
        0
      );
      if (turn_count === 0) {
        found_zero_turn = true;
        queue.splice(queue.indexOf(current_player), 1);
        break;
      } else {
        dupe_queue.splice(random_index, 1);
      }
    }
    if (!found_zero_turn) {
      client.say(channel, `No Zero Turn Players found. Picking any random player.`);
      const random_index = Math.floor(Math.random() * queue.length);
      current_player = queue.splice(random_index, 1)[0];
    }
  } else {
    const random_index = Math.floor(Math.random() * queue.length);
    current_player = queue.splice(random_index, 1)[0];
  }

  const in_chat = await isUserInChat(current_player.username);
  if (in_chat) {
    state.current_turn = current_player["display-name"];
    await turns_db.push("turns", current_player);
    io.emit('new_turn', `${current_player["display-name"]}`);
    const turn_count = turn_counter.reduce(
      (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
      0
    );
    if (turn_count > 0) {
      const turn_ordinal = ordinal_suffix_of(turn_count + 1);
      client.say(
        channel,
        `@abbabox - @${current_player["display-name"]} has been chosen again, this is your ${turn_ordinal} turn.`
      );
    } else {
      abbadabbabotSay(channel, client, tags, `Tell @${current_player["display-name"]} to step on up to the battle board of doom!`, '@abbabox ', `- @${current_player["display-name"]}`);
    }
    await queue_db.set("queue", queue);
    await settings_db.math("turn_count", "add", 1);
    await historical_turns_db.math(current_player["display-name"].toLowerCase(), "add", 1);
  } else {
    queue.push(current_player);
    await queue_db.set("queue", queue);
    client.say(
      channel,
      `@abbabox - @${current_player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !random again`
    );
  }
}

async function handlePositionCommand(channel, tags, client) {
  let queue = await queue_db.get("queue");
  if (!queue) queue = [];

  const in_queue = queue.findIndex((q) => q.username == tags.username);
  if (in_queue < 0) {
    abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} you can't find them in the queue`, '', ` @${tags["display-name"]}`, '', `- NOT IN QUEUE`);
  } else {
    const place_in_queue = in_queue + 1;
    const place_ordinal = ordinal_suffix_of(place_in_queue);
    abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} that they are ${place_ordinal} in the queue, in a funny way`, '', `- ${place_ordinal} in queue @${tags["display-name"]}`);
  }
}

export {
  handleJoinCommand,
  handleLeaveCommand,
  handleNextCommand,
  handleRandomCommand,
  handlePositionCommand
};
