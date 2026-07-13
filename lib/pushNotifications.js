import webpush from 'web-push';
import { JsoningPg } from './jsoningPg.js';

// Web Push subscriptions for "notify me when it's this user's turn".
// Namespace: one key per watched user (their lowercased login / profile slug);
// value is an array of browser PushSubscription objects ({ endpoint, keys }).
const subs_db = new JsoningPg('push_subscriptions');

// A single browser subscription may be stored under several users' keys (a viewer
// can watch more than one contestant), so unsubscribing from one user only removes
// that user's mapping — the browser subscription itself is left intact.

const MAX_SUBS_PER_USER = 2000; // spam guard on the public subscribe route

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@leantube.org';
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

export function pushEnabled() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function normalizeKey(name) {
  return String(name || '').replace(/^@/, '').trim().toLowerCase();
}

export function isValidWatchKey(key) {
  return /^[a-z0-9_]{1,25}$/.test(key);
}

function isValidSubscription(sub) {
  return !!(sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://')
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string');
}

export async function addSubscription(watchName, subscription) {
  const key = normalizeKey(watchName);
  if (!isValidWatchKey(key)) throw new Error('invalid username');
  if (!isValidSubscription(subscription)) throw new Error('invalid subscription');
  await subs_db.update(key, (existing) => {
    const arr = Array.isArray(existing) ? existing.slice() : [];
    const idx = arr.findIndex((s) => s.endpoint === subscription.endpoint);
    if (idx >= 0) {
      arr[idx] = subscription; // refresh keys on re-subscribe
    } else if (arr.length < MAX_SUBS_PER_USER) {
      arr.push(subscription);
    }
    return arr;
  });
  return key;
}

export async function removeSubscription(watchName, endpoint) {
  const key = normalizeKey(watchName);
  if (!isValidWatchKey(key) || !endpoint) return;
  await subs_db.update(key, (existing) => {
    const arr = Array.isArray(existing) ? existing.slice() : [];
    return arr.filter((s) => s.endpoint !== endpoint);
  });
}

async function dispatch(key, payload) {
  const subs = await subs_db.get(key);
  if (!Array.isArray(subs) || subs.length === 0) return 0;

  const dead = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      const code = err && err.statusCode;
      // 404/410 mean the subscription is gone for good — prune it.
      if (code === 404 || code === 410) dead.push(sub.endpoint);
      else console.error(`[push] send to ${key} failed (${code || 'no-status'}):`, (err && err.body) || (err && err.message) || err);
    }
  }));

  if (dead.length) {
    await subs_db.update(key, (existing) => {
      const arr = Array.isArray(existing) ? existing.slice() : [];
      return arr.filter((s) => !dead.includes(s.endpoint));
    });
  }
  return subs.length - dead.length;
}

// Fire a "it's your turn" push to everyone watching this player. Safe to call
// fire-and-forget; resolves to the number of live subscriptions notified.
export async function notifyTurn(player) {
  if (!ensureVapid()) return 0;

  const keys = new Set();
  if (player && player.username) keys.add(normalizeKey(player.username));
  if (player && player['display-name']) keys.add(normalizeKey(player['display-name']));
  keys.delete('');
  if (keys.size === 0) return 0;

  const display = (player && (player['display-name'] || player.username)) || 'You';
  const channel = process.env.twitch_channel || 'abbabox';
  const payload = JSON.stringify({
    title: "🎲 It's your turn on Bootcut!",
    body: `${display}, you're in the hot seat — hop to the stream now.`,
    url: `https://www.twitch.tv/${channel}`,
    tag: 'bootcut-turn',
  });

  let notified = 0;
  for (const key of keys) {
    try {
      notified += await dispatch(key, payload);
    } catch (err) {
      console.error(`[push] notifyTurn failed for ${key}:`, err && err.message ? err.message : err);
    }
  }
  return notified;
}
