import { describe, expect, test } from '@jest/globals';
import {
  EventSubChannelChatMessageEvent,
  EventSubChannelChatSubNotificationEvent,
  EventSubChannelChatResubNotificationEvent,
  EventSubChannelChatSubGiftNotificationEvent,
  EventSubChannelChatCommunitySubGiftNotificationEvent,
  EventSubChannelChatRaidNotificationEvent,
  EventSubChannelChatSharedChatSubNotificationEvent
} from '@twurple/eventsub-base';
import { splitChatMessage, chatMessageToTmi, chatNotificationToTmi, isChannelMismatch } from '../lib/chatMapping.js';

const BOT_ID = '772229635';

const chatter = (overrides = {}) => ({
  broadcaster_user_id: '100',
  broadcaster_user_login: 'abbabox',
  broadcaster_user_name: 'Abbabox',
  chatter_user_id: '200',
  chatter_user_login: 'viewer1',
  chatter_user_name: 'Viewer1',
  color: '#FF0000',
  badges: [],
  message_id: 'msg-1',
  message: { text: 'hello there', fragments: [] },
  ...overrides
});

const messageEvent = (overrides) =>
  new EventSubChannelChatMessageEvent(chatter({ message_type: 'text', ...overrides }), null);
const notice = (Cls, extra) => new Cls(chatter({ chatter_is_anonymous: false, message: { text: '', fragments: [] }, ...extra }), null);

describe('chatMessageToTmi', () => {
  test('plain message', () => {
    const { name, args } = chatMessageToTmi(messageEvent(), BOT_ID);
    expect(name).toBe('message');
    const [channel, tags, text, self] = args;
    expect(channel).toBe('#abbabox');
    expect(text).toBe('hello there');
    expect(self).toBe(false);
    expect(tags).toEqual({
      username: 'viewer1',
      'display-name': 'Viewer1',
      'user-id': '200',
      'room-id': '100',
      id: 'msg-1',
      color: '#FF0000',
      badges: {},
      mod: false,
      subscriber: false,
      'user-type': null,
      'message-type': 'chat'
    });
    expect(tags.bits).toBeUndefined();
  });

  test('bot own message is self and mod without a moderator badge', () => {
    const event = messageEvent({ chatter_user_id: BOT_ID, chatter_user_login: 'abbadabbabot', chatter_user_name: 'abbadabbabot' });
    const { name, args } = chatMessageToTmi(event, BOT_ID);
    expect(name).toBe('message');
    expect(args[3]).toBe(true);
    expect(args[1].mod).toBe(true);
    expect(args[1]['user-type']).toBe('mod');
    expect(args[1].username).toBe('abbadabbabot');
  });

  test('bot id may be a number', () => {
    const event = messageEvent({ chatter_user_id: BOT_ID });
    expect(chatMessageToTmi(event, Number(BOT_ID)).args[3]).toBe(true);
  });

  test.each(['moderator', 'lead_moderator'])('%s badge makes a mod', (badge) => {
    const event = messageEvent({ badges: [{ set_id: badge, id: '1', info: '' }] });
    const tags = chatMessageToTmi(event, BOT_ID).args[1];
    expect(tags.mod).toBe(true);
    expect(tags['user-type']).toBe('mod');
    expect(tags.badges).toEqual({ [badge]: '1' });
  });

  test.each(['subscriber', 'founder'])('%s badge makes a subscriber and not a mod', (badge) => {
    const event = messageEvent({ badges: [{ set_id: badge, id: '0', info: '12' }] });
    const tags = chatMessageToTmi(event, BOT_ID).args[1];
    expect(tags.subscriber).toBe(true);
    expect(tags.mod).toBe(false);
    expect(tags['user-type']).toBeNull();
  });

  test('cheer maps to cheer only, with bits as a string', () => {
    const event = messageEvent({ cheer: { bits: 100 }, message: { text: 'cheer100 nice', fragments: [] }, message_type: 'text' });
    const { name, args } = chatMessageToTmi(event, BOT_ID);
    expect(name).toBe('cheer');
    expect(args).toHaveLength(3);
    expect(args[0]).toBe('#abbabox');
    expect(args[1].bits).toBe('100');
    expect(args[1].username).toBe('viewer1');
    expect(args[2]).toBe('cheer100 nice');
  });
});

