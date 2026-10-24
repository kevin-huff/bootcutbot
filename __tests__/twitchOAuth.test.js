import {
    BROADCASTER_SCOPES,
    BOT_SCOPES,
    DEFAULT_REDIRECT_URI,
    getRedirectUri,
    createOAuthState,
    consumeOAuthState,
    buildAuthorizeUrl,
    verifyAuthorizedAccount,
    normalizeStoredToken
} from '../lib/twitchOAuth.js';

const TEN_MIN = 10 * 60 * 1000;

describe('scopes', () => {
    test('broadcaster scopes keep the old list in order then add chat scopes', () => {
        expect(BROADCASTER_SCOPES).toEqual([
            'bits:read',
            'channel:read:subscriptions',
            'channel:read:predictions',
            'channel:read:polls',
            'channel:read:redemptions',
            'channel:manage:redemptions',
            'channel:read:hype_train',
            'channel:read:goals',
            'moderator:read:followers',
            'channel:read:stream_key',
            'moderator:read:shoutouts',
            'analytics:read:extensions',
            'user:read:chat',
            'channel:bot'
        ]);
    });

    test('bot scopes', () => {
        expect(BOT_SCOPES).toEqual(['user:bot', 'user:write:chat', 'user:read:chat']);
    });
});

describe('getRedirectUri', () => {
    test('uses the env var when set', () => {
        expect(getRedirectUri({ TWITCH_REDIRECT_URI: 'https://staging.example/auth/twitch/callback' }))
            .toBe('https://staging.example/auth/twitch/callback');
    });

    test('falls back to the default', () => {
        expect(getRedirectUri({})).toBe(DEFAULT_REDIRECT_URI);
        expect(getRedirectUri({ TWITCH_REDIRECT_URI: '' })).toBe('https://leantube.org/auth/twitch/callback');
    });
});

describe('OAuth state', () => {
    test('is 32 hex characters and unique', () => {
        const a = createOAuthState('broadcaster', 1000);
        const b = createOAuthState('bot', 1000);
        expect(a).toMatch(/^[0-9a-f]{32}$/);
        expect(b).toMatch(/^[0-9a-f]{32}$/);
        expect(a).not.toBe(b);
        consumeOAuthState(a, 1000);
        consumeOAuthState(b, 1000);
    });

    test('is single use and returns its flow', () => {
        const s = createOAuthState('bot', 1000);
        expect(consumeOAuthState(s, 1001)).toBe('bot');
        expect(consumeOAuthState(s, 1002)).toBeNull();
    });

    test('unknown state returns null', () => {
        expect(consumeOAuthState('nope', 1000)).toBeNull();
        expect(consumeOAuthState(undefined, 1000)).toBeNull();
    });

    test('expires after 10 minutes', () => {
        const ok = createOAuthState('broadcaster', 5000);
        expect(consumeOAuthState(ok, 5000 + TEN_MIN - 1)).toBe('broadcaster');
        const late = createOAuthState('broadcaster', 5000);
        expect(consumeOAuthState(late, 5000 + TEN_MIN)).toBeNull();
        expect(consumeOAuthState(late, 5000)).toBeNull();
    });

    test('unknown flows throw', () => {
        expect(() => createOAuthState('admin')).toThrow();
        expect(() => createOAuthState(undefined)).toThrow();
    });

    test('a 21st pending state evicts the oldest', () => {
        const base = 10_000_000;
        const states = [];
        for (let i = 0; i < 21; i++) states.push(createOAuthState('broadcaster', base + i));
        expect(consumeOAuthState(states[0], base + 30)).toBeNull();
        for (let i = 1; i < 21; i++) {
            expect(consumeOAuthState(states[i], base + 30)).toBe('broadcaster');
        }
    });

    test('expired entries are pruned on create', () => {
        const base = 50_000_000;
        const old = [];
        for (let i = 0; i < 20; i++) old.push(createOAuthState('bot', base));
        const fresh = createOAuthState('broadcaster', base + TEN_MIN + 1);
        expect(consumeOAuthState(fresh, base + TEN_MIN + 2)).toBe('broadcaster');
        old.forEach((s) => expect(consumeOAuthState(s, base)).toBeNull());
    });
});

describe('buildAuthorizeUrl', () => {
    test('carries every parameter', () => {
        const url = buildAuthorizeUrl({
            clientId: 'cid 1',
            redirectUri: 'https://leantube.org/auth/twitch/callback',
            scopes: ['user:bot', 'user:write:chat'],
            state: 'abc123'
        });
        expect(url.startsWith('https://id.twitch.tv/oauth2/authorize?')).toBe(true);
        expect(url).toContain('scope=user%3Abot%20user%3Awrite%3Achat');
        const u = new URL(url);
        expect(u.searchParams.get('client_id')).toBe('cid 1');
        expect(u.searchParams.get('redirect_uri')).toBe('https://leantube.org/auth/twitch/callback');
        expect(u.searchParams.get('response_type')).toBe('code');
        expect(u.searchParams.get('scope')).toBe('user:bot user:write:chat');
        expect(u.searchParams.get('force_verify')).toBe('true');
        expect(u.searchParams.get('state')).toBe('abc123');
    });
});

