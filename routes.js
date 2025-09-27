import express from 'express';
import path from 'path';
import momentTz from 'moment-timezone';
import jsoning from 'jsoning';
import bodyParser from 'body-parser';
import basicAuth from 'express-basic-auth';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { state } from './constants.js';
import { getAuthUrl, handleAuthCallback } from './auth.js';
import { initializeEventSub } from './eventSub.js';
import { hellfireSpotIds, heavenfireSpotIds } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
router.use(bodyParser.json());

const settings_db = new jsoning("db/queue_settings.json");
const queue_db = new jsoning("db/queue.json");
const turns_db = new jsoning("db/turns.json");
const board_db = new jsoning("db/board_db.json");
const ratings_db = new jsoning("db/ratings_db.json");
const breakaways_db = new jsoning("db/breakaways_db.json");
const historical_splots_db = new jsoning("db/historical_splots.json");
const timer_db = new jsoning("db/timer_db.json");

router.get("/historical_splots.json", (req, res) => {
  res.sendFile(path.join(__dirname, "db/historical_splots.json"));
});

router.get("/dice_log.json", (req, res) => {
  res.sendFile(path.join(__dirname, "dice_log.json"));
});

router.get("/diceData", (req, res) => {
  res.render("diceData.ejs", {
    banner_image: process.env.banner_image,
  });
});

router.get("/just_timer", (req, res) => {
  res.render("just_timer.ejs", {});
});

router.get("/turn", (req, res) => {
  res.render("turn.ejs", {
    current_turn: state.current_turn,
  });
});

router.get("/countdown", (req, res) => {
  const time = req.query.end || "00:00:00"; // Default to midnight if no time provided
  const dateTimeEST = moment
    .tz(`${moment().format("YYYY-MM-DD")}T${time}`, "America/New_York")
    .format();

  res.render("countdown", { endTime: dateTimeEST });
});

router.get("/timer", async (req, res) => {
  const isPaused = await timer_db.get("is_paused");
  let remainingTime = 0;
  
  if (isPaused) {
    // If paused, use the stored remaining time
    remainingTime = await timer_db.get("remaining_at_pause") || 0;
  } else {
    // If running, calculate from end time
    const endTime = await timer_db.get("end_time");
    if (endTime) {
      remainingTime = Math.max(0, endTime - Date.now());
    }
  }

  res.render("timer.ejs", {
    initial_seconds: Math.floor(remainingTime / 1000)
  });
});

router.get("/timer_admin", basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), async (req, res) => {
  const isPaused = await timer_db.get("is_paused");
  let remainingTime = 0;
  
  if (isPaused) {
    // If paused, use the stored remaining time
    remainingTime = await timer_db.get("remaining_at_pause") || 0;
  } else {
    // If running, calculate from end time
    const endTime = await timer_db.get("end_time");
    if (endTime) {
      remainingTime = Math.max(0, endTime - Date.now());
    }
  }

  res.render("timer_admin.ejs", {
    initial_seconds: Math.floor(remainingTime / 1000)
  });
});

router.get("/menu", (req, res) => {
  res.render("menu.ejs", {
    queue_open: state.queue_open,
    first_turn_first: state.firsts_first,
    banner_image: process.env.banner_image,
    current_turn: state.current_turn,
  });
});

router.get("/board", (req, res) => {
  let current_breakaways = breakaways_db.get("breakaways");
  if (current_breakaways == null) {
    current_breakaways = [];
  }
  res.render("integrated_board_hell.ejs", {
    board: board_db.get("board"),
    breakaways: current_breakaways,
    current_turn: state.current_turn,
    hellfireSpotIds: Array.from(hellfireSpotIds),
    heavenFireSpotIds: Array.from(heavenfireSpotIds)
  });
});

router.get("/board_big", (req, res) => {
  res.render("board_big.ejs", {
    board: board_db.get("board"),
    current_turn: state.current_turn,
  });
});

router.get("/ratings", (req, res) => {
  res.render("ratings.ejs", {
    ratings: ratings_db.get("ratings"),
    banner_image: process.env.banner_image,
  });
});

router.get("/bootcut_board", (req, res) => {
  let current_breakaways = breakaways_db.get("breakaways");
  if (current_breakaways == null) {
    current_breakaways = [];
  }
  res.render("bootcut_board.ejs", {
    board: board_db.get("board"),
    breakaways: state.current_breakaways,
    current_turn: state.current_turn,
  });
});

router.get("/breakaways", (req, res) => {
  let current_breakaways = breakaways_db.get("breakaways");
  if (current_breakaways == null) {
    current_breakaways = [];
  }
  res.render("breakaways.ejs", {
    board: board_db.get("board"),
    breakaways: state.current_breakaways,
    current_turn: state.current_turn,
  });
});

router.get("/splot_db", (req, res) => {
  const historical_splots = historical_splots_db.all();
  res.render("historical_splots.ejs", {
    splots: historical_splots,
    banner_image: process.env.banner_image,
  });
});