describe('chatNotificationToTmi', () => {
  test('sub at tier 2000', () => {
    const event = notice(EventSubChannelChatSubNotificationEvent, {
      chatter_user_name: 'Viewer1',
      sub: { sub_tier: '2000', is_prime: false, duration_months: 1 }
    });
    const { name, args } = chatNotificationToTmi(event);
    expect(name).toBe('subscription');
    const [channel, username, methods, message, tags] = args;
    expect(channel).toBe('#abbabox');
    expect(username).toBe('Viewer1');
    expect(methods).toEqual({ prime: false, plan: '2000', planName: null });
    expect(message).toBeNull();
    expect(tags['msg-param-sub-plan']).toBe('2000');
    expect(tags['msg-id']).toBe('sub');
    expect(tags['message-type']).toBe('sub');
    expect(tags.username).toBe('viewer1');
    expect(tags['display-name']).toBe('Viewer1');
    expect(tags['user-type']).toBeNull();
  });

  test('sub with Prime reads Prime', () => {
    const event = notice(EventSubChannelChatSubNotificationEvent, {
      sub: { sub_tier: '1000', is_prime: true, duration_months: 1 }
    });
    const [, , methods, , tags] = chatNotificationToTmi(event).args;
    expect(methods).toEqual({ prime: true, plan: 'Prime', planName: null });
    expect(tags['msg-param-sub-plan']).toBe('Prime');
  });

  test('sub keeps the attached message', () => {
    const event = notice(EventSubChannelChatSubNotificationEvent, {
      message: { text: 'hi chat', fragments: [] },
      sub: { sub_tier: '1000', is_prime: false, duration_months: 1 }
    });
    expect(chatNotificationToTmi(event).args[3]).toBe('hi chat');
  });

  test('resub with null streak gives 0', () => {
    const event = notice(EventSubChannelChatResubNotificationEvent, {
      message: { text: 'back again', fragments: [] },
      resub: {
        sub_tier: '1000',
        is_prime: false,
        duration_months: 1,
        cumulative_months: 7,
        streak_months: null,
        is_gift: false
      }
    });
    const { name, args } = chatNotificationToTmi(event);
    expect(name).toBe('resub');
    const [channel, username, streak, message, tags, methods] = args;
    expect(channel).toBe('#abbabox');
    expect(username).toBe('Viewer1');
    expect(streak).toBe(0);
    expect(message).toBe('back again');
    expect(tags['msg-param-cumulative-months']).toBe(7);
    expect(tags['msg-param-streak-months']).toBe(0);
    expect(tags['msg-id']).toBe('resub');
    expect(methods).toEqual({ prime: false, plan: '1000', planName: null });
  });

  test('resub with a streak passes it through', () => {
    const event = notice(EventSubChannelChatResubNotificationEvent, {
      resub: { sub_tier: '3000', is_prime: false, cumulative_months: 9, streak_months: 4, is_gift: false }
    });
    const args = chatNotificationToTmi(event).args;
    expect(args[2]).toBe(4);
    expect(args[4]['msg-param-streak-months']).toBe(4);
  });

  test('single gift has a null community gift id', () => {
    const event = notice(EventSubChannelChatSubGiftNotificationEvent, {
      sub_gift: {
        sub_tier: '1000',
        duration_months: 1,
        cumulative_total: null,
        recipient_user_id: '300',
        recipient_user_login: 'lucky',
        recipient_user_name: 'Lucky',
        community_gift_id: null
      }
    });
    const { name, args } = chatNotificationToTmi(event);
    expect(name).toBe('subgift');
    const [channel, username, streak, recipient, methods, tags] = args;
    expect(channel).toBe('#abbabox');
    expect(username).toBe('Viewer1');
    expect(streak).toBe(0);
    expect(recipient).toBe('Lucky');
    expect(methods).toEqual({ prime: false, plan: '1000', planName: null });
    expect(tags['msg-param-community-gift-id']).toBeNull();
    expect(tags['msg-param-recipient-id']).toBe('300');
    expect(tags['msg-param-recipient-user-name']).toBe('lucky');
    expect(tags['msg-param-recipient-display-name']).toBe('Lucky');
    expect(tags['msg-id']).toBe('subgift');
  });

  test('gift-bomb child carries the community gift id', () => {
    const event = notice(EventSubChannelChatSubGiftNotificationEvent, {
      sub_gift: {
        sub_tier: '1000',
        recipient_user_id: '301',
        recipient_user_login: 'lucky2',
        recipient_user_name: '',
        community_gift_id: 'bomb-9'
      }
    });
    const args = chatNotificationToTmi(event).args;
    expect(args[3]).toBe('lucky2');
    expect(args[5]['msg-param-community-gift-id']).toBe('bomb-9');
  });

  test('anonymous gifter with empty chatter fields', () => {
    const event = notice(EventSubChannelChatSubGiftNotificationEvent, {
      chatter_is_anonymous: true,
      chatter_user_id: '',
      chatter_user_login: '',
      chatter_user_name: '',
      sub_gift: {
        sub_tier: '1000',
        recipient_user_id: '302',
        recipient_user_login: 'lucky3',
        recipient_user_name: 'Lucky3',
        community_gift_id: null
      }
    });
    const [, username, , , , tags] = chatNotificationToTmi(event).args;
    expect(username).toBe('AnAnonymousGifter');
    expect(tags.username).toBe('ananonymousgifter');
    expect(tags.login).toBe('ananonymousgifter');
    expect(tags['display-name']).toBe('AnAnonymousGifter');
  });

  test('community gift maps to submysterygift', () => {
    const event = notice(EventSubChannelChatCommunitySubGiftNotificationEvent, {
      community_sub_gift: { id: 'bomb-9', total: 10, sub_tier: '1000', cumulative_total: 25 }
    });
    const { name, args } = chatNotificationToTmi(event);
    expect(name).toBe('submysterygift');
    const [channel, username, count, methods, tags] = args;
    expect(channel).toBe('#abbabox');
    expect(username).toBe('Viewer1');
    expect(count).toBe(10);
    expect(methods).toEqual({ prime: false, plan: '1000', planName: null });
    expect(tags['msg-param-mass-gift-count']).toBe(10);
    expect(tags['msg-param-community-gift-id']).toBe('bomb-9');
    expect(tags['msg-id']).toBe('submysterygift');
  });

  test('moderator badge on a notification sets mod', () => {
    const event = notice(EventSubChannelChatSubNotificationEvent, {
      badges: [{ set_id: 'moderator', id: '1', info: '' }],
      sub: { sub_tier: '1000', is_prime: false }
    });
    const tags = chatNotificationToTmi(event).args[4];
    expect(tags.mod).toBe(true);
    expect(tags['user-type']).toBe('mod');
  });

  test('raid returns null', () => {
    const event = notice(EventSubChannelChatRaidNotificationEvent, {
      raid: { user_id: '1', user_login: 'r', user_name: 'R', viewer_count: 5, profile_image_url: '' }
    });
    expect(chatNotificationToTmi(event)).toBeNull();
  });

  test('shared chat sub returns null', () => {
    const event = notice(EventSubChannelChatSharedChatSubNotificationEvent, {
      shared_chat_sub: { sub_tier: '1000', is_prime: false, duration_months: 1 }
    });
    expect(chatNotificationToTmi(event)).toBeNull();
  });
});

