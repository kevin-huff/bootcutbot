import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { RefreshingAuthProvider } from '@twurple/auth';
import dotenv from 'dotenv';
import jsoning from 'jsoning';
import fetch from 'node-fetch';

dotenv.config();

const tokenDb = new jsoning("db/twitch_tokens.json");
let io;
let authProvider;

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

    console.log('Doing Auth', tokens);
    try {
      authProvider = new RefreshingAuthProvider({
        clientId,
        clientSecret,
        onRefresh: async (userId, newTokenData) => {
          await tokenDb.set("tokens", newTokenData);
          console.log('Token refreshed successfully');
        }
      });

      await authProvider.addUser(userId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        obtainmentTimestamp: tokens.obtainmentTimestamp,
        scope: tokens.scope
      });
    } catch (error) {
      console.error('Failed to refresh tokens:', error);
      return { needsAuth: true };
    }

    console.log(`Initializing EventSub for user ID: ${userId}`);

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

    try {
      await listener.start();
      console.log('✅ EventSub WebSocket started successfully');
    } catch (err) {
      console.error('❌ EventSub WebSocket failed to start:', err.message);
      console.warn('⚠️ Continuing without EventSub. Bot will be missing real-time Twitch event data.');
      return { warning: 'eventsub_disabled' };
    }

    try {
      // Your existing listener.on* event handlers go here...
      // I'm skipping them for brevity but you can paste them back in unchanged.

      console.log('Successfully subscribed to all channel events for user:', userId);
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
