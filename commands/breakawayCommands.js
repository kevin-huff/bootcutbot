import { settings_db, user_breakaways_db } from './db.js';
import { state } from '../constants.js';

// Personal breakaway mode: instead of the shared pool, every chatter has their own
// balance. Balances live in the 'user_breakaways' namespace keyed by lowercase login
// and are never touched by the mode toggle, so flipping back and forth is safe.
const STARTING_BAS = 8;
const PACK_SIZE = 5;
const PACK_COST_BITS = 100;

function baKey(username) {
  return String(username || '').replace(/^@/, '').trim().toLowerCase();
}

// null (never seen) → starting balance
function resolveBalance(current) {
  return typeof current === 'number' && Number.isFinite(current) ? current : STARTING_BAS;
}

async function getBalance(username) {
  const key = baKey(username);
  if (!key) return null;
  return user_breakaways_db.update(key, (current) => resolveBalance(current));
}

// Read-only balance for display surfaces (overlay, profile) — never writes,
// so looking at a page can't seed junk keys for non-users.
async function peekBalance(username) {
  const key = baKey(username);
  if (!key || /\s/.test(key)) return null;
  return resolveBalance(await user_breakaways_db.get(key));
}

async function addToBalance(username, amount) {
  const key = baKey(username);
  if (!key) return null;
  return user_breakaways_db.update(key, (current) => Math.max(0, resolveBalance(current) + amount));
}

// Keeps overlays and dashboards in sync with any balance change.
function emitUserBaUpdate(io, username, balance) {
  if (io && balance !== null) {
    io.emit('user_ba_update', { username: baKey(username), balance });
  }
}

async function handleBaModeCommand(channel, tags, client, io) {
  state.user_ba_mode = !state.user_ba_mode;
  await settings_db.set('user_ba_mode', state.user_ba_mode);
  const message = state.user_ba_mode
    ? `🎲 Personal Breakaway Mode ACTIVATED. Everyone holds their own breakaways — you start with ${STARTING_BAS}. Check yours with !ba_count, buy ${PACK_SIZE} more with a ${PACK_COST_BITS}-bit cheer.`
    : `Personal Breakaway Mode DEACTIVATED. Back to the shared pool — personal balances are saved for next time.`;
  client.say(channel, message);
  if (io) io.emit('ba_mode_state', { user_ba_mode: state.user_ba_mode });
}

async function handleBaCountCommand(channel, tags, client) {
  if (!state.user_ba_mode) {
    client.say(channel, `@${tags['display-name']} breakaways are running from the shared pool right now — no personal balance in play.`);
    return;
  }
  const balance = await getBalance(tags.username);
  client.say(channel, `@${tags['display-name']} you have ${balance} breakaway${balance === 1 ? '' : 's'} left. Buy ${PACK_SIZE} more with a ${PACK_COST_BITS}-bit cheer.`);
}

// !give_ba <user> <amount> — mods only. Negative amounts allowed for corrections.
async function handleGiveBaCommand(message, channel, tags, client, io) {
  const parts = message.trim().split(/\s+/);
  const target = baKey(parts[1]);
  const amount = parseInt(parts[2], 10);
  if (!target || !Number.isFinite(amount) || amount === 0) {
    client.say(channel, `Usage: !give_ba <user> <amount>`);
    return;
  }
  const balance = await addToBalance(target, amount);
  emitUserBaUpdate(io, target, balance);
  client.say(channel, `${amount > 0 ? 'Granted' : 'Removed'} ${Math.abs(amount)} breakaway${Math.abs(amount) === 1 ? '' : 's'} ${amount > 0 ? 'to' : 'from'} @${target} — they now hold ${balance}.`);
}

// !use_ba [user] — mods only. Defaults to the player in the hot seat.
async function handleUseBaCommand(message, channel, tags, client, io) {
  if (!state.user_ba_mode) {
    client.say(channel, `Personal Breakaway Mode is off — manage the shared pool from the board admin.`);
    return;
  }
  const parts = message.trim().split(/\s+/);
  const target = baKey(parts[1] || state.current_turn);
  if (!target || target === 'none... yet') {
    client.say(channel, `Usage: !use_ba <user> (no one is in the hot seat).`);
    return;
  }
  const before = await getBalance(target);
  if (before <= 0) {
    client.say(channel, `@${target} has no breakaways left! The splot must be faced.`);
    return;
  }
  const balance = await addToBalance(target, -1);
  emitUserBaUpdate(io, target, balance);
  client.say(channel, `@${target} burns a breakaway — ${balance} remaining.`);
}

// Called from the cheer handler. A cheer of exactly PACK_COST_BITS buys a pack —
// exact match only, so 300/400-bit cheers (SDBAs, turn buys) don't trigger it.
async function handleBaCheerPurchase(userstate, channel, client, io) {
  try {
    if (!state.user_ba_mode) return;
    const bits = parseInt(userstate.bits, 10) || 0;
    if (bits !== PACK_COST_BITS) return;
    const balance = await addToBalance(userstate.username, PACK_SIZE);
    emitUserBaUpdate(io, userstate.username, balance);
    client.say(channel, `💰 @${userstate['display-name']} bought a ${PACK_SIZE}-pack of breakaways — they now hold ${balance}!`);
  } catch (error) {
    console.error('[CHEER] ❌ BREAKAWAYS: Failed to credit pack:', error);
  }
}

export {
  handleBaModeCommand,
  handleBaCountCommand,
  handleGiveBaCommand,
  handleUseBaCommand,
  handleBaCheerPurchase,
  getBalance,
  peekBalance,
  addToBalance,
  emitUserBaUpdate,
  STARTING_BAS,
  PACK_SIZE,
  PACK_COST_BITS
};
