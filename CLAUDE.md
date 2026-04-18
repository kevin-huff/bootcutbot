# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

BootcutBot is a Twitch bot and web dashboard for the streamer Abbabox. It manages a viewer queue system, a game board with interactive overlays, timers/subathon features, a "torment meter" donation tracker, and various stream integrations (Twitch EventSub, Streamlabs, 4th Wall merch webhooks, ElevenLabs TTS).

## The Game of Bootcut

Bootcut is an interactive variety-show board game played on stream. The board is a 12-spot grid where each spot (a "splot") contains a challenge for the streamer to perform (e.g., "serenade the yoda statue", "ween karaoke", "Muscle Shrek Memes"). Each splot has a "uses" counter — when uses run out, it becomes blank.

**Turn flow:**
1. `!ap` (auto-pick) selects a chatter from the queue in a Random-Random-Next repeating sequence
2. The chatter has a **4-minute timer** for the dice-rolling portion of their turn
3. A **d12 is rolled** (physical Bluetooth GoDice) to land on one of the 12 splots
4. The chatter **chooses to accept the splot or breakaway**
5. If they **breakaway**, a d6 is rolled: 1 = erase and replace the splot, 3 = forced to do it, 6 = re-roll the d12 for a new splot
6. If they land on a **blank splot**, the chatter fills it with a new challenge
7. The **streamer then performs the activity** — this is the main content and is unbounded in time (typically 5-20 minutes per splot)

**Breakaways** are a shared pool. More can be earned through channel point redemptions or by completing certain splots. When the pool is empty, no one can breakaway. Turns can also be purchased for 400 bits when a queued player isn't present, and a "super duper breakaway" costs 300 bits — both currently handled manually by mods.

A typical stream gets through 2-4 turns per hour. The board is community-curated — chatters create challenges when filling blanks, and the streamer has final say on what goes on the board.

## Commands

```bash
npm start          # Production: node index.js
npm run dev        # Development: nodemon index.js (auto-restarts, ignores *.json)
npm test           # Jest tests (uses --experimental-vm-modules for ESM)
npm run dev:board  # Vite dev server for the React board component
npm run build:board # Build React board → public/board-assets/
```

## Architecture

**Entry point**: `index.js` — sets up Express + Socket.IO server on port 3000, connects Streamlabs socket, initializes EventSub and bot commands.

**Key modules** (all ESM):
- `botCommands.js` — Twitch chat bot (tmi.js). Handles `!join`, `!leave`, `!next`, `!random`, `!open`, `!close`, etc. Imports command handlers from `commands/`.
- `commands/` — Chat command handlers split by domain: `queueCommands.js`, `queueManagement.js`, `trackerCommands.js`, `miscCommands.js`, `db.js`.
- `socketHandlers.js` — Socket.IO event handlers for the board, timers, wheel, dice, subathon, and all admin dashboard interactions. This is the largest module and handles most real-time state.
- `eventSub.js` — Twitch EventSub via Twurple (subs, bits, raids, etc.). Feeds into torment meter and subathon timer.
- `tormentMeterService.js` — Donation/bits tracking toward configurable goals with tier escalation. Contributions decay by 90% every 60 minutes.
- `routes.js` — Express routes serving EJS views. Public routes (board, timer, overlays) are unauthenticated; admin routes use HTTP basic auth.
- `routes/anniversary.js` — Anniversary event routes (separate feature).
- `constants.js` — Shared mutable `state` object (queue_open, current_turn, etc.).
- `utils.js` — Shared helpers (splot states, board spot IDs, bot say functions).
- `auth.js` — Twitch OAuth flow for EventSub token management.

**Frontend**:
- `views/` — EJS templates for overlays, admin dashboards, and the main queue page. These are served by Express and connect back via Socket.IO.
- `src/board/` — React component (built with Vite) for the interactive game board. Output goes to `public/board-assets/`.
- `public/` — Static assets (CSS, JS, images, sounds).

**Data**: persistence is Postgres via a custom KV shim (`lib/jsoningPg.js`) that matches the old `jsoning` API (`.get/.set/.push/.math/.all/.clear`) plus `.update(key, fn)` for transactional read-modify-write with `SELECT … FOR UPDATE` + per-key in-process serialization (protects against !join rushes). One table, `kv_store(namespace, key, value jsonb)`. The `namespace` argument is the old filename minus `.json` (e.g. `new JsoningPg('queue')` replaces `new jsoning("db/queue.json")`). `db/*.json` files are historical snapshots only — not read or written by the running app. Apply schema with `npm run db:schema`; seed from local JSON snapshots with `npm run db:migrate` (idempotent; UPSERTs).

## Environment

Requires a `.env` file with `DATABASE_URL` (Postgres), Twitch credentials (bot account, OAuth, EventSub client ID/secret, channel ID), Streamlabs socket token, web basic auth credentials, and optionally R2/S3 keys for asset storage. See README for R2 setup.

## Key Patterns

- Real-time communication between admin dashboards and overlays happens through Socket.IO events, not REST APIs.
- The `state` object in `constants.js` is shared mutable state across modules — imported by reference.
- Admin pages (board_admin, timer_admin, torment_meter_admin) are behind basic auth and control overlays in real time.
- Persistence goes through `JsoningPg` from `lib/jsoningPg.js`. Use `new JsoningPg('<namespace>')` (namespace = old filename without `.json`) and the standard `.get/.set/.push/.math/.all/.clear` methods. For any read-modify-write under concurrency (queue-mutation in particular), use `.update(key, fn)` — it wraps the whole cycle in a transaction + SELECT FOR UPDATE.
- Queue has a "firsts first" mode that prioritizes players who haven't had a turn yet.
- Subathon timer persists across restarts, supports pause/resume and configurable time multipliers per donation type.
- Crowd sounds (laugh, fart, moan, clap, boo) trigger via regex matching in chat with configurable thresholds in env vars.
