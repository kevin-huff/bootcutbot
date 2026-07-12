import crypto from 'crypto';
import basicAuth from 'express-basic-auth';

// Socket.IO admin gate.
//
// The problem this solves: HTTP basic auth only protects the admin *pages*.
// Socket.IO attaches at the HTTP-server level and bypasses Express middleware,
// so every mutating event (clear_board, subathon_set_time, user_ba_admin, ...)
// used to be callable by anyone who opened a public overlay and used devtools.
//
// Model: connections are always allowed (public overlays must connect to receive
// broadcasts), but each incoming event is checked against an allowlist. Events not
// on the allowlist are operator actions and require proof of admin — delivered two
// ways:
//   1. Browser admin pages: an httpOnly `bootcut_admin` cookie set by adminAuth()
//      when the operator passes basic auth. The browser attaches it automatically
//      to the Socket.IO handshake.
//   2. Programmatic clients (e.g. an external donation integration): a token in
//      socket.handshake.auth.token.
// Both are compared against process.env.admin_socket_token with a timing-safe check.

const COOKIE_NAME = 'bootcut_admin';

// Events any connected client may emit. This is an allowlist: anything not listed
// is denied to non-admin sockets, so newly added events are gated by default.
const PUBLIC_EVENTS = new Set([
  // Read-only state sync. The data returned here is already broadcast to overlays,
  // so exposing it to any connected client leaks nothing new.
  'admin:requestState',
  'admin:requestWheelSlots',
  'admin:requestVisibilityState',
  'admin:requestRemovedSlots',
  'admin:requestDonationState',
  'external:requestState',
  'get_timer_state',
  'get_timer_logs',
  'get_random_splot',
  'user_ba_lookup',
  // Overlays join broadcast rooms on load / reconnect.
  'join_subathon_timer',
  'join_torment_meter',
  // The PUBLIC anniversary overlay drives this when its client-side respin-window
  // animation ends. It only finalizes an already-pending, admin-initiated slot
  // removal, so the blast radius is small. Proper fix later: make the respin-window
  // timing server-authoritative and drop this from the allowlist.
  'respinWindowClosed',
]);

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function getAdminToken() {
  return process.env.admin_socket_token || '';
}

export function isValidAdminSecret(presented) {
  const expected = getAdminToken();
  if (!expected || !presented) return false;
  return timingSafeEqualStr(presented, expected);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function extractPresentedSecret(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return authToken;
  const cookies = parseCookies(socket.handshake?.headers?.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

export function installSocketAuth(io) {
  if (!getAdminToken()) {
    console.warn(
      '⚠️  admin_socket_token is not set — Socket.IO admin events are UNPROTECTED. ' +
      'Set admin_socket_token in .env to enable the gate.'
    );
  }

  // Connection-level: flag whether this socket proved it is an operator.
  // Always call next() — public overlays must still be allowed to connect.
  io.use((socket, next) => {
    socket.data.isAdmin = isValidAdminSecret(extractPresentedSecret(socket));
    next();
  });

  // Per-event gate. Registered here as its own connection listener so socketHandlers
  // stays untouched; socket.use middleware runs before any socket.on handler.
  io.on('connection', (socket) => {
    socket.use((packet, next) => {
      const event = Array.isArray(packet) ? packet[0] : undefined;
      if (PUBLIC_EVENTS.has(event) || socket.data.isAdmin) {
        return next();
      }
      console.warn(`[socket-auth] blocked "${event}" from unauthenticated socket ${socket.id}`);
      const err = new Error('unauthorized');
      err.data = { event, reason: 'admin_required' };
      next(err);
    });
  });
}

// Express middleware for admin routes: enforce basic auth, then hand the browser
// the Socket.IO admin token as an httpOnly cookie so its handshake is trusted.
// Usage: router.get('/board_admin', adminAuth(), handler)
export function adminAuth() {
  const basic = basicAuth({
    users: { [process.env.web_user]: process.env.web_pass },
    challenge: true,
  });
  return [
    basic,
    (req, res, next) => {
      const token = getAdminToken();
      if (token) {
        const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure,
          path: '/',
          maxAge: 12 * 60 * 60 * 1000, // 12h; re-issued on each admin page load
        });
      }
      next();
    },
  ];
}
