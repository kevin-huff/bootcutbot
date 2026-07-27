import { settings_db, user_breakaways_db } from './db.js';
import { state } from '../constants.js';
import { profileUrl } from '../utils.js';
import { recordBaEvent } from '../lib/baLedger.js';

// Personal breakaway mode: instead of the shared pool, every chatter has their own
// balance. Balances live in the 'user_breakaways' namespace keyed by lowercase login
// and are never touched by the mode toggle, so flipping back and forth is safe.

// Rates are runtime-tunable from the board admin page and persist in queue_settings
// under 'ba_settings'. cp_rewards drives the Twitch channel point rewards managed by
// channelPointsService.js — one entry per reward; reward_id is written by that
// service, not the admin. self_* credit the redeemer; abba_* credit the broadcaster.
const CP_REWARD_DEFAULTS = {
  self_pack:   { enabled: false, cost: 5000, amount: 5, reward_id: null },
  self_single: { enabled: false, cost: 1200, amount: 1, reward_id: null },
  abba_pack:   { enabled: false, cost: 5000, amount: 5, reward_id: null },
  abba_single: { enabled: false, cost: 1200, amount: 1, reward_id: null },
};

const BA_SETTINGS_DEFAULTS = {
  starting_bas: 5,
  bits_pack_size: 5,
  bits_pack_cost: 100,
  cp_rewards: CP_REWARD_DEFAULTS,
};

const stored = (await settings_db.get('ba_settings')) || {};
// Fold the pre-registry flat cp_* keys (a single pack reward) into cp_rewards.self_pack.
if (stored.cp_enabled !== undefined || stored.cp_reward_id !== undefined) {
  stored.cp_rewards = {
    ...(stored.cp_rewards || {}),
    self_pack: {
      enabled: Boolean(stored.cp_enabled),
      cost: stored.cp_cost ?? CP_REWARD_DEFAULTS.self_pack.cost,
      amount: stored.cp_pack_size ?? CP_REWARD_DEFAULTS.self_pack.amount,
      reward_id: stored.cp_reward_id ?? null,
      ...((stored.cp_rewards || {}).self_pack || {}),
    },
  };
  delete stored.cp_enabled;
  delete stored.cp_cost;
  delete stored.cp_pack_size;
  delete stored.cp_reward_id;
}

const baSettings = {
  ...BA_SETTINGS_DEFAULTS,
  ...stored,
  cp_rewards: Object.fromEntries(
    Object.keys(CP_REWARD_DEFAULTS).map((key) => [
      key,
      { ...CP_REWARD_DEFAULTS[key], ...((stored.cp_rewards || {})[key] || {}) },
    ])
  ),
};

async function saveBaSettings(partial = {}) {
  for (const key of ['starting_bas', 'bits_pack_size', 'bits_pack_cost']) {
    if (partial[key] !== undefined) baSettings[key] = partial[key];
  }
  if (partial.cp_rewards && typeof partial.cp_rewards === 'object') {
    for (const key of Object.keys(CP_REWARD_DEFAULTS)) {
      if (partial.cp_rewards[key] && typeof partial.cp_rewards[key] === 'object') {
        baSettings.cp_rewards[key] = { ...baSettings.cp_rewards[key], ...partial.cp_rewards[key] };
      }
    }
  }
  await settings_db.set('ba_settings', baSettings);
  return baSettings;
}

// "buy 5 more with a 100-bit cheer or 5000 channel points" — shared by chat replies.
function baPurchaseHint() {
  const bits = `a ${baSettings.bits_pack_cost}-bit cheer`;
  const { self_pack, self_single } = baSettings.cp_rewards;
  if (self_pack.enabled) return `${bits} or ${self_pack.cost} channel points`;
  if (self_single.enabled) return `${bits} (or singles for ${self_single.cost} channel points)`;
  return bits;
}

function baKey(username) {
  return String(username || '').replace(/^@/, '').trim().toLowerCase();
}

