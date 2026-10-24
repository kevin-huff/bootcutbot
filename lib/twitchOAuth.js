import crypto from 'crypto';

export const BROADCASTER_SCOPES = [
    'bits:read',
    'channel:read:subscriptions',
    'channel:read:predictions',
    'channel:read:polls',
    'channel:read:redemptions',
    // Create/update the "Buy Breakaways" reward and fulfill/refund redemptions.
    // Added 2026-07 — tokens issued before then need a fresh /auth pass.
    'channel:manage:redemptions',
    'channel:read:hype_train',
    'channel:read:goals',
    'moderator:read:followers',
    'channel:read:stream_key',
    'moderator:read:shoutouts',
    'analytics:read:extensions',
    'user:read:chat',
    'channel:bot'
];

export const BOT_SCOPES = ['user:bot', 'user:write:chat', 'user:read:chat'];

export const DEFAULT_REDIRECT_URI = 'https://leantube.org/auth/twitch/callback';

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 20;
const FLOWS = ['broadcaster', 'bot'];

const pendingStates = new Map();

export function getRedirectUri(env = process.env) {
    return env.TWITCH_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}

export function createOAuthState(flow, now = Date.now()) {
    if (!FLOWS.includes(flow)) {
        throw new Error(`Unknown OAuth flow: ${flow}`);
    }
    for (const [key, entry] of pendingStates) {
        if (entry.expires <= now) pendingStates.delete(key);
    }
    while (pendingStates.size >= MAX_PENDING_STATES) {
        pendingStates.delete(pendingStates.keys().next().value);
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { flow, expires: now + STATE_TTL_MS });
    return state;
}

export function consumeOAuthState(state, now = Date.now()) {
    const entry = pendingStates.get(state);
    if (!entry) return null;
    pendingStates.delete(state);
    return entry.expires > now ? entry.flow : null;
}

export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
    const enc = encodeURIComponent;
    return `https://id.twitch.tv/oauth2/authorize?client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&response_type=code&scope=${enc(scopes.join(' '))}&force_verify=true&state=${enc(state)}`;
}

export function verifyAuthorizedAccount({ flow, userId, login, scopes = [], broadcasterId, botUserId }) {
    const who = login || 'unknown';
    if (flow === 'broadcaster') {
        if (!broadcasterId || String(userId) !== String(broadcasterId)) {
            throw new Error(`Signed in as ${who}, which is not the broadcaster account. Nothing was saved.`);
        }
        return;
    }
    if (flow === 'bot') {
        if (String(userId) !== String(botUserId)) {
            throw new Error(`Signed in as ${who}, which is not the bot account. Nothing was saved.`);
        }
        const missing = ['user:bot', 'user:write:chat'].filter((s) => !scopes.includes(s));
        if (missing.length) {
            throw new Error(`Signed in as ${who}, but the bot grant is missing ${missing.join(' and ')}. Nothing was saved.`);
        }
        return;
    }
    throw new Error(`Signed in as ${who}, but the sign-in flow is unknown. Nothing was saved.`);
}

export function normalizeStoredToken(stored) {
    const t = stored || {};
    const expiresIn = t.expiresIn ?? t.expires_in;
    let scope = t.scope;
    if (typeof scope === 'string') scope = scope.split(/\s+/).filter(Boolean);
    if (!Array.isArray(scope)) scope = [];
    const obtained = t.obtainmentTimestamp;
    return {
        accessToken: t.accessToken ?? t.access_token,
        refreshToken: t.refreshToken ?? t.refresh_token,
        expiresIn: typeof expiresIn === 'number' ? expiresIn : null,
        obtainmentTimestamp: typeof obtained === 'number' ? obtained : 0,
        scope
    };
}
