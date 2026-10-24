import { splitChatMessage, chatMessageToTmi, chatNotificationToTmi } from './chatMapping.js';

export const BOT_USER_ID_FALLBACK = '772229635';

const SEEN_LIMIT = 1000;

export function getBotUserId(env = process.env) {
  return String(env.TWITCH_BOT_ID || BOT_USER_ID_FALLBACK);
}

export function createChatClient({ logger = console, sendTimeoutMs = 10000 } = {}) {
  const handlers = new Map();
  const seen = new Set();
  let sender = null;
  let listener = null;
  let subscriptions = [];
  let tail = Promise.resolve();

  const client = {
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
      return client;
    },

    say(channel, text) {
      const run = tail.then(() => sendText(text));
      tail = run.catch(() => false);
      return run.catch(() => false);
    },

    attach({ apiClient, listener: nextListener = null, broadcasterId, botUserId }) {
      sender = { apiClient, broadcasterId, botUserId };
      if (!nextListener || nextListener === listener) return;
      stopSubscriptions();
      listener = nextListener;
      subscriptions = [
        listener.onChannelChatMessage(broadcasterId, broadcasterId, (e) => client.handleChatMessage(e)),
        listener.onChannelChatNotification(broadcasterId, broadcasterId, (e) => client.handleChatNotification(e))
      ];
    },

    detach() {
      sender = null;
      stopSubscriptions();
      listener = null;
    },

    status() {
      return {
        reading: listener !== null,
        sending: sender !== null,
        botUserId: sender ? String(sender.botUserId) : null
      };
    },

    handleChatMessage(event) {
      if (isDuplicate(event)) return;
      const botUserId = sender ? sender.botUserId : getBotUserId();
      let mapped;
      try {
        mapped = chatMessageToTmi(event, botUserId);
      } catch (err) {
        logger.error(`[chat] could not map chat message: ${err.message}`);
        return;
      }
      const [channel, tags, text] = mapped.args;
      logger.log(`[chat] ${channel} ${tags.username}: ${text}`);
      emit(mapped.name, mapped.args);
    },

    handleChatNotification(event) {
      if (isDuplicate(event)) return;
      let mapped;
      try {
        mapped = chatNotificationToTmi(event);
      } catch (err) {
        logger.error(`[chat] could not map chat notification: ${err.message}`);
        return;
      }
      if (!mapped) return;
      logger.log(`[chat] ${mapped.args[0]} ${mapped.name}: ${mapped.args[1]}`);
      emit(mapped.name, mapped.args);
    }
  };

  function stopSubscriptions() {
    for (const sub of subscriptions) {
      try {
        const stopped = sub && typeof sub.stop === 'function' ? sub.stop() : null;
        if (stopped && typeof stopped.catch === 'function') stopped.catch(() => {});
      } catch {
        // listener already stopped
      }
    }
    subscriptions = [];
  }

  function isDuplicate(event) {
    const id = event && event.messageId;
    if (!id) return false;
    if (seen.has(id)) return true;
    seen.add(id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
    return false;
  }

  function emit(name, args) {
    for (const handler of [...(handlers.get(name) || [])]) {
      try {
        const result = handler(...args);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => logger.error(`[chat] '${name}' handler failed: ${err && err.message}`));
        }
      } catch (err) {
        logger.error(`[chat] '${name}' handler failed: ${err && err.message}`);
      }
    }
  }

  async function sendText(text) {
    const chunks = splitChatMessage(text);
    let allSent = true;
    for (const chunk of chunks) {
      const current = sender;
      if (!current) {
        logger.warn('[chat] cannot send, chat is not connected yet: authorize at /auth');
        return false;
      }
      if (!(await sendChunk(current, chunk))) allSent = false;
    }
    return allSent;
  }

  async function sendChunk({ apiClient, broadcasterId, botUserId }, chunk) {
    let timer;
    try {
      const sending = Promise.resolve().then(() => apiClient.chat.sendChatMessageAsApp(botUserId, broadcasterId, chunk));
      sending.catch(() => {});
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`send timed out after ${sendTimeoutMs}ms`)), sendTimeoutMs);
      });
      const result = await Promise.race([sending, timeout]);
      if (result && result.isSent) return true;
      const code = result ? result.dropReasonCode : undefined;
      const message = result ? result.dropReasonMessage : undefined;
      logger.warn(`[chat] message dropped by Twitch: ${code || 'unknown'} ${message || ''}`.trim());
      return false;
    } catch (err) {
      const hint =
        err && (err.statusCode === 401 || err.statusCode === 403)
          ? ' (check authorization at /auth and that the bot account is a moderator)'
          : '';
      logger.error(`[chat] send failed: ${err && err.message}${hint}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return client;
}

export const chatClient = createChatClient();
