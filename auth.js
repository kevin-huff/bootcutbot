import jsoning from 'jsoning';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const tokenDb = new jsoning("db/twitch_tokens.json");

export async function handleAuthCallback(code) {
    const clientId = process.env.EVENTSUB_CLIENT_ID;
    const clientSecret = process.env.EVENTSUB_CLIENT_SECRET;
    const redirectUri = 'https://leantube.org/auth/twitch/callback';

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
            redirect_uri: redirectUri
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const tokens = await response.json();
    // Add the timestamp of when the token was obtained
    tokens.obtainmentTimestamp = Date.now();
    await tokenDb.set("tokens", tokens);
    console.log('Tokens saved successfully');
    return tokens;
}

export function getAuthUrl() {
    const scopes = [
        'bits:read',
        'channel:read:subscriptions',
        'channel:read:predictions',
        'channel:read:polls',
        'channel:read:redemptions',
        'channel:read:hype_train',
        'channel:read:goals',
        'moderator:read:followers',
        'channel:read:stream_key',
        'moderator:read:shoutouts',
        'analytics:read:extensions'
    ];
    const clientId = process.env.EVENTSUB_CLIENT_ID;
    const redirectUri = 'https://leantube.org/auth/twitch/callback';
    
    return `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&force_verify=true`;
}
