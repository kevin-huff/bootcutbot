import { JsoningPg } from './lib/jsoningPg.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { getTokenInfo } from '@twurple/auth';
import {
    BROADCASTER_SCOPES,
    BOT_SCOPES,
    getRedirectUri,
    createOAuthState,
    consumeOAuthState,
    buildAuthorizeUrl,
    verifyAuthorizedAccount
} from './lib/twitchOAuth.js';
import { getBotUserId } from './lib/twitchChat.js';

dotenv.config();

const tokenDb = new JsoningPg('twitch_tokens');

export async function handleAuthCallback(code, state) {
    const flow = consumeOAuthState(state);
    if (!flow) {
        throw new Error('This sign-in link expired or was already used. Start again from /auth.');
    }

    const clientId = process.env.EVENTSUB_CLIENT_ID;
    const clientSecret = process.env.EVENTSUB_CLIENT_SECRET;

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: getRedirectUri()
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const tokens = await response.json();
    const info = await getTokenInfo(tokens.access_token, clientId);

    verifyAuthorizedAccount({
        flow,
        userId: info.userId,
        login: info.userName,
        scopes: info.scopes,
        broadcasterId: process.env.TWITCH_CHANNEL_ID,
        botUserId: getBotUserId()
    });

    if (flow === 'broadcaster') {
        // Add the timestamp of when the token was obtained
        tokens.obtainmentTimestamp = Date.now();
        await tokenDb.set("tokens", tokens);
        console.log('Tokens saved successfully');
    } else {
        console.log(`Bot account ${info.userName} authorized chat sending; nothing stored`);
    }

    return { flow, login: info.userName };
}

export function getAuthUrl() {
    return buildAuthorizeUrl({
        clientId: process.env.EVENTSUB_CLIENT_ID,
        redirectUri: getRedirectUri(),
        scopes: BROADCASTER_SCOPES,
        state: createOAuthState('broadcaster')
    });
}

export function getBotAuthUrl() {
    return buildAuthorizeUrl({
        clientId: process.env.EVENTSUB_CLIENT_ID,
        redirectUri: getRedirectUri(),
        scopes: BOT_SCOPES,
        state: createOAuthState('bot')
    });
}
