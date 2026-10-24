export function splitChatMessage(text, max = 500) {
  let s = String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ');
  if (!s.trim()) return [];
  const chunks = [];
  while (s.length > max) {
    const cut = s.lastIndexOf(' ', max);
    if (cut > 0) {
      chunks.push(s.slice(0, cut));
      s = s.slice(cut + 1);
    } else {
      const code = s.charCodeAt(max - 1);
      const end = max > 1 && code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
      chunks.push(s.slice(0, end));
      s = s.slice(end);
    }
  }
  chunks.push(s);
  return chunks.filter((chunk) => chunk.trim());
}

function badgeTags(badges, self) {
  const set = badges || {};
  const has = (name) => Object.prototype.hasOwnProperty.call(set, name);
  const mod = self || has('moderator') || has('lead_moderator');
  return {
    mod,
    subscriber: has('subscriber') || has('founder'),
    'user-type': mod ? 'mod' : null
  };
}

// True only when both names are known and differ, so a failed lookup never turns chat off.
export function isChannelMismatch(broadcasterLogin, configuredChannel) {
  const norm = (s) => String(s ?? '').replace(/^#/, '').trim().toLowerCase();
  return Boolean(norm(broadcasterLogin) && norm(configuredChannel)) && norm(broadcasterLogin) !== norm(configuredChannel);
}

export function chatMessageToTmi(event, botUserId) {
  const channel = '#' + event.broadcasterName;
  const self = String(event.chatterId) === String(botUserId);
  const tags = {
    username: event.chatterName,
    'display-name': event.chatterDisplayName,
    'user-id': event.chatterId,
    'room-id': event.broadcasterId,
    id: event.messageId,
    color: event.color,
    badges: event.badges,
    ...badgeTags(event.badges, self),
    'message-type': 'chat'
  };
  if (event.isCheer) {
    return { name: 'cheer', args: [channel, { ...tags, bits: String(event.bits) }, event.messageText] };
  }
  return { name: 'message', args: [channel, tags, event.messageText, self] };
}

export function chatNotificationToTmi(event) {
  const type = event.type;
  if (type !== 'sub' && type !== 'resub' && type !== 'sub_gift' && type !== 'community_sub_gift') return null;

  const channel = '#' + event.broadcasterName;
  const anonymous = Boolean(event.chatterIsAnonymous);
  const login = event.chatterName || (anonymous ? 'ananonymousgifter' : '');
  const displayName = event.chatterDisplayName || (anonymous ? 'AnAnonymousGifter' : login);
  const username = displayName || login;
  const plan = event.isPrime ? 'Prime' : event.tier;
  const methods = { prime: plan === 'Prime', plan, planName: null };
  const message = event.messageText || null;
  const base = {
    username: login,
    login,
    'display-name': displayName,
    'user-id': event.chatterId,
    'room-id': event.broadcasterId,
    id: event.messageId,
    color: event.color,
    badges: event.badges,
    ...badgeTags(event.badges, false),
    'msg-param-sub-plan': plan,
    'msg-param-sub-plan-name': null
  };
  const tagsFor = (id) => ({ ...base, 'msg-id': id, 'message-type': id });

  switch (type) {
    case 'sub':
      return { name: 'subscription', args: [channel, username, methods, message, tagsFor('sub')] };
    case 'resub': {
      const streak = event.streakMonths ?? 0;
      return {
        name: 'resub',
        args: [
          channel,
          username,
          streak,
          message,
          {
            ...tagsFor('resub'),
            'msg-param-cumulative-months': event.cumulativeMonths,
            'msg-param-streak-months': streak
          },
          methods
        ]
      };
    }
    case 'sub_gift':
      return {
        name: 'subgift',
        args: [
          channel,
          username,
          0,
          event.recipientDisplayName || event.recipientName,
          methods,
          {
            ...tagsFor('subgift'),
            'msg-param-recipient-id': event.recipientId,
            'msg-param-recipient-user-name': event.recipientName,
            'msg-param-recipient-display-name': event.recipientDisplayName,
            'msg-param-community-gift-id': event.communityGiftId ?? null
          }
        ]
      };
    default:
      return {
        name: 'submysterygift',
        args: [
          channel,
          username,
          event.amount,
          methods,
          {
            ...tagsFor('submysterygift'),
            'msg-param-mass-gift-count': event.amount,
            'msg-param-community-gift-id': event.id
          }
        ]
      };
  }
}
