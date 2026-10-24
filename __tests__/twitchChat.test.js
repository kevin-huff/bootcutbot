import { describe, expect, jest, test } from '@jest/globals';
import { BOT_USER_ID_FALLBACK, createChatClient, getBotUserId } from '../lib/twitchChat.js';

const BOT = '772229635';
const BROADCASTER = '100';

const makeLogger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

const makeListener = () => ({
  onChannelChatMessage: jest.fn(() => ({ stop: jest.fn() })),
  onChannelChatNotification: jest.fn(() => ({ stop: jest.fn() }))
});

const sent = (isSent = true, extra = {}) => ({ isSent, ...extra });

const makeApi = (impl) => {
  const sendChatMessageAsApp = jest.fn(impl || (async () => sent()));
  return { apiClient: { chat: { sendChatMessageAsApp } }, sendChatMessageAsApp };
};

const chatEvent = (overrides = {}) => ({
  broadcasterId: BROADCASTER,
  broadcasterName: 'abbabox',
  chatterId: '200',
  chatterName: 'viewer1',
  chatterDisplayName: 'Viewer1',
  color: '#FF0000',
  badges: {},
  messageId: 'm1',
  messageText: 'hello',
  isCheer: false,
  bits: 0,
  ...overrides
});

const subEvent = (overrides = {}) => ({
  broadcasterId: BROADCASTER,
  broadcasterName: 'abbabox',
  chatterId: '200',
  chatterName: 'viewer1',
  chatterDisplayName: 'Viewer1',
  chatterIsAnonymous: false,
  color: '#FF0000',
  badges: {},
  messageId: 'n1',
  messageText: '',
  type: 'sub',
  tier: '1000',
  isPrime: false,
  ...overrides
});

const attached = (opts, apiImpl, listener = null) => {
  const logger = makeLogger();
  const api = makeApi(apiImpl);
  const client = createChatClient({ logger, ...opts });
  client.attach({ apiClient: api.apiClient, listener, broadcasterId: BROADCASTER, botUserId: BOT });
  return { client, logger, ...api };
};

