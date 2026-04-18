# Database Upgrades — post-jsoning roadmap

_Started 2026-04-18 after the KV-shim migration (commit `5deba8c`)._

## Where we are today

All persistence goes through `JsoningPg` (`lib/jsoningPg.js`) backed by a single Postgres table:

```sql
kv_store(namespace TEXT, key TEXT, value JSONB, updated_at TIMESTAMPTZ, PRIMARY KEY(namespace, key))
```

The old `jsoning("db/foo.json")` constructors became `new JsoningPg("foo")`. Everything still works the way it did on flat files — `.get/.set/.push/.math/.all/.clear` have the same semantics, plus a new `.update(key, fn)` that wraps read-modify-write in `SELECT … FOR UPDATE` + a per-process per-key promise chain. `!join` etc. already use `.update()`.

This was intentionally an "unblock the deploy" move. The shape of the data is unchanged — it's JSON blobs keyed by a namespace and a string key. Some of those blobs are genuinely KV-shaped; others are big arrays or append-only logs pretending to be KV.

## Namespaces worth upgrading to real tables

Priority order — do the top entries first.

### Tier 1 — logs (big, grow unbounded, genuinely tabular)

Every operation currently reads the entire JSON array, mutates it in JS, and writes it back. Insert cost grows O(n) with log size. All four are natural append-only tables.

| Namespace | Current shape | Target table | Notes |
|---|---|---|---|
| `dice_log` | `{ dice_roll: [{dice_id, roll_value, dice_name, dice_type, timestamp}, …] }` | `dice_rolls(id serial, dice_id text, dice_name text, dice_type text, roll_value int, rolled_at timestamptz)` | 1.3 MB and growing. Write is every dice roll. No queries against this today — just a log surface. |
| `action_log` | `{ [splot_entry]: [{id, entry, splot_dot, action}, …] }` | `splot_actions(id serial, splot_entry text, splot_id int, splot_dot int, action text, created_at timestamptz, index on splot_entry)` | Keyed by entry text which is fragile. Give each action a real timestamp. |
| `timer_db.logs` (sub-array of `timer_db` singleton) | `[{action, seconds, multiplier, source, timestamp}]` | `timer_events(id serial, action text, seconds int, multiplier numeric, source text, new_end_time timestamptz, created_at timestamptz)` | Pull the log out of the singleton blob. |
| `historical_splots` | `{ [entry_lowercase]: iso_date }` | `historical_splots(entry text primary key, first_used timestamptz)` | Already serves `/historical_splots.json`. Trivial migration. |

### Tier 2 — record collections (already a list of records, just denormalize)

| Namespace | Current shape | Target table | Why |
|---|---|---|---|
| `ratings` | `{ ratings: [{item, rating, timestamp}, …] }` | `ratings(item text, rating numeric, rated_at timestamptz, index on item)` | Lookups today do a full-array scan. Real indexes on `item` make `!rating {name}` O(log n). |
| `votes` | `{ godVotes: [{user, vote}], pettyVotes: […] }` | `votes(kind text, username text, vote text, voted_at timestamptz, primary key(kind, username))` | Natural uniqueness constraint per user per kind — no more duplicate-check-then-insert races. |
| `crowd_sounds` | `{ farts: [{user, timestamp}], lols: […], moans: […], claps: […], boos: […] }` | `crowd_sounds(sound text, username text, at timestamptz)` | Counts-per-window queries become SQL one-liners. |
| `breakaways` | `{ breakaways: [{id, name, ba_dots}] }` | `breakaways(id serial, name text, ba_dots int)` | Only 2 rows today (CHAT, ABBA) but individual row updates stop rewriting the whole array and let us add columns later (e.g. cap, history). |

### Tier 3 — simple maps (natural (key, value) tables)