router.get("/board_admin", basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), (req, res) => {
  var breakaways = breakaways_db.get("breakaways");
  if (breakaways == null) {
    var breakaways = [];
  }
  res.render("board_admin.ejs", {
    data: {
      board: board_db.get("board"),
      breakaways: breakaways,
      current_turn: state.current_turn,
      username: process.env.bot_account,
      password: process.env.oauth,
      channels: [process.env.twitch_channel],
    },
  });
});

router.get("/", async (req, res) => {
  var last_turn_id = settings_db.get("turn_count");
  var this_turn_id = last_turn_id++;
  var queue = queue_db.get("queue");
  if (queue == null) {
    var queue = [];
  }
  var turn_counter = turns_db.get("turns");
  if (turn_counter == null) {
    var turn_counter = [];
  }
  const endTime = await timer_db.get("end_time") || Date.now();
  res.render("index.ejs", {
    queue: queue,
    turns: turn_counter,
    queue_open: state.queue_open,
    first_turn_first: state.firsts_first,
    banner_image: process.env.banner_image,
    current_turn: state.current_turn,
    magic_number: 3,
    end_time: endTime,
    turn_count: this_turn_id,
  });
});

router.get("/deaths", (req, res) => {
  var deaths = deaths_db.get("deaths");
  if (deaths == null) {
    var deaths = 0;
  }
  res.render("deathcounter.ejs", {
    death_count: deaths,
  });
});

router.get("/rolls", (req, res) => {
  res.render("rolls.ejs");
});

router.get("/crowd_sound", (req, res) => {
  res.render("crowd_sound.ejs");
});

router.get("/notification_admin", (req, res) => {
  res.render("notification_admin", {
    notification: settings_db.get("notification"),
  });
});

router.get("/chaz_roll", (req, res) => {
  res.render("chaz_roll.ejs");
});

router.get("/notification", (req, res) => {
  res.render("notification", {
    notification: settings_db.get("notification"),
  });
});

router.get("/tts", (req, res) => {
  const filePath = __dirname + "/public/audio/output.mp3";
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.sendFile(filePath);
});

router.get("/progress", async (req, res) => {
  res.render("progress", {
    votes: await votes_db.get("votes"),
    godVotes: await votes_db.get("godVotes"),
  });
});

router.get("/god_dash", (req, res) => {
  res.render("god_dash");
});

// Auth routes
router.get("/auth", basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), (req, res) => {
  res.render("auth.ejs");
});

router.get("/auth/twitch", (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

router.get("/auth/status", (req, res) => {
  const eventSubClient = req.app.get('eventSubClient');
  res.json({ connected: eventSubClient ? true : false });
});

router.get("/auth/twitch/callback", async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }

  try {
    await handleAuthCallback(code);
    
    // Get the io instance from the app
    const io = req.app.get('io');
    if (!io) {
      console.error('Socket.io instance not found');
    } else {
      // Get the existing EventSub client if any
      let existingClient = req.app.get('eventSubClient');
      if (existingClient) {
        console.log('Stopping existing EventSub client...');
        await existingClient.stop();
      }

      // Reinitialize EventSub with the new token
      const eventSubClient = await initializeEventSub(io);
      if (eventSubClient) {
        console.log('EventSub reinitialized successfully after authentication');
        // Store the new client
        req.app.set('eventSubClient', eventSubClient);
      }
    }
    
    res.render("auth.ejs", { success: true });
  } catch (error) {
    console.error('Auth callback error:', error);
    res.render("auth.ejs", { error: error.message });
  }
});

router.get("/sub_tracker", (req, res) => {
  // Get subsTracker from settings_db
  const subsTracker = settings_db.get("subsTracker");
  const bitsTracker = settings_db.get("bitsTracker");
  const donationsTracker = settings_db.get("donationsTracker");
  const completed_spins = settings_db.get("completedSpins") || 0;

  res.render("sub_tracker", {
    current_subcount: subsTracker,
    current_bits: bitsTracker,
    current_donations: donationsTracker,
    completed_spins: completed_spins
  });
});
// Setup receiver for 4th wall webhooks
router.post("/4th_wall", async (req, res) => {
  console.log("4th wall webhook received");
  let purchaseAmount = req.body.data.amounts.subtotal;
  console.log("Purchase amount:", purchaseAmount);

  if (purchaseAmount.currency === 'USD') {
    // Add 1 minute per dollar
    const minutes = Math.floor(purchaseAmount.value);
    if (minutes > 0) {
      // Get the io instance
      const io = req.app.get('io');
      if (io) {
        // Get socket handler
        const socketHandlers = req.app.get('socketHandlers');
        if (socketHandlers && socketHandlers.handleSubathonAddTime) {
          await socketHandlers.handleSubathonAddTime(minutes * 60, `merch_$${purchaseAmount.value}`, io);
        } else {
          console.error('Socket handlers not found');
        }
        console.log(`Added ${minutes} minutes from merch purchase of $${purchaseAmount.value}`);
      } else {
        console.error('Socket.io instance not found');
      }
    }
  }
  
  res.sendStatus(200);
});

export default router;