describe('verifyAuthorizedAccount', () => {
    const botScopes = ['user:bot', 'user:write:chat', 'user:read:chat'];

    test('broadcaster passes when ids match (string or number)', () => {
        expect(verifyAuthorizedAccount({ flow: 'broadcaster', userId: '55', login: 'abbabox', broadcasterId: 55 })).toBeUndefined();
    });

    test('broadcaster refuses the wrong account and names the login', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'broadcaster', userId: '772229635', login: 'abbadabbabot', broadcasterId: '55' }))
            .toThrow(/abbadabbabot.*Nothing was saved/);
    });

    test('broadcaster refuses when broadcasterId is empty', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'broadcaster', userId: '55', login: 'abbabox', broadcasterId: '' }))
            .toThrow(/abbabox.*Nothing was saved/);
        expect(() => verifyAuthorizedAccount({ flow: 'broadcaster', userId: 'undefined', login: 'abbabox' }))
            .toThrow(/Nothing was saved/);
    });

    test('bot passes with the right id and scopes', () => {
        expect(verifyAuthorizedAccount({ flow: 'bot', userId: '772229635', login: 'abbadabbabot', scopes: botScopes, botUserId: '772229635' })).toBeUndefined();
    });

    test('bot refuses the wrong account', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'bot', userId: '55', login: 'abbabox', scopes: botScopes, botUserId: '772229635' }))
            .toThrow(/abbabox.*Nothing was saved/);
    });

    test('bot refuses when user:bot is missing', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'bot', userId: '1', login: 'abbadabbabot', scopes: ['user:write:chat'], botUserId: '1' }))
            .toThrow(/abbadabbabot.*Nothing was saved/);
    });

    test('bot refuses when user:write:chat is missing', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'bot', userId: '1', login: 'abbadabbabot', scopes: ['user:bot'], botUserId: '1' }))
            .toThrow(/abbadabbabot.*Nothing was saved/);
    });

    test('bot refuses when scopes are omitted', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'bot', userId: '1', login: 'abbadabbabot', botUserId: '1' }))
            .toThrow(/Nothing was saved/);
    });

    test('unknown flow refuses', () => {
        expect(() => verifyAuthorizedAccount({ flow: 'other', userId: '1', login: 'someone', broadcasterId: '1', botUserId: '1' }))
            .toThrow(/someone.*Nothing was saved/);
    });
});

describe('normalizeStoredToken', () => {
    test('reads the snake_case shape saved by the callback', () => {
        expect(normalizeStoredToken({
            access_token: 'a',
            refresh_token: 'r',
            expires_in: 14000,
            scope: ['bits:read', 'user:read:chat'],
            obtainmentTimestamp: 1700000000000
        })).toEqual({
            accessToken: 'a',
            refreshToken: 'r',
            expiresIn: 14000,
            obtainmentTimestamp: 1700000000000,
            scope: ['bits:read', 'user:read:chat']
        });
    });

    test('reads the camelCase shape saved by onRefresh', () => {
        expect(normalizeStoredToken({
            accessToken: 'a2',
            refreshToken: 'r2',
            expiresIn: 3600,
            obtainmentTimestamp: 1800000000000,
            scope: ['bits:read']
        })).toEqual({
            accessToken: 'a2',
            refreshToken: 'r2',
            expiresIn: 3600,
            obtainmentTimestamp: 1800000000000,
            scope: ['bits:read']
        });
    });

    test('camelCase wins when both are present', () => {
        const t = normalizeStoredToken({
            access_token: 'old', accessToken: 'new',
            refresh_token: 'oldr', refreshToken: 'newr',
            expires_in: 1, expiresIn: 2
        });
        expect(t.accessToken).toBe('new');
        expect(t.refreshToken).toBe('newr');
        expect(t.expiresIn).toBe(2);
    });

    test('splits a space-separated scope string', () => {
        expect(normalizeStoredToken({ access_token: 'a', refresh_token: 'r', scope: 'bits:read  user:read:chat' }).scope)
            .toEqual(['bits:read', 'user:read:chat']);
    });

    test('fills defaults for missing fields', () => {
        const t = normalizeStoredToken({ access_token: 'a', refresh_token: 'r' });
        expect(t.expiresIn).toBeNull();
        expect(t.obtainmentTimestamp).toBe(0);
        expect(t.scope).toEqual([]);
        expect(normalizeStoredToken({ expires_in: '3600', scope: 5 })).toMatchObject({ expiresIn: null, scope: [] });
    });
});