| Namespace | Current shape | Target table | Why |
|---|---|---|---|
| `historical_turns` | `{ [username_lowercase]: count }` | `historical_turns(username text primary key, turn_count int)` | `.math("user", "add", 1)` becomes `INSERT … ON CONFLICT DO UPDATE SET turn_count = turn_count + 1` — cheaper and race-free. |
| `social_scores` | `{ [username]: ["2","3.5",…] }` | `social_scores(username text, score numeric, scored_at timestamptz)` | Each rating becomes its own row — averaging becomes SQL, no JSON-parsing in JS. |
| `users_in_chat` | `{ [username]: [ts1, ts2, …] }` | `user_appearances(username text, seen_at timestamptz, primary key(username, seen_at))` | 2938 keys right now; big rewrite on every update. |

### Tier 4 — queue + turns (trickier, medium value)

Each queue/turn entry is a full Twitch `tags` object (~20 fields). Flattening to columns is noisy; keeping the tags blob in a jsonb column is fine.

| Namespace | Current shape | Target | Why move |
|---|---|---|---|
| `queue` | `{ queue: [tagsObj, …] }` | `queue_entries(position int, username text, display_name text, tags jsonb, joined_at timestamptz, unique(username))` | Unique constraint kills the `!join` race at DB level — `.update()` becomes `INSERT … ON CONFLICT DO NOTHING`. O(1) dedup instead of O(n) findIndex. |
| `turns` | `{ turns: [tagsObj, …] }` | `turn_history(id serial, username text, display_name text, tags jsonb, taken_at timestamptz, index on username)` | `countTurns(turns, user)` becomes `SELECT count(*) WHERE username=?`. Current code reduces over every element of the array on every `!next`. |

## Namespaces that should stay KV

These are genuinely KV-shaped — don't migrate for the sake of it.

- **`twitch_tokens`** — single blob, written by auth flow, read on boot.
- **`torment_meter.state`** — one complex nested object; no query surface.
- **`settings`, `queue_settings`** — small grab bag of flags and counters. KV is the ideal shape.
- **`timer_db`** — the singleton fields (end_time, is_paused, etc.) stay; only the `.logs` sub-array belongs in its own table.
- **`wheel_db`, `step_timer`, `deaths`, `boo_db`, `dice_tracker`** — tiny, few keys, no growth.
- **`board_db.board`** — 12-element array, rewritten wholesale every edit. Could become a table but the blast radius of the change is high for minimal benefit.

## Migration pattern (one namespace at a time)

Do these in a single commit per namespace so it can be reverted cleanly:

1. Write a migration SQL file (`lib/migrations/00XX_<name>.sql`) that creates the target table and backfills from `kv_store`.
2. Add a purpose-built module (e.g. `lib/ratingsRepo.js`) with the specific methods the callers need — don't try to preserve the jsoning interface past the call-site level.
3. Swap the call sites — they were using `.get/.set/.push` on the KV object; now they call `ratingsRepo.add()` / `ratingsRepo.findByItem()` etc.
4. Leave the old KV row in place for one deploy cycle as a rollback safety net. Delete in a follow-up.
5. Update `CLAUDE.md` and this doc.

A `db:migrate` runner that applies ordered SQL files once would be a nice-to-have before Tier 1 — we'll want it by the third table.

## What we learned that's worth keeping in mind

- **Hot-path concurrency was a real risk, not theoretical.** The `!join` rush would have dropped entries under KV if we hadn't wrapped queue mutation in `.update()`. When any Tier-4 migration lands, keep the unique-constraint-based approach — it's both safer and simpler.
- **The shim's per-key promise chain is a single-process lock.** If the bot ever scales to multiple containers (unlikely but worth flagging), app-level locking stops helping and we lean entirely on `SELECT FOR UPDATE`. `.update()` already uses both, so it survives that transition; direct `.set()` does not.
- **The JSON snapshot in `db/*.json` is frozen in time** — after this migration, the app never reads or writes those files. They're useful only as a local dev seed via `npm run db:migrate`. Don't be surprised when they go stale.
