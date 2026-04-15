# Front Page Plans

Prep for Abbabox's front page appearance (week of 2026-04-21). Current stream averages ~60 viewers with 20-30 in queue. Expecting 1000+ viewers.

## Approved Ideas (pending Abba sign-off)

### Auto-Pull Splots on Breakaway 1-Rolls (Abba's pitch)
When a chatter rolls a 1 on the breakaway d6, instead of "erase and replace with whatever you want," the bot **auto-pulls a splot from a curated database** of pre-screened spots. No chatter input needed.

**Why:** Solves two problems at once — new viewers don't freeze trying to invent a splot, and the board cycles faster because splots refill instantly. Also lets popular/proven splots return to the board naturally.

**Needs:**
- A curated "front page splot pool" — a tighter subset of the 1,752+ historical splots, pre-screened by Abba/mods
- Admin interface to manage the pool (add/remove/review splots)
- Logic to auto-fill on BA 1-roll instead of prompting the chatter
- Decide: does this replace freestyle entirely, or is freestyle still an option for regulars?

## Other Streamlining Ideas

### New Viewer Onboarding
- **Auto-explanation on first `!join`**: Bot whispers or replies with a brief "here's how Bootcut works" message when a user joins the queue for the first time.
- **Periodic chat explainer**: Timed message (every 10-15 min) with a one-liner about the game and a link to the infographic. More frequent than normal streams since churn will be high.
- **"What's happening now" overlay element**: Small persistent overlay that shows current state — who's turn it is, what splot they're doing, how many breakaways are left. Helps drop-in viewers orient immediately.

### Queue at Scale
- **Queue cap**: Set a maximum queue size (e.g., 50-100) so people aren't joining at position 400 with no realistic chance. Communicate when queue is full. Reopen periodically.
- **Queue position feedback**: When someone `!join`s, tell them their position AND estimated wait based on ~15-20 min per turn. Manages expectations.
- **Lottery mode**: Alternative to strict queue — everyone in queue has a chance each round. Could replace or supplement the R-R-N auto-pick for the front page event specifically. Feels fairer when hundreds join within minutes of each other.

### Turn Pacing
- **Front-page splot pool**: Pre-load the board with splots that are entertaining but on the shorter side (5-10 min). Save the 20-minute deep dives for regular streams. More turns = more chatters get picked = more engagement.
- **Splot time estimates**: Tag splots with rough duration (quick/medium/long) so the board can be weighted toward faster activities during high-viewer events.

### Monetization Opportunities
- **Individual breakaway banks**: Chatters can buy personal breakaways (bits or channel points) in addition to the shared pool. Impulse purchase when you land on something you hate.
- **Paid splot placement**: Pay bits/points to fill a blank splot with your choice (streamer still has veto). People will pay to make Abba do something specific.
- **Priority queue**: Pay to move up in queue. Separate from the existing 400-bit turn purchase. Could be a channel point redemption.
- **Splot protection**: Pay to "lock" a splot so it can't be broken away from — guarantees it gets played.
- **Community splot campaign**: Chat pools channel points/bits toward a specific splot they want on the board. When it hits a threshold, it gets added (replacing a blank or queued for the next one). Gives non-current-players something to invest in at any point during the stream. Abba has veto. **How chat chooses what to campaign for (needs further discussion):**
  - Mod/streamer proposes 2-3 candidates, chat funds their pick (simplest, top-down)
  - Chat nominates via `!nominate`, then a vote opens (chaotic at scale)
  - Rolling campaign board overlay showing 3-4 options, chat spends points on their favorite, first to threshold wins (always running, most engaging)
  - Curated nomination: anyone can `!nominate`, mods approve which ones go to the campaign board, chat funds the approved ones (best quality control)

## Parking Lot (longer-term ideas, not for front page week)
- Head-to-head turns (two chatters picked, competitive element)
- Session arc / board "leveling up" after all 12 splots completed
- Chat-wide consequence splots that affect the whole board
- Leaderboards for participation, splot creation, breakaway usage

## Status
- [ ] Abba sign-off on auto-pull splots (BA 1-roll)
- [ ] Abba sign-off on queue cap / lottery mode
- [ ] Abba sign-off on front-page splot pool
- [ ] Abba sign-off on monetization changes
- [ ] Decide on new viewer onboarding approach
- [ ] Implementation begins
