import jsoning from 'jsoning';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { splotStates, initializeSettings, get_random_splot, abbadabbabotSay, say } from './utils.js';
import { state } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const board_db = new jsoning("db/board_db.json");
const breakaways_db = new jsoning("db/breakaways_db.json");
const action_log_db = new jsoning("db/action_log.json");
const dice_log_db = new jsoning("db/dice_log.json");
const votes_db = new jsoning("db/votes.json");
const settings_db = new jsoning("db/settings.json");
const historical_splots_db = new jsoning("db/historical_splots.json");
const timer_db = new jsoning("db/timer_db.json");

// Handler for adding time to subathon timer
const handleSubathonAddTime = async (seconds, source, io) => {
  // Get all required values in a single read operation
  const [isPaused, multiplierEnabled, multiplierValue, endTime, remainingAtPause] = await Promise.all([
    timer_db.get("is_paused"),
    timer_db.get("multiplier_enabled"),
    timer_db.get("multiplier_value"),
    timer_db.get("end_time"),
    timer_db.get("remaining_at_pause")
  ]);

  const currentTime = Date.now();
  const adjustedSeconds = (multiplierEnabled ? seconds * (multiplierValue || 2) : seconds);
  
  // Calculate current remaining time before adding new time
  let timeRemainingBefore;
  if (isPaused) {
    timeRemainingBefore = remainingAtPause || 0;
  } else {
    timeRemainingBefore = endTime && endTime > currentTime ? endTime - currentTime : 0;
  }

  // Calculate new end time
  const baseEndTime = (!endTime || endTime < currentTime) ? currentTime : endTime;
  const newEndTime = baseEndTime + (adjustedSeconds * 1000);

  // Update end_time first
  await timer_db.set("end_time", newEndTime);

  // Calculate new remaining time for paused state
  const currentRemaining = remainingAtPause || 0;
  const newRemaining = currentRemaining + (adjustedSeconds * 1000);

  // Handle remaining_at_pause separately to ensure valid values
  if (isPaused && newRemaining > 0) {
    await timer_db.set("remaining_at_pause", newRemaining);
  }

  // Calculate time remaining after update
  const timeRemainingAfter = isPaused ? newRemaining : (newEndTime - currentTime);

  const logEntry = {
    action: "add_time",
    seconds: adjustedSeconds,
    originalSeconds: seconds,
    multiplier: multiplierEnabled ? (multiplierValue || 2) : 1,
    source,
    timeRemainingBefore: Math.floor(timeRemainingBefore / 1000),
    timeRemainingAfter: Math.floor(timeRemainingAfter / 1000),
    newEndTime: new Date(newEndTime).toISOString(),
    timestamp: new Date().toISOString()
  };
  await timer_db.push("logs", logEntry);

  io.to('subathon_timer').emit('subathon_time_added', adjustedSeconds);
  io.to('subathon_timer').emit('timer_log', logEntry);
  console.log(`Added ${adjustedSeconds} seconds (${multiplierEnabled ? `${multiplierValue}x multiplier` : 'no multiplier'}) from ${source}, new end time: ${new Date(newEndTime)}`);
};

// Export the handlers
export { handleSubathonAddTime };

