import { state } from './constants.js';
import { profileUrl } from './utils.js';
import { baSettings, saveBaSettings, addToBalance, emitUserBaUpdate, renderRewardTitle } from './commands/breakawayCommands.js';

// Manages the breakaway channel point rewards — a registry of four: pack/single
// credited to the redeemer, and pack/single gifted to the broadcaster's stash.
//
// Twitch only lets the client ID that *created* a custom reward update it or resolve
// its redemptions, so the rewards must be created here (not hand-made in the Twitch
// dashboard). That's what makes prices dynamic: the admin page changes a cost and we
// PATCH the reward live — no rebuild, no restart. It also lets us refund: a
// redemption that can't be honored (mode off, credit failure) is marked CANCELED and
// Twitch returns the points automatically.
//
// Requires the broadcaster token to carry channel:manage:redemptions (see auth.js).
// A token that predates that scope can still *listen* for redemptions
// (channel:read:redemptions) but every create/update/resolve call will 403 — the
// admin page surfaces that as "re-auth needed".

function broadcasterLogin() {
  return String(process.env.twitch_channel || '').replace(/^#/, '').toLowerCase();
}

function broadcasterDisplay() {
  const login = broadcasterLogin();
  return login.charAt(0).toUpperCase() + login.slice(1);
}

// Keys must match CP_REWARD_DEFAULTS in breakawayCommands.js. Titles live in
// settings (admin-editable, {n} = amount) — Twitch rejects duplicate reward
// titles per channel, so keep them distinct.
const REWARD_DEFS = {
  self_pack: {
    target: 'redeemer',
    prompt: (cfg) => `Adds ${cfg.amount} breakaways to your personal stash. Only active while Personal Breakaway Mode is on.`,
  },
  self_single: {
    target: 'redeemer',
    prompt: () => `Adds 1 breakaway to your personal stash. Only active while Personal Breakaway Mode is on.`,
  },
  abba_pack: {
    target: 'broadcaster',
    prompt: (cfg) => `Blesses ${broadcasterDisplay()} with ${cfg.amount} breakaways. Only active while Personal Breakaway Mode is on.`,
  },
  abba_single: {
    target: 'broadcaster',
    prompt: () => `Blesses ${broadcasterDisplay()} with 1 breakaway. Only active while Personal Breakaway Mode is on.`,
  },
};

let apiClient = null;
let io = null;
let broadcasterId = null;
let lastError = null;

// EventSub can redeliver; remember recently handled redemption ids so a replay
// can't double-credit. Insertion-ordered, trimmed to a sane cap.
const handledRedemptions = new Set();
const HANDLED_CAP = 500;

function rewardBody(def, cfg) {
  return {
    title: renderRewardTitle(cfg),
    cost: cfg.cost,
    prompt: def.prompt(cfg),
    // Hidden from viewers unless both the reward and personal-BA mode are on.
    isEnabled: Boolean(cfg.enabled && state.user_ba_mode),
  };
}

function describeTwitchError(error) {
  const status = error?.statusCode;
  if (status === 401 || status === 403) {
    return 'Twitch token is missing channel:manage:redemptions — re-authenticate at /auth to enable reward management.';
  }
  return error?.message || String(error);
}

export function getChannelPointsStatus() {
  const rewards = {};
  let anyLive = false;
  for (const key of Object.keys(REWARD_DEFS)) {
    const cfg = baSettings.cp_rewards[key];
    const live = Boolean(cfg.reward_id && cfg.enabled && state.user_ba_mode && !lastError);
    rewards[key] = { reward_id: cfg.reward_id, live };
    if (live) anyLive = true;
  }
  return {
    initialized: Boolean(apiClient),
    rewards,
    any_live: anyLive,
    error: lastError,
  };
}

// Push one reward's settings at Twitch: create on first enable, otherwise PATCH
// cost/prompt/enabled to match. Reads cfg fresh from baSettings so a reward_id
// written mid-sync is seen.
async function syncOneReward(key) {
  const def = REWARD_DEFS[key];
  const cfg = baSettings.cp_rewards[key];
  if (!cfg.reward_id) {
    // Don't create the reward until it's turned on for the first time.
    if (!cfg.enabled) return;
    const reward = await apiClient.channelPoints.createCustomReward(broadcasterId, rewardBody(def, cfg));
    await saveBaSettings({ cp_rewards: { [key]: { reward_id: reward.id } } });
    console.log(`[CP] Created "${renderRewardTitle(cfg)}" reward (${reward.id}) at ${cfg.cost} points`);
    return;
  }
  try {
    await apiClient.channelPoints.updateCustomReward(broadcasterId, cfg.reward_id, rewardBody(def, cfg));
  } catch (error) {
    // Reward was deleted from the Twitch dashboard — forget the stale id and
    // recreate on the spot if the reward is on.
    if (error?.statusCode === 404) {
      console.warn(`[CP] Stored reward id for ${key} is gone on Twitch, recreating`);
      await saveBaSettings({ cp_rewards: { [key]: { reward_id: null } } });
      return syncOneReward(key);
    }
    throw error;
  }
}

// Sync every reward. Safe to call on any settings change; keeps going past a
// failing reward so one bad apple doesn't strand the rest.
export async function syncBreakawayRewards() {
  if (!apiClient) {
    lastError = 'Twitch API not connected (EventSub not initialized).';
    return getChannelPointsStatus();
  }
  let firstError = null;
  for (const key of Object.keys(REWARD_DEFS)) {
    try {
      await syncOneReward(key);
    } catch (error) {
      const described = describeTwitchError(error);
      console.error(`[CP] Reward sync failed (${key}):`, described);
      if (!firstError) firstError = described;
    }
  }
  lastError = firstError;
  return getChannelPointsStatus();
}

async function say(message) {
  try {
    // Dynamic import: botCommands imports socketHandlers, which imports this module —
    // resolving the chat client lazily keeps module evaluation cycle-free.
    const { client } = await import('./botCommands.js');
    await client.say(process.env.twitch_channel, message);
  } catch (error) {
    console.error('[CP] Chat announce failed:', error.message);
  }
}

async function resolveRedemption(event, status) {
  try {
    await apiClient.channelPoints.updateRedemptionStatusByIds(broadcasterId, event.rewardId, [event.id], status);
  } catch (error) {
    // Not fatal: the redemption stays pending in the Twitch dashboard for a mod.
    console.error(`[CP] Could not mark redemption ${event.id} ${status}:`, describeTwitchError(error));
  }
}

function findRewardKey(rewardId) {
  if (!rewardId) return null;
  return Object.keys(REWARD_DEFS).find((key) => baSettings.cp_rewards[key].reward_id === rewardId) || null;
}

async function handleRedemption(event) {
  // Generic feed for overlays, matching the old pre-"failsafe websockets" event shape.
  io.emit('redemption', {
    user: event.userDisplayName,
    reward: event.rewardTitle,
    input: event.input,
    cost: event.rewardCost,
  });

  const key = findRewardKey(event.rewardId);
  if (!key) return;

  if (handledRedemptions.has(event.id)) return;
  handledRedemptions.add(event.id);
  if (handledRedemptions.size > HANDLED_CAP) {
    handledRedemptions.delete(handledRedemptions.values().next().value);
  }

  if (!state.user_ba_mode) {
    // Shouldn't happen (rewards are disabled when the mode is off), but a
    // redemption can race a mode toggle — refund instead of eating the points.
    await resolveRedemption(event, 'CANCELED');
    await say(`@${event.userDisplayName} Personal Breakaway Mode is off right now — your ${event.rewardCost} channel points were refunded.`);
    return;
  }

  const def = REWARD_DEFS[key];
  const cfg = baSettings.cp_rewards[key];
  const recipient = def.target === 'broadcaster' ? broadcasterLogin() : event.userName;

  try {
    const balance = await addToBalance(recipient, cfg.amount, 'channel_points');
    emitUserBaUpdate(io, recipient, balance);
    await resolveRedemption(event, 'FULFILLED');
    const plural = cfg.amount === 1 ? 'breakaway' : 'breakaways';
    if (def.target === 'broadcaster') {
      await say(`👑 @${event.userDisplayName} blessed ${broadcasterDisplay()} with ${cfg.amount} ${plural} (${event.rewardCost} channel points) — the house now holds ${balance}!`);
    } else {
      await say(`🎟️ @${event.userDisplayName} redeemed ${event.rewardCost} channel points for ${cfg.amount} ${plural} — they now hold ${balance}! Balance & stats: ${profileUrl(event.userName)}`);
    }
  } catch (error) {
    console.error('[CP] Failed to credit redemption:', error);
    await resolveRedemption(event, 'CANCELED');
    await say(`@${event.userDisplayName} something broke while crediting that redemption — your points were refunded. Poke a mod!`);
  }
}

export function initChannelPoints({ apiClient: api, listener, io: socketIo }) {
  apiClient = api;
  io = socketIo;
  broadcasterId = process.env.TWITCH_CHANNEL_ID;

  listener.onChannelRedemptionAdd(broadcasterId, (event) => {
    handleRedemption(event).catch((error) => {
      console.error('[CP] Redemption handler failed:', error);
    });
  });

  // Reconcile on boot so cost changes made while the app was down still land.
  syncBreakawayRewards().then((status) => {
    if (status.error) {
      console.warn('[CP] Rewards not synced:', status.error);
    }
  });
}