describe('say', () => {
  test('unattached resolves false and warns', async () => {
    const logger = makeLogger();
    const client = createChatClient({ logger });
    await expect(client.say('#abbabox', 'hi')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('authorize at /auth'));
  });

  test('sends each chunk in order with bot and broadcaster ids', async () => {
    const { client, sendChatMessageAsApp } = attached();
    const text = 'a'.repeat(300) + ' ' + 'b'.repeat(300);
    await expect(client.say('#abbabox', text)).resolves.toBe(true);
    expect(sendChatMessageAsApp.mock.calls).toEqual([
      [BOT, BROADCASTER, 'a'.repeat(300)],
      [BOT, BROADCASTER, 'b'.repeat(300)]
    ]);
  });

  test('a rejection resolves false and does not block the next say', async () => {
    let n = 0;
    const { client, logger } = attached({}, async () => {
      if (n++ === 0) throw Object.assign(new Error('nope'), { statusCode: 401 });
      return sent();
    });
    await expect(client.say('#c', 'one')).resolves.toBe(false);
    await expect(client.say('#c', 'two')).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('/auth'));
  });

  test('a drop resolves false, logs the reason and does not block', async () => {
    let n = 0;
    const { client, logger } = attached({}, async () =>
      n++ === 0 ? sent(false, { dropReasonCode: 'msg_duplicate', dropReasonMessage: 'dup' }) : sent()
    );
    await expect(client.say('#c', 'one')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('msg_duplicate'));
    await expect(client.say('#c', 'two')).resolves.toBe(true);
  });

  test('a timeout resolves false and does not block', async () => {
    let n = 0;
    const { client } = attached({ sendTimeoutMs: 30 }, () =>
      n++ === 0 ? new Promise((resolve) => setTimeout(() => resolve(sent()), 150)) : Promise.resolve(sent())
    );
    await expect(client.say('#c', 'one')).resolves.toBe(false);
    await expect(client.say('#c', 'two')).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  test('later says wait for a slow first send (FIFO)', async () => {
    const order = [];
    let n = 0;
    const { client } = attached({}, async (bot, b, chunk) => {
      if (n++ === 0) await new Promise((resolve) => setTimeout(resolve, 40));
      order.push(chunk);
      return sent();
    });
    const results = await Promise.all([client.say('#c', 'first'), client.say('#c', 'second'), client.say('#c', 'third')]);
    expect(results).toEqual([true, true, true]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  test('never echoes a local message event', async () => {
    const { client } = attached();
    const onMessage = jest.fn();
    client.on('message', onMessage);
    await client.say('#c', 'hi');
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  test('message events reach message handlers and are deduped by id', () => {
    const { client } = attached();
    const onMessage = jest.fn();
    client.on('message', onMessage);
    client.handleChatMessage(chatEvent());
    client.handleChatMessage(chatEvent());
    expect(onMessage).toHaveBeenCalledTimes(1);
    const [channel, tags, text, self] = onMessage.mock.calls[0];
    expect([channel, text, self, tags.username]).toEqual(['#abbabox', 'hello', false, 'viewer1']);
    client.handleChatMessage(chatEvent({ messageId: 'm2' }));
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  test('the bot own message is flagged self and mod', () => {
    const { client } = attached();
    const onMessage = jest.fn();
    client.on('message', onMessage);
    client.handleChatMessage(chatEvent({ chatterId: BOT, chatterName: 'abbadabbabot' }));
    const [, tags, , self] = onMessage.mock.calls[0];
    expect(self).toBe(true);
    expect(tags.mod).toBe(true);
  });

  test('a cheer reaches only cheer handlers', () => {
    const { client } = attached();
    const onMessage = jest.fn();
    const onCheer = jest.fn();
    client.on('message', onMessage).on('cheer', onCheer);
    client.handleChatMessage(chatEvent({ isCheer: true, bits: 100 }));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onCheer).toHaveBeenCalledTimes(1);
    expect(onCheer.mock.calls[0][1].bits).toBe('100');
  });

  test('sub notifications reach their handlers and unsupported types are ignored', () => {
    const { client } = attached();
    const onSub = jest.fn();
    client.on('subscription', onSub);
    client.handleChatNotification(subEvent());
    client.handleChatNotification(subEvent({ messageId: 'n2', type: 'raid' }));
    expect(onSub).toHaveBeenCalledTimes(1);
    expect(onSub.mock.calls[0][1]).toBe('Viewer1');
  });

  test('handler errors are isolated and logged', async () => {
    const { client, logger } = attached();
    const good = jest.fn();
    client.on('message', () => {
      throw new Error('sync boom');
    });
    client.on('message', async () => {
      throw new Error('async boom');
    });
    client.on('message', good);
    client.handleChatMessage(chatEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(good).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('sync boom'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('async boom'));
  });

  test('logs one [chat] line per message', () => {
    const { client, logger } = attached();
    client.handleChatMessage(chatEvent());
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0][0]).toMatch(/^\[chat\] #abbabox viewer1: hello/);
  });
});

describe('attach and detach', () => {
  test('subscribes both topics with the broadcaster id, once per listener', () => {
    const listener = makeListener();
    const { client } = attached({}, null, listener);
    client.attach({ apiClient: makeApi().apiClient, listener, broadcasterId: BROADCASTER, botUserId: BOT });
    expect(listener.onChannelChatMessage).toHaveBeenCalledTimes(1);
    expect(listener.onChannelChatNotification).toHaveBeenCalledTimes(1);
    expect(listener.onChannelChatMessage).toHaveBeenCalledWith(BROADCASTER, BROADCASTER, expect.any(Function));
    expect(listener.onChannelChatNotification).toHaveBeenCalledWith(BROADCASTER, BROADCASTER, expect.any(Function));
  });

  test('subscribed callbacks feed the handlers', () => {
    const listener = makeListener();
    const { client } = attached({}, null, listener);
    const onMessage = jest.fn();
    const onSub = jest.fn();
    client.on('message', onMessage).on('subscription', onSub);
    listener.onChannelChatMessage.mock.calls[0][2](chatEvent());
    listener.onChannelChatNotification.mock.calls[0][2](subEvent());
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onSub).toHaveBeenCalledTimes(1);
  });

  test('send-only attach subscribes nothing', async () => {
    const { client } = attached();
    expect(client.status()).toEqual({ reading: false, sending: true, botUserId: BOT });
    await expect(client.say('#c', 'hi')).resolves.toBe(true);
  });

  test('detach then re-attach keeps handlers', async () => {
    const first = makeListener();
    const { client, logger } = attached({}, null, first);
    const onMessage = jest.fn();
    client.on('message', onMessage);
    expect(client.status().reading).toBe(true);
    client.detach();
    expect(client.status()).toEqual({ reading: false, sending: false, botUserId: null });
    await expect(client.say('#c', 'hi')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();

    const second = makeListener();
    client.attach({ apiClient: makeApi().apiClient, listener: second, broadcasterId: BROADCASTER, botUserId: BOT });
    expect(second.onChannelChatMessage).toHaveBeenCalledTimes(1);
    second.onChannelChatMessage.mock.calls[0][2](chatEvent({ messageId: 'after' }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});

describe('getBotUserId', () => {
  test('uses TWITCH_BOT_ID when set', () => {
    expect(getBotUserId({ TWITCH_BOT_ID: 555 })).toBe('555');
  });

  test('falls back to abbadabbabot', () => {
    expect(BOT_USER_ID_FALLBACK).toBe('772229635');
    expect(getBotUserId({})).toBe('772229635');
    expect(getBotUserId({ TWITCH_BOT_ID: '' })).toBe('772229635');
  });
});
