import { queue_db, turns_db, settings_db, historical_turns_db } from './db.js';
import { abbadabbabotSay } from '../utils.js';
import { state } from '../constants.js';

async function handleOpenCommand(channel, tags, client, io) {
  state.queue_open = true;
  await settings_db.set('queue_open', true);
  abbadabbabotSay(channel, client, tags, 'formally announce the opening of the queue to the chat');
  io.emit('new_turn', `Queue Just Opened`);
}

async function handleCloseCommand(channel, tags, client, io) {
  state.queue_open = false;
  await settings_db.set('queue_open', false);
  abbadabbabotSay(channel, client, tags, 'formally announce the closing of the queue to the chat');
  io.emit('new_turn', `Queue Closed`);
}

async function handleFirstsFirstCommand(channel, tags, client, io) {
  state.firsts_first = !state.firsts_first;
  await settings_db.set('firsts_first', state.firsts_first);
  const message = state.firsts_first
    ? `First Turns First Mode ACTIVATED. The queue will choose players without a turn first.`
    : `First Turns First Mode DEACTIVATED. The queue has been returned to normal.`;
  client.say(channel, message);
  if (io) io.emit('queue_mode_state', { firsts_first: state.firsts_first, virgins_first: state.virgins_first });
}

async function handleVirginsFirstCommand(channel, tags, client, io) {
  state.virgins_first = !state.virgins_first;
  await settings_db.set('virgins_first', state.virgins_first);
  const message = state.virgins_first
    ? `✨ Virgins First Mode ACTIVATED. Auto-pick is now Virgin-Virgin-Next. First-time players will be picked before anyone else.`
    : `Virgins First Mode DEACTIVATED. Auto-pick is back to Random-Random-Next.`;
  client.say(channel, message);
  if (io) io.emit('queue_mode_state', { firsts_first: state.firsts_first, virgins_first: state.virgins_first });
}

async function handleClearAllCommand(channel, tags, client, io) {
  await queue_db.clear();
  await turns_db.clear();
  abbadabbabotSay(channel, client, tags, 'formally announce the clearing of the queue and turns to the chat');
  io.emit('new_turn', `Turns Cleared`);
}

async function handleClearTurnsCommand(channel, tags, client, io) {
  await turns_db.clear();
  abbadabbabotSay(channel, client, tags, 'formally announce that turns have been reset');
  io.emit('new_turn', `Turns Cleared`);
}

async function handleClearCommand(channel, tags, client) {
  await queue_db.clear();
  abbadabbabotSay(channel, client, tags, 'formally announce the clearing of the queue to the chat');
}

async function handleAutoPickCommand(message, tags, channel, client) {
  if (['abbadabbabot', 'zilchgnu', 'abbabox', 'lilkevy_bot'].includes(tags.username.toLowerCase())) {
    const last_turn_id = await settings_db.get('turn_count');
    const this_turn_id = last_turn_id + 1;
    console.log('this_turn_id: ', this_turn_id);
    console.log('this_turn_id % 3', this_turn_id % 3);

    const pickCommand = state.virgins_first ? '!virgin' : '!random';

    if (this_turn_id % 3 === 0) {
      client.say(channel, `!next - This is turn ${this_turn_id}`);
    } else {
      client.say(channel, `${pickCommand} - This is turn ${this_turn_id}`);
    }
  }
}

export {
  handleOpenCommand,
  handleCloseCommand,
  handleFirstsFirstCommand,
  handleVirginsFirstCommand,
  handleClearAllCommand,
  handleClearTurnsCommand,
  handleClearCommand,
  handleAutoPickCommand
};
