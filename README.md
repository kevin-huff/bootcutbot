# bootcutbot
A Node.js Twitch bot and web overlay system purpose-built for the game of Bootcut, played on the Twitch channel [Abbabox](https://twitch.tv/abbabox). Also a good basis for other queue-based bots.

## The Game of Bootcut

Bootcut is an interactive variety-show board game played on stream. The board is a 12-spot grid where each spot (called a **splot**) contains a challenge for the streamer to perform (e.g., "serenade the yoda statue", "ween karaoke", "Muscle Shrek Memes"). Each splot has a **uses** counter — when uses run out, it becomes blank.

**How a turn works:**

1. `!ap` (auto-pick) selects a chatter from the queue in a **Random-Random-Next** repeating sequence
2. The chatter has a **4-minute timer** for the dice-rolling portion of their turn
3. A **d12 is rolled** (physical Bluetooth GoDice) to land on one of the 12 splots
4. The chatter **chooses to accept the splot or breakaway**
5. If they **breakaway**, a **d6 decides their fate**:
   - **1** — erase the splot and replace it with something new
   - **3** — forced to do it anyway
   - **6** — re-roll the d12 and pick a new splot
6. If they land on a **blank splot**, the chatter fills it in with a new challenge
7. The **streamer then performs the activity** — this is the main content (typically 5-20 minutes per splot)

**Breakaways** are a shared resource pool for the whole chat. More can be earned through Twitch channel point redemptions or by completing certain splots that award them. When the pool is empty, no one can breakaway — you have to do whatever you land on.

The board is community-curated — chatters create challenges when filling blanks, and the streamer has final say on what goes on the board. A typical stream gets through **2-4 turns per hour**. Turns can be purchased for 400 bits when a queued player isn't present, and a "super duper breakaway" costs 300 bits (both handled manually by mods).

Physical Bluetooth dice (GoDice) are used for all rolls, with LED feedback for win/loss states.

# install
1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Add your details to `.env`


## Asset Migration

To migrate assets from `cdn.glitch.global` to your Cloudflare R2 bucket and update references, set the following environment variables in your `.env` file or shell:

```
R2_ACCESS_KEY_ID=<your access key>
R2_SECRET_ACCESS_KEY=<your secret key>
R2_ACCOUNT_ID=<your account id>
R2_BUCKET_NAME=<bucket name>
```

Run the migration script with:

```
npm run migrate-assets
```

The script downloads each asset listed in `.glitch-assets`, uploads it to Cloudflare R2, and rewrites file references to use `https://cdn.leantube.org/<filename>`.
