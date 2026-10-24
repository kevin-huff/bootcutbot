import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { RefreshingAuthProvider } from '@twurple/auth';
import dotenv from 'dotenv';
import { JsoningPg } from './lib/jsoningPg.js';
import fetch from 'node-fetch';
import { initChannelPoints } from './channelPointsService.js';
import { normalizeStoredToken } from './lib/twitchOAuth.js';
import { chatClient, getBotUserId } from './lib/twitchChat.js';
import { isChannelMismatch } from './lib/chatMapping.js';

dotenv.config();

const tokenDb = new JsoningPg('twitch_tokens');
let io;
let authProvider;
let activeListener = null;

export async function initializeEventSub(socketIo) {
  io = socketIo;

  try {
    const tokens = await tokenDb.get("tokens");
    if (!tokens) {
      console.error('No tokens found. Please authenticate first.');
      return { needsAuth: true };
    }

    const clientId = process.env.EVENTSUB_CLIENT_ID;
    const clientSecret = process.env.EVENTSUB_CLIENT_SECRET;
    const userId = process.env.TWITCH_CHANNEL_ID;

    try {
      authProvider = new RefreshingAuthProvider({
        clientId,
        clientSecret,
        onRefresh: async (userId, newTokenData) => {
          await tokenDb.set("tokens", newTokenData);
          console.log('Token refreshed successfully');
        }
      });

      await authProvider.addUser(userId, normalizeStoredToken(tokens));
    } catch (error) {
      console.error('Failed to refresh tokens:', error);
      return { needsAuth: true };
    }

    console.log(`Initializing EventSub for user ID: ${userId}`);

    if (activeListener) {
      try {
        activeListener.stop();
      } catch (stopErr) {
        console.warn('Previous EventSub listener was already stopped:', stopErr.message);
      }
      activeListener = null;
      chatClient.detach();
    }

    const apiClient = new ApiClient({ authProvider });
    const listener = new EventSubWsListener({
      apiClient,
      logger: {
        minLevel: 'info',
        emit: (level, text) => console.log(`[EventSub ${level}] ${text}`)
      },
      url: process.env.NODE_ENV === 'development'
        ? 'ws://localhost:8080/ws'
        : undefined
    });

    console.log('Using EventSub server:', process.env.NODE_ENV === 'development'
      ? 'Twitch CLI local test server'
      : 'Twitch production server');

    listener.onSubscriptionCreateFailure((subscription, error) => {
      console.error(`EventSub subscription ${subscription.id} failed to create: ${error.message}`);
    });

    try {
      await listener.start();
      console.log('✅ EventSub WebSocket started successfully');
    } catch (err) {
      console.error('❌ EventSub WebSocket failed to start:', err.message);
      console.warn('⚠️ Continuing without EventSub. Bot will be missing real-time Twitch event data.');
      return { warning: 'eventsub_disabled' };
    }

    activeListener = listener;

    try {
      const canReadChat = authProvider.getCurrentScopesForUser(userId).includes('user:read:chat');
      if (!canReadChat) {
        console.warn('[chat] Broadcaster token lacks user:read:chat. Chat commands stay off until the broadcaster re-authorizes at /auth.');
      }
      // Chat goes to TWITCH_CHANNEL_ID; refuse it when that names a different channel than twitch_channel
      // (a copied ID would put this environment's bot in someone else's live chat).
      const broadcaster = await apiClient.users.getUserById(userId).catch(() => null);
      if (isChannelMismatch(broadcaster?.name, process.env.twitch_channel)) {
        console.error(`[chat] TWITCH_CHANNEL_ID ${userId} is ${broadcaster.name}, but twitch_channel is ${process.env.twitch_channel}. Chat stays off until both name the same channel.`);
      } else {
        const botUserId = getBotUserId();
        chatClient.attach({ apiClient, listener: canReadChat ? listener : null, broadcasterId: userId, botUserId });
        console.log(`[chat] Reading chat: ${canReadChat ? 'yes' : 'no'}, sending: yes, channel id ${userId}, sending as bot user id ${botUserId}${process.env.TWITCH_BOT_ID ? '' : ' (TWITCH_BOT_ID unset, using the default)'}`);
      }
    } catch (chatErr) {
      console.error('[chat] Failed to attach chat client:', chatErr.message);
    }

    try {
      // Chat, bits and subs run through lib/twitchChat.js on this listener (plus
      // Streamlabs in botCommands.js). Channel point redemptions also arrive here;
      // the service owns the "Buy Breakaways" reward (create/reprice/refund).
      initChannelPoints({ apiClient, listener, io });

      console.log('Successfully subscribed to channel point redemptions for user:', userId);
    } catch (subError) {
      console.error('Failed to subscribe to EventSub events:', subError);
      console.warn('⚠️ Subscriptions failed. Bot will continue without Twitch event integrations.');
      return { warning: 'eventsub_subscribe_failed' };
    }

    return listener;
  } catch (error) {
    console.error('Failed to initialize EventSub:', error);
    if (error.message) console.error('Error message:', error.message);
    if (error.stack) console.error('Stack trace:', error.stack);
    return null;
  }
}