// null (never seen) → starting balance
function resolveBalance(current) {
  return typeof current === 'number' && Number.isFinite(current) ? current : baSettings.starting_bas;
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

// source tags the change in the economy ledger (see lib/baLedger.js).
async function addToBalance(username, amount, source = 'adjustment') {
  const key = baKey(username);
  if (!key) return null;
  let before = 0;
  const balance = await user_breakaways_db.update(key, (current) => {
    before = resolveBalance(current);
    return Math.max(0, before + amount);
  });
  // Record what actually changed — the zero floor can absorb part of a debit.
  await recordBaEvent({ username: key, delta: balance - before, balance, source });
  return balance;
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
    ? `🎲 Personal Breakaway Mode ACTIVATED. Everyone holds their own breakaways — you start with ${baSettings.starting_bas}. Check yours with !ba_count, buy ${baSettings.bits_pack_size} more with ${baPurchaseHint()}.`
    : `Personal Breakaway Mode DEACTIVATED. Back to the shared pool — personal balances are saved for next time.`;
  client.say(channel, message);
  if (io) io.emit('ba_mode_state', { user_ba_mode: state.user_ba_mode });
  // Pause/unpause the channel point reward to match the mode. Dynamic import keeps
  // this module free of an eval-time cycle (channelPointsService imports us back).
  try {
    const { syncBreakawayRewards } = await import('../channelPointsService.js');
    const channelPoints = await syncBreakawayRewards();
    if (io) io.emit('ba_settings_state', { settings: baSettings, channel_points: channelPoints });
  } catch (error) {
    console.error('[BA] reward sync after !ba_mode failed:', error);
  }
}

async function handleBaCountCommand(channel, tags, client) {
  if (!state.user_ba_mode) {
    client.say(channel, `@${tags['display-name']} breakaways are running from the shared pool right now — no personal balance in play.`);
    return;
  }
  const balance = await getBalance(tags.username);
  client.say(channel, `@${tags['display-name']} you have ${balance} breakaway${balance === 1 ? '' : 's'} left. Buy ${baSettings.bits_pack_size} more with ${baPurchaseHint()}.`);
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
  const balance = await addToBalance(target, amount, 'mod_grant');
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
  const balance = await addToBalance(target, -1, 'breakaway_used');
  emitUserBaUpdate(io, target, balance);
  client.say(channel, `@${target} burns a breakaway — ${balance} remaining.`);
}

// !gift_ba [user] [amount] — any chatter can gift from their own stash. Bare
// "!gift_ba" sends 1 to the hot seat; "!gift_ba 3" (all digits) sends 3 there.
async function handleGiftBaCommand(message, channel, tags, client, io) {
  if (!state.user_ba_mode) {
    client.say(channel, `@${tags['display-name']} gifting only works in Personal Breakaway Mode.`);
    return;
  }
  const parts = message.trim().split(/\s+/);
  let targetArg = parts[1] || '';
  let amountArg = parts[2];
  if (/^\d+$/.test(targetArg) && amountArg === undefined) {
    amountArg = targetArg;
    targetArg = '';
  }
  const sender = baKey(tags.username);
  const target = baKey(targetArg || state.current_turn);
  const amount = amountArg === undefined ? 1 : parseInt(amountArg, 10);

  // Strict target shape: gifting is open to all of chat, and a typo'd target would
  // otherwise mint a junk key that shows up on the public economy page.
  if (!target || !/^[a-z0-9_]{1,25}$/.test(target)) {
    client.say(channel, `Usage: !gift_ba <user> [amount] — or just !gift_ba to gift the hot seat.`);
    return;
  }
  if (target === sender) {
    client.say(channel, `@${tags['display-name']} gifting breakaways to yourself is just holding them dramatically.`);
    return;
  }
  if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
    client.say(channel, `Usage: !gift_ba <user> [amount] — amount must be 1-100.`);
    return;
  }

  // Check-and-debit inside one update so racing gifts can't overdraw the sender.
  const debit = { ok: false, balance: 0 };
  await user_breakaways_db.update(sender, (current) => {
    const bal = resolveBalance(current);
    debit.balance = bal;
    if (bal < amount) return bal;
    debit.ok = true;
    debit.balance = bal - amount;
    return bal - amount;
  });
  if (!debit.ok) {
    client.say(channel, `@${tags['display-name']} you only hold ${debit.balance} breakaway${debit.balance === 1 ? '' : 's'} — can't gift ${amount}.`);
    return;
  }

  await recordBaEvent({ username: sender, delta: -amount, balance: debit.balance, source: 'gift' });
  const targetBalance = await addToBalance(target, amount, 'gift');
  emitUserBaUpdate(io, sender, debit.balance);
  emitUserBaUpdate(io, target, targetBalance);
  client.say(channel, `🎁 @${tags['display-name']} gifts ${amount} breakaway${amount === 1 ? '' : 's'} to @${target} — they now hold ${targetBalance}!`);
}

// Called from the cheer handler. A cheer of exactly bits_pack_cost buys a pack —
// exact match only, so 300/400-bit cheers (SDBAs, turn buys) don't trigger it.
async function handleBaCheerPurchase(userstate, channel, client, io) {
  try {
    if (!state.user_ba_mode) return;
    const bits = parseInt(userstate.bits, 10) || 0;
    if (bits !== baSettings.bits_pack_cost) return;
    const balance = await addToBalance(userstate.username, baSettings.bits_pack_size, 'bits_pack');
    emitUserBaUpdate(io, userstate.username, balance);
    client.say(channel, `💰 @${userstate['display-name']} bought a ${baSettings.bits_pack_size}-pack of breakaways — they now hold ${balance}! Balance & stats: ${profileUrl(userstate.username)}`);
  } catch (error) {
    console.error('[CHEER] ❌ BREAKAWAYS: Failed to credit pack:', error);
  }
}

export {
  handleBaModeCommand,
  handleBaCountCommand,
  handleGiveBaCommand,
  handleUseBaCommand,
  handleGiftBaCommand,
  handleBaCheerPurchase,
  getBalance,
  peekBalance,
  addToBalance,
  emitUserBaUpdate,
  baSettings,
  saveBaSettings
};
