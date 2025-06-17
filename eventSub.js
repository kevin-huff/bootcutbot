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
    // Get stored tokens
    const tokens = await tokenDb.get("tokens");
    if (!tokens) {
      console.error('No tokens found. Please authenticate first.');
      return { needsAuth: true };
    }

    const clientId = process.env.EVENTSUB_CLIENT_ID;
    const clientSecret = process.env.EVENTSUB_CLIENT_SECRET;
    const userId = process.env.TWITCH_CHANNEL_ID;

    console.log('Doing Auth',tokens);
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
    }
    catch (error) {
      console.error('Failed to refresh tokens:', error);
      return { needsAuth: true };
    }
   
    console.log(`Initializing EventSub for user ID: ${userId}`);

    // Create API client
    const apiClient = new ApiClient({ authProvider });

    // Create EventSub listener
    const listener = new EventSubWsListener({
      apiClient,
      logger: {
        minLevel: 'info',
        emit: (level, text) => console.log(`[EventSub ${level}] ${text}`)
      },
      // Use Twitch CLI websocket server in development
      url: process.env.NODE_ENV === 'development' 
        ? 'ws://localhost:8080/ws' 
        : undefined
    });

    console.log('Using EventSub server:', process.env.NODE_ENV === 'development' 
      ? 'Twitch CLI local test server' 
      : 'Twitch production server');

    // Start the listener before subscribing
    await listener.start();
    console.log('EventSub WebSocket started successfully');

    try {
      // Subscribe to channel cheer events
      listener.onChannelCheer(userId, async (event) => {
        console.log('Received cheer event:', event);
        // Add 1 minute for every 100 bits
        const minutes = Math.floor(event.bits / 100);
        if (minutes > 0) {
          const socketHandlers = global.app.get('socketHandlers');
          if (socketHandlers && socketHandlers.handleSubathonAddTime) {
            await socketHandlers.handleSubathonAddTime(minutes * 60, `bits_${event.bits}`, io);
          } else {
            console.error('Socket handlers not found for bits');
          }
        }
        io.emit('cheer', {
          user: event.userDisplayName,
          bits: event.bits,
          message: event.message
        });
      });

      // Subscribe to subscription events
      listener.onChannelSubscription(userId, async (event) => {
        console.log('Received subscription event:', event);
        // Add time based on subscription tier
        let minutes = 5; // Tier 1 default (5 minutes)
        if (event.tier === '2000') minutes = 10; // Tier 2 (10 minutes)
        if (event.tier === '3000') minutes = 25; // Tier 3 (25 minutes)
        
        // Handle regular subs, resubs, and individual gift subs
        const socketHandlers = global.app.get('socketHandlers');
        if (socketHandlers && socketHandlers.handleSubathonAddTime) {
          // Create appropriate time source identifier
          let timeSource;
          if (event.isGift) {
            // For gift subs, include gifter name only if it exists
            timeSource = event.gifterDisplayName ? 
              `giftsub_from_${event.gifterDisplayName}_to_${event.userDisplayName}` :
              `giftsub_to_${event.userDisplayName}`;
          } else if (event.isResub) {
            timeSource = `resub_tier_${event.tier}_month_${event.months}`;
          } else {
            timeSource = `sub_tier_${event.tier}`;
          }
          await socketHandlers.handleSubathonAddTime(minutes * 60, timeSource, io);
        } else {
          console.error('Socket handlers not found for subs');
        }
        
        io.emit('subscription', {
          user: event.userDisplayName,
          tier: event.tier,
          message: event.message,
          isGift: event.isGift,
          isResub: event.isResub,
          months: event.months,
          gifter: event.isGift && event.gifterDisplayName ? event.gifterDisplayName : null
        });
      });

      // Subscribe to subscription gift events
      listener.onChannelSubscriptionGift(userId, async (event) => {
        console.log('Received subscription gift event:', event);
        // We don't need to add time here since each individual gift sub will be handled by onChannelSubscription
        
        io.emit('subscription_gift', {
          gifter: event.gifterDisplayName,
          count: event.count,
          tier: event.tier
        });
      });

      // Subscribe to channel point redemption events
      listener.onChannelRedemptionAdd(userId, (event) => {
        console.log('Received channel point redemption:', event);
        io.emit('redemption', {
          user: event.userDisplayName,
          reward: event.rewardTitle,
          input: event.input,
          cost: event.rewardCost
        });
      });

      // Subscribe to prediction events
      listener.onChannelPredictionBegin(userId, (event) => {
        console.log('Prediction started:', event);
        io.emit('prediction_begin', {
          title: event.title,
          outcomes: event.outcomes,
          startDate: event.startDate,
          endDate: event.endDate
        });
      });

      listener.onChannelPredictionEnd(userId, (event) => {
        console.log('Prediction ended:', event);
        io.emit('prediction_end', {
          title: event.title,
          outcomes: event.outcomes,
          winningOutcome: event.winningOutcome,
          status: event.status
        });
      });

      // Subscribe to poll events
      listener.onChannelPollBegin(userId, (event) => {
        console.log('Poll started:', [event]);
        io.emit('poll_begin', {
          title: event.title,
          choices: event.choices,
          startDate: event.startDate,
          endDate: event.endDate
        });
      });

      listener.onChannelPollEnd(userId, (event) => {
        console.log('Poll ended:', event);
        io.emit('poll_end', {
          title: event.title,
          choices: event.choices,
          status: event.status
        });
      });

      // Subscribe to Hype Train events
      listener.onChannelHypeTrainBegin(userId, (event) => {
        console.log('Hype Train started:', event);
        io.emit('hype_train_begin', {
          total: event.total,
          progress: event.progress,
          goal: event.goal,
          level: event.level
        });
      });

      listener.onChannelHypeTrainEnd(userId, (event) => {
        console.log('Hype Train ended:', event);
        io.emit('hype_train_end', {
          level: event.level,
          total: event.total,
          topContributors: event.topContributors
        });
      });

      // Subscribe to raid events
      listener.onChannelRaidFrom(userId, async (event) => {
        console.log('Received raid:', event);
        // Add 1 minute for every 2 viewers in the raid
        const minutes = Math.floor(event.viewers / 2);
        if (minutes > 0) {
          const socketHandlers = global.app.get('socketHandlers');
          if (socketHandlers && socketHandlers.handleSubathonAddTime) {
            await socketHandlers.handleSubathonAddTime(minutes * 60, `raid_${event.viewers}`, io);
          } else {
            console.error('Socket handlers not found for raid');
          }
        }
        io.emit('raid', {
          raidingBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
          viewers: event.viewers
        });
      });

      // Subscribe to stream status events
      listener.onStreamOnline(userId, (event) => {
        console.log('Stream went online:', event);
        io.emit('stream_status', {
          status: 'online',
          startDate: event.startDate
        });
      });

      listener.onStreamOffline(userId, (event) => {
        console.log('Stream went offline');
        io.emit('stream_status', {
          status: 'offline'
        });
      });

      // Subscribe to shoutout events
      listener.onChannelShoutoutCreate(userId, (event) => {
        console.log('Shoutout created:', event);
        io.emit('shoutout_create', {
          targetBroadcasterDisplayName: event.targetBroadcasterDisplayName,
          viewerCount: event.viewerCount,
          startDate: event.startDate
        });
      });

      listener.onChannelShoutoutReceive(userId, (event) => {
        console.log('Shoutout received:', event);
        io.emit('shoutout_receive', {
          broadcasterDisplayName: event.broadcasterDisplayName,
          viewerCount: event.viewerCount,
          startDate: event.startDate
        });
      });

      // Subscribe to channel goal events
      listener.onChannelGoalBegin(userId, (event) => {
        console.log('Channel goal started:', event);
        io.emit('goal_begin', {
          title: event.title,
          description: event.description,
          currentAmount: event.currentAmount,
          targetAmount: event.targetAmount,
          startDate: event.startDate,
          endDate: event.endDate
        });
      });

      listener.onChannelGoalEnd(userId, (event) => {
        console.log('Channel goal ended:', event);
        io.emit('goal_end', {
          title: event.title,
          status: event.status,
          currentAmount: event.currentAmount,
          targetAmount: event.targetAmount
        });
      });

      console.log('Successfully subscribed to all channel events for user:', userId);
    } catch (subError) {
      console.error('Failed to subscribe to cheer events:', subError);
      throw subError;
    }

    return listener;
  } catch (error) {
    console.error('Failed to initialize EventSub:', error);
    if (error.message) console.error('Error message:', error.message);
    if (error.stack) console.error('Stack trace:', error.stack);
    return null;
  }
}
