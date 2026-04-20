import { queue_db, turns_db, settings_db, historical_turns_db } from './db.js';
import { abbadabbabotSay, ordinal_suffix_of } from '../utils.js';
import { state } from '../constants.js';

async function isUserInChat(username) {
  return true;
}

/**
 * Count how many turns `username` has taken, based on a turns array.
 */
function countTurns(turns, username) {
  if (!Array.isArray(turns)) return 0;
  return turns.reduce((acc, cur) => (cur && cur.username === username ? acc + 1 : acc), 0);
}

async function getHistoricalTurnsMap() {
  const all = await historical_turns_db.all();
  if (!all || typeof all !== 'object') return {};
  return all;
}

function historicalCountFor(historicalMap, player) {
  if (!player) return 0;
  const name = String(player["display-name"] || player.username || '').toLowerCase();
  return Number(historicalMap[name]) || 0;
}

async function handleJoinCommand(channel, tags, client) {
  if (!state.queue_open) {
    abbadabbabotSay(
      channel, client, tags,
      `Tell @${tags["display-name"]} that the queue is closed in a sensual way.`,
      '', `- @${tags["display-name"]} Queue Closed`
    );
    return;
  }

  const turn_counter = (await turns_db.get("turns")) || [];
  const turn_count = countTurns(turn_counter, tags.username);

  // Atomic read-modify-write: one winner per user, in queue-order of arrival
  // regardless of how many concurrent !join commands hit at once.
  const outcome = { alreadyQueued: false, place: 0 };
  await queue_db.update("queue", (queue) => {
    const arr = Array.isArray(queue) ? queue.slice() : [];
    const existing = arr.findIndex((q) => q && q.username == tags.username);
    if (existing >= 0) {
      outcome.alreadyQueued = true;
      outcome.place = existing + 1;
      return arr;
    }
    const entry = { ...tags, turn_count };
    arr.push(entry);
    outcome.place = arr.length;
    return arr;
  });

  const place_ordinal = ordinal_suffix_of(outcome.place);
  if (outcome.alreadyQueued) {
    client.say(
      channel,
      `@${tags["display-name"]} you're already queued silly. You're ${place_ordinal} in the queue.`
    );
    return;
  }

  const historicalMap = await getHistoricalTurnsMap();
  const lifetime_turns = historicalCountFor(historicalMap, { "display-name": tags["display-name"], username: tags.username });

  if (state.virgins_first && lifetime_turns === 0) {
    client.say(
      channel,
      `@${tags["display-name"]}, added to queue! You're ${place_ordinal} in the queue. Virgins First Mode is on and this is your first time — you'll jump the line! 🌟`
    );
  } else if (state.virgins_first && lifetime_turns > 0) {
    client.say(
      channel,
      `@${tags["display-name"]}, added to queue! You're ${place_ordinal} in the queue. Heads up: Virgins First Mode is on, so first-time players will be picked before you.`
    );
  } else if (state.firsts_first && turn_count > 0) {
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
}

async function handleLeaveCommand(channel, tags, client) {
  const outcome = { found: false };
  await queue_db.update("queue", (queue) => {
    const arr = Array.isArray(queue) ? queue.slice() : [];
    const existing = arr.findIndex((q) => q && q.username == tags.username);
    if (existing < 0) return arr;
    arr.splice(existing, 1);
    outcome.found = true;
    return arr;
  });

  if (!outcome.found) {
    abbadabbabotSay(channel, client, tags,
      `Tell ${tags["display-name"]} you can't find them in the queue`,
      '', `- @${tags["display-name"]}`);
    return;
  }

  abbadabbabotSay(channel, client, tags,
    `Tell chat that ${tags["display-name"]} has left the queue and let them know they'll be missed`,
    '', `- @${tags["display-name"]}`);
}

/**
 * Pick the next player from the queue. Under firsts-first, prefer a 0-turn
 * player; otherwise shift the head. Returns `null` if queue is empty.
 */
function pickNext(queue, turn_counter) {
  if (state.firsts_first) {
    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      if (candidate && countTurns(turn_counter, candidate.username) === 0) {
        queue.splice(i, 1);
        return { player: candidate, usedFallback: false };
      }
    }
    const fallback = queue.shift();
    return fallback ? { player: fallback, usedFallback: true } : null;
  }
  const head = queue.shift();
  return head ? { player: head, usedFallback: false } : null;
}

async function finishTurn(channel, tags, client, io, player, turn_count_before, logLabel, { isVirgin = false } = {}) {
  state.current_turn = player["display-name"];
  await turns_db.push("turns", player);
  io.emit('new_turn', `${player["display-name"]}`);

  if (isVirgin) {
    client.say(
      channel,
      `🌟 VIRGIN PICK — @abbabox, @${player["display-name"]} is stepping up to the board for their very first Bootcut turn! Be gentle. ✨`
    );
  } else if (turn_count_before > 0) {
    const turn_ordinal = ordinal_suffix_of(turn_count_before + 1);
    client.say(
      channel,
      `@abbabox - @${player["display-name"]} has been chosen again, this is your ${turn_ordinal} turn.`
    );
  } else {
    abbadabbabotSay(channel, client, tags,
      `Tell @${player["display-name"]} to step on up to the battle board of doom!`,
      '@abbabox ',
      `- @${player["display-name"]}${logLabel ? ' ' + logLabel : ''}`
    );
  }

  await settings_db.math("turn_count", "add", 1);
  await historical_turns_db.math(player["display-name"].toLowerCase(), "add", 1);
}

