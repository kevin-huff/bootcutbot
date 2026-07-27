import { state } from './constants.js';
import { profileUrl } from './utils.js';
import { baSettings, saveBaSettings, addToBalance, emitUserBaUpdate } from './commands/breakawayCommands.js';

// Manages the "Buy Breakaways" channel point reward.
//
// Twitch only lets the client ID that *created* a custom reward update it or resolve
// its redemptions, so the reward must be created here (not hand-made in the Twitch
// dashboard). That's what makes the price dynamic: the admin page changes cp_cost and
// we PATCH the reward live — no rebuild, no restart. It also lets us refund: a
// redemption that can't be honored (mode off, credit failure) is marked CANCELED and
// Twitch returns the points automatically.
//
// Requires the broadcaster token to carry channel:manage:redemptions (see auth.js).
// A token that predates that scope can still *listen* for redemptions
// (channel:read:redemptions) but every create/update/resolve call will 403 — the
// admin page surfaces that as "re-auth needed".

const REWARD_TITLE = 'Buy Breakaways';

let apiClient = null;
let io = null;
let broadcasterId = null;
let lastError = null;

// EventSub can redeliver; remember recently handled redemption ids so a replay
// can't double-credit. Insertion-ordered, trimmed to a sane cap.
const handledRedemptions = new Set();
const HANDLED_CAP = 500;

function rewardBody() {
  return {
    title: REWARD_TITLE,
    cost: baSettings.cp_cost,
    prompt: `Adds ${baSettings.cp_pack_size} breakaways to your personal stash. Only active while Personal Breakaway Mode is on.`,
    // Hidden from viewers unless both the feature and personal-BA mode are on.
    isEnabled: Boolean(baSettings.cp_enabled && state.user_ba_mode),
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
  return {
    initialized: Boolean(apiClient),
    reward_id: baSettings.cp_reward_id,
    live: Boolean(baSettings.cp_reward_id && baSettings.cp_enabled && state.user_ba_mode && !lastError),
    error: lastError,
  };
}

// Push the current settings at Twitch: create the reward on first enable, otherwise
// PATCH cost/prompt/enabled to match. Safe to call on every settings change.
export async function syncBreakawayReward() {
  if (!apiClient) {
    lastError = 'Twitch API not connected (EventSub not initialized).';
    return getChannelPointsStatus();
  }
  try {
    if (!baSettings.cp_reward_id) {
      // Don't create the reward until the feature is turned on for the first time.
      if (baSettings.cp_enabled) {
        const reward = await apiClient.channelPoints.createCustomReward(broadcasterId, rewardBody());
        await saveBaSettings({ cp_reward_id: reward.id });
        console.log(`[CP] Created "${REWARD_TITLE}" reward (${reward.id}) at ${baSettings.cp_cost} points`);
      }
    } else {
      try {
        await apiClient.channelPoints.updateCustomReward(broadcasterId, baSettings.cp_reward_id, rewardBody());
      } catch (error) {
        // Reward was deleted from the Twitch dashboard — forget the stale id and
        // recreate on the spot if the feature is on.
        if (error?.statusCode === 404) {
          console.warn('[CP] Stored reward id is gone on Twitch, recreating');
          await saveBaSettings({ cp_reward_id: null });
          return syncBreakawayReward();
        }
        throw error;
      }
    }
    lastError = null;
  } catch (error) {
    lastError = describeTwitchError(error);
    console.error('[CP] Reward sync failed:', lastError);
  }
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

async function handleRedemption(event) {
  // Generic feed for overlays, matching the old pre-"failsafe websockets" event shape.
  io.emit('redemption', {
    user: event.userDisplayName,
    reward: event.rewardTitle,
    input: event.input,
    cost: event.rewardCost,
  });

  if (!baSettings.cp_reward_id || event.rewardId !== baSettings.cp_reward_id) return;

  if (handledRedemptions.has(event.id)) return;
  handledRedemptions.add(event.id);
  if (handledRedemptions.size > HANDLED_CAP) {
    handledRedemptions.delete(handledRedemptions.values().next().value);
  }

  if (!state.user_ba_mode) {
    // Shouldn't happen (the reward is disabled when the mode is off), but a
    // redemption can race a mode toggle — refund instead of eating the points.
    await resolveRedemption(event, 'CANCELED');
    await say(`@${event.userDisplayName} Personal Breakaway Mode is off right now — your ${event.rewardCost} channel points were refunded.`);
    return;
  }

  try {
    const balance = await addToBalance(event.userName, baSettings.cp_pack_size, 'channel_points');
    emitUserBaUpdate(io, event.userName, balance);
    await resolveRedemption(event, 'FULFILLED');
    await say(`🎟️ @${event.userDisplayName} redeemed ${event.rewardCost} channel points for ${baSettings.cp_pack_size} breakaways — they now hold ${balance}! Balance & stats: ${profileUrl(event.userName)}`);
  } catch (error) {
    console.error('[CP] Failed to credit breakaway pack:', error);
    await resolveRedemption(event, 'CANCELED');
    await say(`@${event.userDisplayName} something broke while crediting your breakaways — your points were refunded. Poke a mod!`);
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

  // Reconcile on boot so a cost change made while the app was down still lands.
  syncBreakawayReward().then((status) => {
    if (status.error) {
      console.warn('[CP] Reward not synced:', status.error);
    }
  });
}