describe('splitChatMessage', () => {
  test('empty and whitespace-only give no chunks', () => {
    expect(splitChatMessage('')).toEqual([]);
    expect(splitChatMessage('   ')).toEqual([]);
    expect(splitChatMessage(null)).toEqual([]);
    expect(splitChatMessage(undefined)).toEqual([]);
  });

  test('short message stays whole', () => {
    expect(splitChatMessage('hello world')).toEqual(['hello world']);
  });

  test('exactly 500 characters stays whole', () => {
    const text = 'a'.repeat(500);
    expect(splitChatMessage(text)).toEqual([text]);
  });

  test('splits at the last space', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`);
    const text = words.join(' ');
    const chunks = splitChatMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      expect(chunk.startsWith(' ')).toBe(false);
    }
    expect(chunks.join(' ')).toBe(text);
  });

  test('splits at the last space within max', () => {
    expect(splitChatMessage('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc']);
    expect(splitChatMessage('aaaa bbbbb', 4)).toEqual(['aaaa', 'bbbb', 'b']);
  });

  test('no spaces hard-cuts without losing characters', () => {
    const text = 'x'.repeat(1250);
    const chunks = splitChatMessage(text);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 250]);
    expect(chunks.join('')).toBe(text);
  });

  test('does not split a surrogate pair at the cut', () => {
    const text = 'a'.repeat(499) + '\u{1F600}' + 'b'.repeat(10);
    const chunks = splitChatMessage(text);
    expect(chunks[0]).toBe('a'.repeat(499));
    expect(chunks[1]).toBe('\u{1F600}' + 'b'.repeat(10));
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
  });

  test('text of only emoji past the limit keeps every character', () => {
    const text = '\u{1F600}'.repeat(300);
    const chunks = splitChatMessage(text);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
  });

  test('whitespace-only chunks are dropped', () => {
    expect(splitChatMessage('a' + ' '.repeat(10) + 'b', 3).join('')).toContain('b');
    expect(splitChatMessage('ab' + ' '.repeat(10), 3).every((c) => c.trim())).toBe(true);
  });

  test('custom max is respected', () => {
    const chunks = splitChatMessage('one two three four five', 10);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10);
    expect(chunks.join(' ')).toBe('one two three four five');
  });
});

describe('splitChatMessage line breaks', () => {
  test('line breaks become single spaces so a multi-line reply posts as one line', () => {
    expect(splitChatMessage('line one\nline two\r\n\r\n  line three')).toEqual(['line one line two line three']);
  });
});

describe('isChannelMismatch', () => {
  test('same channel, ignoring case and a leading #', () => {
    expect(isChannelMismatch('abbabox', 'abbabox')).toBe(false);
    expect(isChannelMismatch('abbabox', '#AbbaBox')).toBe(false);
  });

  test('different channels are a mismatch', () => {
    expect(isChannelMismatch('abbabox', 'zilchgnu')).toBe(true);
  });

  test('nothing to compare is not a mismatch', () => {
    expect(isChannelMismatch('abbabox', '')).toBe(false);
    expect(isChannelMismatch('abbabox', undefined)).toBe(false);
    expect(isChannelMismatch(undefined, 'abbabox')).toBe(false);
  });
});