export const initializeSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log("a user connected");

    socket.on("board_admin", async (arg, callback) => {
      console.log("board_admin");
      console.log("arg:", arg);
      let current_board = await board_db.get("board");
      if (current_board == null) {
        current_board = [];
      }
      console.log("current_board:", current_board);
      var splot_id_exists = current_board.findIndex(
        (current_board, index) => current_board.id == arg.id
      );

      console.log("does splot id exist:", splot_id_exists);
      if (splot_id_exists == -1) {
        console.log("add splot");
        await board_db.push("board", arg);
      } else {
        console.log("update splot");
        current_board.forEach(async (this_splot, index) => {
          if (this_splot.id == arg.id) {
            current_board[index] = arg;
            await board_db.set("board", current_board);
            console.log("updating database");
          }
        });

      }
      if (arg.entry.toLowerCase() !== "blank splot") {
        let historical_splots_dupe_check = await historical_splots_db.get(
          arg.entry.toLowerCase()
        );
        console.log("historical_splots_dupe_check:", historical_splots_dupe_check);
        if (historical_splots_dupe_check == null) {
          let yourDate = new Date();
          yourDate = new Date(yourDate.getTime() - 4 * 60 * 1000);
          let date = yourDate.toISOString();
          await historical_splots_db.set(arg.entry.toLowerCase(), date);
          console.log("adding historical splot:", arg.entry);
        }
      }
      console.log("Should send board_update");
      io.emit("board_update", arg);
      callback("got it");
    });

    socket.on("ba_admin", async (arg, callback) => {
      let current_breakaways = await breakaways_db.get("breakaways");
      if (current_breakaways == null) {
        current_breakaways = [];
      }
      console.log("current_breakaways:", current_breakaways);
      var ba_exists = current_breakaways.findIndex(
        (current_breakaway, index) => current_breakaway.id == arg.id
      );

      console.log(ba_exists);
      if (ba_exists == -1) {
        console.log("add breakaway");
        await breakaways_db.push("breakaways", arg);
      } else {
        console.log("update breakaway");
        current_breakaways.forEach(async (this_ba, index) => {
          if (this_ba.id == arg.id) {
            current_breakaways[index] = arg;
            await breakaways_db.set("breakaways", current_breakaways);
          }
        });
      }
      callback("got it");
      io.emit("ba_update", arg);
    });

    socket.on("alt_splot_swap", (splotData, callback) => {
      if (splotStates[splotData.id]) {
        splotStates[splotData.id].isAlt = !splotStates[splotData.id].isAlt;
      } else {
        splotStates[splotData.id] = { isAlt: true };
      }
      io.emit("alt_splot_swap", { ...splotData, isAlt: splotStates[splotData.id].isAlt });
    });

    socket.on("clear_board", async (arg, callback) => {
      await board_db.set("board", []);
      console.log(arg);
      callback("board_cleared");
      io.emit("clear_board", []);
    });

    socket.on("log_action", async (arg, callback) => {
      callback("action_logged");
      await action_log_db.push(arg.entry, arg);
    });

    socket.on("timer_admin", (arg, callback) => {
      callback("timer_admin timer updated");
      io.emit("timer_server", arg);
    });

    // Subathon timer controls
    socket.on("subathon_add_time", async (seconds, source = 'manual') => {
      await handleSubathonAddTime(seconds, source, io);
    });

    socket.on("subathon_subtract_time", async (seconds, reason = 'manual') => {
      const isPaused = await timer_db.get("is_paused");
      const endTime = await timer_db.get("end_time");
      const currentTime = Date.now();

      if (endTime) {
        const newEndTime = Math.max(currentTime, endTime - (seconds * 1000));
        await timer_db.set("end_time", newEndTime);

        if (isPaused) {
          const remainingAtPause = await timer_db.get("remaining_at_pause") || 0;
          await timer_db.set("remaining_at_pause", Math.max(0, remainingAtPause - (seconds * 1000)));
        }

        const logEntry = {
          action: "subtract_time",
          seconds,
          reason,
          newEndTime: new Date(newEndTime).toISOString(),
          timestamp: new Date().toISOString()
        };
        await timer_db.push("logs", logEntry);

        io.to('subathon_timer').emit('subathon_time_subtracted', seconds);
        io.to('subathon_timer').emit('timer_log', logEntry);
        console.log(`Subtracted ${seconds} seconds (${reason}), new end time: ${new Date(newEndTime)}`);
      }
    });

    socket.on("subathon_set_time", async (seconds) => {
      const currentTime = Date.now();
      const endTime = currentTime + (seconds * 1000);
      
      // Reset timer state
      await timer_db.set("end_time", endTime);
      await timer_db.set("is_paused", false);
      await timer_db.set("remaining_at_pause", null);
      await timer_db.set("auto_pause_count", 0); // Reset auto-pause count when timer is set
      
      const logEntry = {
        action: "set_time",
        seconds,
        newEndTime: new Date(endTime).toISOString(),
        timestamp: new Date().toISOString()
      };
      await timer_db.push("logs", logEntry);

      io.to('subathon_timer').emit('subathon_time_set', seconds);
      io.to('subathon_timer').emit('subathon_timer_state', false);
      io.to('subathon_timer').emit('timer_log', logEntry);
      console.log(`Set timer to ${seconds} seconds, ending at ${new Date(endTime)}`);
    });

    socket.on("set_multiplier", async (data) => {
      await timer_db.set("multiplier_enabled", data.enabled);
      await timer_db.set("multiplier_value", data.value);
      
      const logEntry = {
        action: data.enabled ? "multiplier_enabled" : "multiplier_disabled",
        value: data.value,
        timestamp: new Date().toISOString()
      };
      await timer_db.push("logs", logEntry);
      
      io.to('subathon_timer').emit('multiplier_state', {
        enabled: data.enabled,
        value: data.value
      });
      io.to('subathon_timer').emit('timer_log', logEntry);
      
      console.log(`Multiplier ${data.enabled ? 'enabled' : 'disabled'} at ${data.value}x`);
    });

    socket.on("subathon_toggle_timer", async () => {
      const isPaused = await timer_db.get("is_paused") || false;
      const endTime = await timer_db.get("end_time");
      const currentTime = Date.now();
      
      if (isPaused) {
        // Resume timer - calculate remaining time and set new end time
        const remainingAtPause = await timer_db.get("remaining_at_pause");
        
        if (remainingAtPause) {
          const newEndTime = currentTime + remainingAtPause;
          await timer_db.set("end_time", newEndTime);
          await timer_db.set("is_paused", false);
          await timer_db.set("remaining_at_pause", null);
          await timer_db.set("auto_pause_count", 0); // Reset auto-pause count when timer is manually resumed
          
          const logEntry = {
            action: "resume",
            remainingTime: remainingAtPause / 1000,
            newEndTime: new Date(newEndTime).toISOString(),
            timestamp: new Date().toISOString()
          };
          await timer_db.push("logs", logEntry);
          
          // Broadcast new state and time to all clients
          io.to('subathon_timer').emit('subathon_timer_state', false);
          io.to('subathon_timer').emit('subathon_time_set', Math.floor(remainingAtPause / 1000));
          io.to('subathon_timer').emit('timer_log', logEntry);
          
          console.log(`Timer resumed with ${remainingAtPause / 1000} seconds remaining`);
        }
      } else {
        // Pause timer - store current remaining time
        const remainingTime = Math.max(0, endTime - currentTime);
        await timer_db.set("remaining_at_pause", remainingTime);
        await timer_db.set("is_paused", true);
        
        const logEntry = {
          action: "pause",
          remainingTime: remainingTime / 1000,
          timestamp: new Date().toISOString()
        };
        await timer_db.push("logs", logEntry);
        
        // Broadcast pause state to all clients
        io.to('subathon_timer').emit('subathon_timer_state', true);
        io.to('subathon_timer').emit('timer_log', logEntry);
        
        console.log(`Timer paused with ${remainingTime / 1000} seconds remaining`);
      }
    });

    socket.on("get_timer_state", async () => {
      const isPaused = await timer_db.get("is_paused") || false;
      socket.emit('subathon_timer_state', isPaused);
    });

    socket.on("get_timer_logs", async () => {
      const logs = await timer_db.get("logs") || [];
      logs.reverse().forEach(log => {
        socket.emit('timer_log', log);
      });
    });

    socket.on("set_vods_enabled", async (enabled) => {
      await timer_db.set("vods_enabled", enabled);
      
      const logEntry = {
        action: enabled ? "vods_enabled" : "vods_disabled",
        timestamp: new Date().toISOString()
      };
      await timer_db.push("logs", logEntry);
      
      io.to('subathon_timer').emit('vods_state', enabled);
      io.to('subathon_timer').emit('timer_log', logEntry);
      
      console.log(`VODs ${enabled ? 'enabled' : 'disabled'}`);
    });

    socket.on("check_bits_for_vod", async (bits) => {
      if (bits === 50) {
        const vodsEnabled = await timer_db.get("vods_enabled") || false;
        if (vodsEnabled) {
          // Create an iframe element with the random vod URL
          const vodUrl = 'https://streamgood.gg/clips/player?mode=random&current_game=false&info=true&volume=50&max_length=60&filter_long_videos=false&show_timer=true&recent_clips=0&channel=abbabox';
          io.emit('play_random_vod', { url: vodUrl });
          
          // Add to timer log
          const logEntry = {
            action: "random_vod_redeem",
            source: "50 bit cheer",
            timestamp: new Date().toISOString()
          };
          await timer_db.push("logs", logEntry);
          io.to('subathon_timer').emit('timer_log', logEntry);
        }
      }
    });

    // For testing vods from admin panel
    socket.on("random_vod_redeem", async () => {
      // Create an iframe element with the random vod URL
      const vodUrl = 'https://streamgood.gg/clips/player?mode=random&current_game=false&info=true&volume=50&max_length=60&filter_long_videos=false&show_timer=true&recent_clips=0&channel=abbabox';
      io.emit('play_random_vod', { url: vodUrl });
      
      // Add to timer log
      const logEntry = {
        action: "random_vod_redeem",
        source: "50 bit redeem",
        timestamp: new Date().toISOString()
      };
      await timer_db.push("logs", logEntry);
      io.to('subathon_timer').emit('timer_log', logEntry);
    });

    socket.on("subathon_auto_pause", async () => {
      const autoPauseCount = await timer_db.get("auto_pause_count") || 0;
      
      if (autoPauseCount < 3) {
        // Only auto-pause if we haven't reached the limit
        const isPaused = await timer_db.get("is_paused") || false;
        const endTime = await timer_db.get("end_time");
        const currentTime = Date.now();
        
        if (!isPaused) {
          // Pause timer and increment counter
          const remainingTime = Math.max(0, endTime - currentTime);
          await timer_db.set("remaining_at_pause", remainingTime);
          await timer_db.set("is_paused", true);
          await timer_db.set("auto_pause_count", autoPauseCount + 1);
          
          const logEntry = {
            action: "auto_pause",
            remainingTime: remainingTime / 1000,
            autoPauseCount: autoPauseCount + 1,
            timestamp: new Date().toISOString()
          };
          await timer_db.push("logs", logEntry);
          
          // Broadcast pause state to all clients
          io.to('subathon_timer').emit('subathon_timer_state', true);
          io.to('subathon_timer').emit('timer_log', logEntry);
          
          console.log(`Timer auto-paused with ${remainingTime / 1000} seconds remaining (Auto-pause ${autoPauseCount + 1}/3)`);
        }
      }
    });

    socket.on("join_subathon_timer", async () => {
      socket.join('subathon_timer');
      console.log("Client joined subathon timer room");
      
      const isPaused = await timer_db.get("is_paused") || false;
      const multiplierEnabled = await timer_db.get("multiplier_enabled") || false;
      const multiplierValue = await timer_db.get("multiplier_value") || 2;
      const vodsEnabled = await timer_db.get("vods_enabled") || false;
      let remainingSeconds = 0;
      
      if (isPaused) {
        // If paused, use the stored remaining time
        const remainingAtPause = await timer_db.get("remaining_at_pause");
        if (remainingAtPause) {
          remainingSeconds = Math.floor(remainingAtPause / 1000);
        }
      } else {
        // If running, calculate from end time
        const endTime = await timer_db.get("end_time");
        if (endTime) {
          remainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        }
      }
      
      socket.emit('subathon_time_set', remainingSeconds);
      socket.emit('subathon_timer_state', isPaused);
      socket.emit('multiplier_state', {
        enabled: multiplierEnabled,
        value: multiplierValue
      });
      socket.emit('vods_state', vodsEnabled);
      console.log(`Loaded saved timer with ${remainingSeconds} seconds remaining, paused: ${isPaused}, multiplier: ${multiplierEnabled ? multiplierValue + 'x' : 'disabled'}`);
    });

    socket.on("get_random_splot", (arg, callback) => {
      var random_splot = get_random_splot();
      callback(random_splot);
    });

    socket.on("dice_roll", async (arg, callback) => {
      var current_dice_roll = await dice_log_db.get("dice_roll");
      if (current_dice_roll == null) {
        current_dice_roll = [];
      }
      console.log("current_dice_roll:", current_dice_roll);
      await dice_log_db.push("dice_roll", arg);
      io.emit("dice_rolled", arg);
      callback("dice_roll processed");
    });

    socket.on("ai_toggle", (arg, callback) => {
      state.ai_enabled = !state.ai_enabled;
      console.log("ai_enabled:", state.ai_enabled);
      callback(state.ai_enabled);
    });

    socket.on("updateNotification", async (message) => {
      io.emit("newNotification", message);
      await settings_db.set("notification", message);
    });

    socket.on("play_win", (message, callback) => {
      io.emit("win_sound", message);
      callback("win passed");
    });

    socket.on("play_lose", (message, callback) => {
      io.emit("lose_sound", message);
      callback("loser passed");
    });

    socket.on("play_sound", (message, callback) => {
      console.log(message, "sound alert triggered");
      io.emit("soundAlert", message.type);
      callback("sound passed");
    });

    socket.on("godVote", async (message, callback) => {
      let godName = message.godName;
      let vote = message.vote;
      let godVotes = await votes_db.get("godVotes");
      if (!godVotes) {
        godVotes = [];
      }
      const godVote = godVotes.find((vote) => vote.user === godName);
      let oldVote = null;
      if (godVote) {
        oldVote = godVote.vote;
        if (godVote.vote !== vote) {
          godVote.vote = vote;
          await votes_db.set("godVotes", godVotes);
          io.emit("change_god_vote", { user: godName, vote: vote, oldVote: oldVote });
        }
      } else {
        await votes_db.push("godVotes", { user: godName, vote: vote });
        io.emit("god-vote", { user: godName, vote: vote });
      }
    });
  });
};