async function requeuePlayer(player) {
  await queue_db.update("queue", (queue) => {
    const arr = Array.isArray(queue) ? queue.slice() : [];
    arr.push(player);
    return arr;
  });
}

async function handleNextCommand(channel, tags, client, io) {
  const turn_counter = (await turns_db.get("turns")) || [];
  const outcome = { player: null, usedFallback: false };

  await queue_db.update("queue", (queue) => {
    const arr = Array.isArray(queue) ? queue.slice() : [];
    const picked = pickNext(arr, turn_counter);
    if (picked) {
      outcome.player = picked.player;
      outcome.usedFallback = picked.usedFallback;
    }
    return arr;
  });

  if (!outcome.player) {
    client.say(channel, `Queue is empty.`);
    return;
  }
  if (outcome.usedFallback) {
    client.say(channel, `No Zero Turn Players found. Picking the next player.`);
  }

  const player = outcome.player;
  const turn_count = countTurns(turn_counter, player.username);
  const in_chat = await isUserInChat(player.username);

  if (in_chat) {
    await finishTurn(channel, tags, client, io, player, turn_count, 'is next');
  } else {
    await requeuePlayer(player);
    client.say(
      channel,
      `@abbabox - @${player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !next again`
    );
  }
}

/**
 * Pick a random player. Under firsts-first, prefer a random 0-turn player;
 * otherwise pick uniformly at random from whatever's in the queue.
 */
function pickRandom(queue, turn_counter) {
  if (state.firsts_first) {
    const candidates = [];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (p && countTurns(turn_counter, p.username) === 0) candidates.push(i);
    }
    if (candidates.length > 0) {
      const idx = candidates[Math.floor(Math.random() * candidates.length)];
      const [player] = queue.splice(idx, 1);
      return { player, usedFallback: false };
    }
    if (queue.length === 0) return null;
    const idx = Math.floor(Math.random() * queue.length);
    const [player] = queue.splice(idx, 1);
    return { player, usedFallback: true };
  }
  if (queue.length === 0) return null;
  const idx = Math.floor(Math.random() * queue.length);
  const [player] = queue.splice(idx, 1);
  return { player, usedFallback: false };
}

async function handleRandomCommand(channel, tags, client, io) {
  const turn_counter = (await turns_db.get("turns")) || [];
  const outcome = { player: null, usedFallback: false };

  await queue_db.update("queue", (queue) => {
    const arr = Array.isArray(queue) ? queue.slice() : [];
    const picked = pickRandom(arr, turn_counter);
    if (picked) {
      outcome.player = picked.player;
      outcome.usedFallback = picked.usedFallback;
    }
    return arr;
  });

  if (!outcome.player) {
    client.say(channel, `Queue is empty.`);
    return;
  }
  if (outcome.usedFallback) {
    client.say(channel, `No Zero Turn Players found. Picking any random player.`);
  }

  const player = outcome.player;
  const turn_count = countTurns(turn_counter, player.username);
  const in_chat = await isUserInChat(player.username);

  if (in_chat) {
    await finishTurn(channel, tags, client, io, player, turn_count, '');
  } else {
    await requeuePlayer(player);
    client.say(
      channel,
      `@abbabox - @${player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !random again`
    );
  }
}

async function handleVirginCommand(channel, tags, client, io) {
  const queueNow = (await queue_db.get("queue")) || [];
  const historicalMap = await getHistoricalTurnsMap();
  const hasVirgin = queueNow.some((p) => historicalCountFor(historicalMap, p) === 0);

  if (!hasVirgin) {
    client.say(channel, `No virgins in the queue — picking a random player instead.`);
    await handleRandomCommand(channel, tags, client, io);
    return;
  }

  const turn_counter = (await turns_db.get("turns")) || [];
  const outcome = { player: null };

  await queue_db.update("queue", (queue) => {
    const arr = Array.isArray(queue) ? queue.slice() : [];
    const candidates = [];
    for (let i = 0; i < arr.length; i++) {
      if (historicalCountFor(historicalMap, arr[i]) === 0) candidates.push(i);
    }
    if (candidates.length === 0) return arr;
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    const [player] = arr.splice(idx, 1);
    outcome.player = player;
    return arr;
  });

  if (!outcome.player) {
    client.say(channel, `No virgins in the queue — picking a random player instead.`);
    await handleRandomCommand(channel, tags, client, io);
    return;
  }

  const player = outcome.player;
  const session_turn_count = countTurns(turn_counter, player.username);
  const in_chat = await isUserInChat(player.username);

  if (in_chat) {
    await finishTurn(channel, tags, client, io, player, session_turn_count, 'first-ever turn', { isVirgin: true });
  } else {
    await requeuePlayer(player);
    client.say(
      channel,
      `@abbabox - @${player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !virgin again`
    );
  }
}

async function handlePositionCommand(channel, tags, client) {
  const queue = (await queue_db.get("queue")) || [];

  const in_queue = queue.findIndex((q) => q && q.username == tags.username);
  if (in_queue < 0) {
    abbadabbabotSay(channel, client, tags,
      `Tell @${tags["display-name"]} you can't find them in the queue`,
      '', ` @${tags["display-name"]}`, '', `- NOT IN QUEUE`);
    return;
  }
  const place_ordinal = ordinal_suffix_of(in_queue + 1);
  abbadabbabotSay(channel, client, tags,
    `Tell @${tags["display-name"]} that they are ${place_ordinal} in the queue, in a funny way`,
    '', `- ${place_ordinal} in queue @${tags["display-name"]}`);
}

export {
  handleJoinCommand,
  handleLeaveCommand,
  handleNextCommand,
  handleRandomCommand,
  handleVirginCommand,
  handlePositionCommand
};
