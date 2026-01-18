import jsoning from 'jsoning';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { splotStates, hellfireSpotIds, heavenfireSpotIds, initializeSettings, get_random_splot, abbadabbabotSay, say } from './utils.js';
import {
  getTormentMeterState,
  recordContribution as recordTormentContribution,
  resetTormentMeter,
  setAudioUrl as setTormentAudioUrl,
  setBaseGoal as setTormentBaseGoal,
  setMinGoal as setTormentMinGoal,
  dollarsToCentsSafe
} from './tormentMeterService.js';
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
const wheel_db = new jsoning("db/wheel_db.json");

const WHEEL_COLOR_PALETTE = [
  "#ff4444",  // red
  "#00ff66",  // green
  "#ffaa00",  // orange
  "#aa00aa",  // purple
  "#00aaff",  // blue
  "#ff66cc",  // pink
  "#ffcc00",  // yellow
  "#66ffcc",  // cyan
  "#ff9966",  // peach
  "#9966ff",  // violet
  "#66ff99",  // mint
  "#ff6699"   // coral
];

const randomWheelColor = () =>
  WHEEL_COLOR_PALETTE[Math.floor(Math.random() * WHEEL_COLOR_PALETTE.length)];

const normalizeWheelSlots = (rawSlots) => {
  if (!Array.isArray(rawSlots)) return null;
  const normalized = [];
  rawSlots.forEach((slot, index) => {
    if (!slot || typeof slot !== "object") return;
    const label = String(slot.label || "").trim();
    const color = String(slot.color || "").trim() || randomWheelColor();
    const weight = Number(slot.weight ?? 1);
    if (!label || !color || !Number.isFinite(weight) || weight <= 0) return;
    const id = Number.isFinite(Number(slot.id)) ? Number(slot.id) : index + 1;
    normalized.push({ id, label, color, weight });
  });
  return normalized.length > 0 ? normalized : null;
};

// Handler for adding time to subathon timer
const handleSubathonAddTime = async (seconds, source, io) => {
  // Get all required values in a single read operation
  const [isPaused, multiplierEnabled, multiplierValue, endTime, remainingAtPause, maxEndTime] = await Promise.all([
    timer_db.get("is_paused"),
    timer_db.get("multiplier_enabled"),
    timer_db.get("multiplier_value"),
    timer_db.get("end_time"),
    timer_db.get("remaining_at_pause"),
    timer_db.get("max_end_time")
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
  let newEndTime = baseEndTime + (adjustedSeconds * 1000);

  // Cap at max end time if set
  let wasCapped = false;
  if (maxEndTime && newEndTime > maxEndTime) {
    newEndTime = maxEndTime;
    wasCapped = true;
  }

  // Update end_time first
  await timer_db.set("end_time", newEndTime);

  // Calculate new remaining time for paused state
  const currentRemaining = remainingAtPause || 0;
  let newRemaining = currentRemaining + (adjustedSeconds * 1000);

  // Cap remaining time too if we have a max end time
  if (maxEndTime && isPaused) {
    const maxRemaining = maxEndTime - currentTime;
    if (newRemaining > maxRemaining) {
      newRemaining = maxRemaining;
      wasCapped = true;
    }
  }

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
    capped: wasCapped,
    timestamp: new Date().toISOString()
  };
  await timer_db.push("logs", logEntry);

  io.to('subathon_timer').emit('subathon_time_added', adjustedSeconds);
  io.to('subathon_timer').emit('timer_log', logEntry);

  // Broadcast to all clients for overlay animation
  io.emit('timeAdded', {
    seconds: adjustedSeconds,
    source,
    capped: wasCapped,
    multiplier: multiplierEnabled ? (multiplierValue || 2) : 1
  });

  console.log(`Added ${adjustedSeconds} seconds (${multiplierEnabled ? `${multiplierValue}x multiplier` : 'no multiplier'}) from ${source}, new end time: ${new Date(newEndTime)}${wasCapped ? ' [CAPPED]' : ''}`);
};

const SPIN_THRESHOLD_DEFAULT = 60; // $60 triggers a spin

// Handle donation progress - updates donation totals and checks for spin thresholds
// Does NOT add time to the timer (that should be handled separately)
const handleDonationProgress = async (dollarAmount, source, io, sourceDetails = {}) => {
  if (dollarAmount <= 0) return { spinsEarned: 0 };

  const donorName = sourceDetails.username || sourceDetails.name || source || "Anonymous";

  console.log(`[Donation Progress] Processing $${dollarAmount.toFixed(2)} from ${source} (${donorName})`);

  // Update donation totals
  let donationTotal = await settings_db.get("donationTotal") || 0;
  let donationProgress = await settings_db.get("donationProgress") || 0;
  const spinThreshold = await settings_db.get("spinThreshold") || SPIN_THRESHOLD_DEFAULT;

  donationTotal += dollarAmount;
  donationProgress += dollarAmount;

  await settings_db.set("donationTotal", donationTotal);

  // Check for spin threshold
  let spinsEarned = 0;
  while (donationProgress >= spinThreshold) {
    donationProgress -= spinThreshold;
    spinsEarned++;
  }

  await settings_db.set("donationProgress", donationProgress);

  // Add spins if earned
  if (spinsEarned > 0) {
    let pending = await settings_db.get("pendingSpins") || 0;
    pending += spinsEarned;
    await settings_db.set("pendingSpins", pending);
    const completed = await settings_db.get("completedSpins") || 0;
    io.emit("spinStateUpdate", { pending, completed });
    console.log(`[Donation Progress] ${source} added ${spinsEarned} spin(s)! New pending: ${pending}`);

    // Emit spin earned event for overlay effects
    io.emit("spinEarned", { spinsEarned, donorName, amount: dollarAmount, source });
  }

  // Broadcast updated donation state
  const nextSpinIn = Math.max(0, spinThreshold - donationProgress);
  io.emit("donationUpdate", {
    total: donationTotal,
    progress: donationProgress,
    threshold: spinThreshold,
    nextSpinIn,
    progressPercent: Math.min(100, (donationProgress / spinThreshold) * 100)
  });

  console.log(`[Donation Progress] Total: $${donationTotal.toFixed(2)}, Progress: $${donationProgress.toFixed(2)}/${spinThreshold}`);

  return { dollarAmount, spinsEarned };
};

// Export the handlers
export { handleSubathonAddTime, handleDonationProgress };

// Anniversary timer tick interval - broadcasts every second
let anniversaryTimerInterval = null;

const startAnniversaryTimerTick = async (io) => {
  if (anniversaryTimerInterval) return; // Already running

  anniversaryTimerInterval = setInterval(async () => {
    try {
      const isPaused = await timer_db.get("is_paused");
      let remainingSeconds = 0;

      if (isPaused) {
        const remainingAtPause = await timer_db.get("remaining_at_pause");
        remainingSeconds = remainingAtPause ? Math.floor(remainingAtPause / 1000) : 0;
      } else {
        const endTime = await timer_db.get("end_time");
        if (endTime) {
          remainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        }
      }

      // Broadcast to all clients (anniversary overlay and admin)
      io.emit("timerUpdate", remainingSeconds);
    } catch (error) {
      console.error("Timer tick error:", error);
    }
  }, 1000);

  console.log("Anniversary timer tick started");
};

export const initializeSocketHandlers = (io) => {
  // Start the timer tick broadcast
  startAnniversaryTimerTick(io);

  io.on("connection", (socket) => {
    console.log("a user connected");

    (async () => {
      const wheelVisible = await settings_db.get("overlayWheelVisible");
      if (wheelVisible !== undefined && wheelVisible !== null) {
        socket.emit("overlay:wheelVisibility", { active: !!wheelVisible });
      }
      const savedSlots = await wheel_db.get("slots");
      const normalizedSlots = normalizeWheelSlots(savedSlots);
      if (normalizedSlots) {
        socket.emit("updateSlots", normalizedSlots);
      }
    })().catch((error) => {
      console.error("Failed to load overlay wheel state:", error);
    });

    // Handle admin state request - send all current anniversary state
    socket.on("admin:requestState", async () => {
      try {
        // Timer state
        const isPaused = await timer_db.get("is_paused");
        const maxEndTime = await timer_db.get("max_end_time");
        let remainingSeconds = 0;

        if (isPaused) {
          const remainingAtPause = await timer_db.get("remaining_at_pause");
          remainingSeconds = remainingAtPause ? Math.floor(remainingAtPause / 1000) : 0;
        } else {
          const endTime = await timer_db.get("end_time");
          if (endTime) {
            remainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
          }
        }

        socket.emit("timerUpdate", remainingSeconds);
        socket.emit("timerPauseState", isPaused);

        // Max end time
        if (maxEndTime) {
          socket.emit("maxEndTimeUpdate", { maxEndTime, datetime: new Date(maxEndTime).toISOString() });
        } else {
          socket.emit("maxEndTimeUpdate", { maxEndTime: null });
        }

        // Spin state
        const pending = await settings_db.get("pendingSpins") || 0;
        const completed = await settings_db.get("completedSpins") || 0;
        socket.emit("spinStateUpdate", { pending, completed });

        // Progress state
        const progress = await settings_db.get("anniversaryProgress") || 0;
        socket.emit("progressUpdate", progress);

        // Donation state
        const donationTotal = await settings_db.get("donationTotal") || 0;
        const donationProgress = await settings_db.get("donationProgress") || 0;
        const spinThreshold = await settings_db.get("spinThreshold") || 60;
        const nextSpinIn = Math.max(0, spinThreshold - donationProgress);
        socket.emit("donationUpdate", {
          total: donationTotal,
          progress: donationProgress,
          threshold: spinThreshold,
          nextSpinIn,
          progressPercent: Math.min(100, (donationProgress / spinThreshold) * 100)
        });

        console.log(`[Admin] Sent initial state: timer=${remainingSeconds}s, paused=${isPaused}, maxEnd=${maxEndTime ? new Date(maxEndTime).toISOString() : 'none'}, pending=${pending}, completed=${completed}, donations=$${donationTotal} (${donationProgress}/${spinThreshold})`);
      } catch (error) {
        console.error("Failed to send admin state:", error);
      }
    });

    socket.on("admin:addTime", async (seconds) => {
      console.log(`[Admin] addTime: ${seconds}`);
      await handleSubathonAddTime(parseInt(seconds), "admin_manual", io);
    });

    // Test time added animation without actually adding time
    socket.on("admin:testTimeAdded", (data) => {
      console.log(`[Admin] Testing time added animation`);
      io.emit('timeAdded', {
        seconds: data?.seconds || 300,
        source: 'test',
        capped: false,
        multiplier: data?.multiplier || 1
      });
    });

    socket.on("admin:setTimer", async (seconds) => {
      console.log(`[Admin] setTimer: ${seconds}s`);
      const currentTime = Date.now();
      let endTime = currentTime + (seconds * 1000);

      // Check max end time cap
      const maxEndTime = await timer_db.get("max_end_time");
      let wasCapped = false;
      if (maxEndTime && endTime > maxEndTime) {
        endTime = maxEndTime;
        wasCapped = true;
      }

      const actualSeconds = Math.floor((endTime - currentTime) / 1000);

      // Reset timer state
      await timer_db.set("end_time", endTime);
      await timer_db.set("is_paused", false);
      await timer_db.set("remaining_at_pause", null);

      const logEntry = {
        action: "admin_set_time",
        seconds: actualSeconds,
        requestedSeconds: seconds,
        capped: wasCapped,
        newEndTime: new Date(endTime).toISOString(),
        timestamp: new Date().toISOString()
      };
      await timer_db.push("logs", logEntry);

      // Broadcast new state
      io.emit('timerUpdate', actualSeconds);
      io.emit('timerPauseState', false);
      io.to('subathon_timer').emit('subathon_time_set', actualSeconds);

      console.log(`[Admin] Timer set to ${actualSeconds}s, ending at ${new Date(endTime)}${wasCapped ? ' [CAPPED]' : ''}`);
    });

    socket.on("admin:setMaxEndTime", async (data) => {
      // data can be { timestamp: 1234567890 }, { datetime: "2026-01-18T06:00:00" }, or { clear: true }
      if (data?.clear) {
        await timer_db.set("max_end_time", null);
        console.log(`[Admin] Max end time CLEARED`);
        io.emit('maxEndTimeUpdate', { maxEndTime: null });
        return;
      }

      // Accept timestamp (preferred) or datetime string (legacy)
      let maxEndTime;
      if (data?.timestamp && Number.isFinite(data.timestamp)) {
        maxEndTime = data.timestamp;
      } else if (data?.datetime) {
        maxEndTime = new Date(data.datetime).getTime();
      }

      if (!maxEndTime || isNaN(maxEndTime)) {
        console.log(`[Admin] Invalid max end time: ${JSON.stringify(data)}`);
        return;
      }

      // Validate that cap is in the future
      const currentTime = Date.now();
      if (maxEndTime <= currentTime) {
        console.log(`[Admin] Rejected max end time - must be in the future`);
        return;
      }

      await timer_db.set("max_end_time", maxEndTime);
      console.log(`[Admin] Max end time set to ${new Date(maxEndTime).toISOString()}`);
      io.emit('maxEndTimeUpdate', { maxEndTime, datetime: new Date(maxEndTime).toISOString() });

      // Check if current timer exceeds new cap and adjust
      const currentEndTime = await timer_db.get("end_time");
      const isPaused = await timer_db.get("is_paused");

      if (currentEndTime && currentEndTime > maxEndTime) {
        await timer_db.set("end_time", maxEndTime);

        if (isPaused) {
          const newRemaining = Math.max(0, maxEndTime - currentTime);
          await timer_db.set("remaining_at_pause", newRemaining);
        }

        console.log(`[Admin] Current timer was capped to new max end time`);
      }
    });

    socket.on("admin:togglePause", async () => {
      console.log(`[Admin] togglePause`);
      const isPaused = await timer_db.get("is_paused");
      const newState = !isPaused;

      const currentTime = Date.now();
      if (newState) {
        // PAUSING
        const endTime = await timer_db.get("end_time");
        const remaining = Math.max(0, endTime - currentTime);
        await timer_db.set("remaining_at_pause", remaining);
        await timer_db.set("is_paused", true);
        io.to('subathon_timer').emit('timer_paused', remaining);
        io.emit('timerPauseState', true); // Broadcast to anniversary clients
        console.log(`[Admin] Timer PAUSED with ${Math.floor(remaining / 1000)}s remaining`);
      } else {
        // RESUMING
        const remaining = await timer_db.get("remaining_at_pause") || 0;
        const newEndTime = currentTime + remaining;
        await timer_db.set("end_time", newEndTime);
        await timer_db.set("is_paused", false);
        io.to('subathon_timer').emit('timer_resumed', newEndTime);
        io.emit('timerPauseState', false); // Broadcast to anniversary clients
        console.log(`[Admin] Timer RESUMED with ${Math.floor(remaining / 1000)}s remaining`);
      }
    });

    socket.on("admin:adjustSpins", async (delta) => {
      console.log(`[Admin] adjustSpins: ${delta}`);
      let pending = await settings_db.get("pendingSpins") || 0;
      pending += delta;
      if (pending < 0) pending = 0;
      await settings_db.set("pendingSpins", pending);
      // Broadcast update
      const completed = await settings_db.get("completedSpins") || 0;
      io.emit("spinStateUpdate", { pending, completed });
    });

    socket.on("admin:requestWheelSlots", async () => {
      const slots = await wheel_db.get("slots");
      const normalizedSlots = normalizeWheelSlots(slots);
      socket.emit("admin:wheelSlots", { slots: normalizedSlots || [] });
    });

    socket.on("admin:setWheelSlots", async (data) => {
      const normalizedSlots = normalizeWheelSlots(data?.slots);
      if (!normalizedSlots) {
        socket.emit("admin:wheelSlotsError", {
          message: "Invalid slots. Provide an array of {label,color,weight}."
        });
        return;
      }
      await wheel_db.set("slots", normalizedSlots);
      io.emit("updateSlots", normalizedSlots);
      socket.emit("admin:wheelSlots", { slots: normalizedSlots });
    });

    socket.on("admin:toggleWheel", async (data) => {
      const active = !!(data && data.active);
      console.log(`[Admin] toggleWheel: ${active}`);
      await settings_db.set("overlayWheelVisible", active);
      io.emit("overlay:wheelVisibility", { active });
    });

    // === OVERLAY ELEMENT VISIBILITY ===
    const DEFAULT_VISIBILITY = {
      timer: true,
      spins: true,
      leaderboard: true,
      wheel: true,
      nextSpin: true,
      progress: true
    };

    socket.on("admin:toggleElement", async (data) => {
      const { element, visible } = data || {};
      if (!element || typeof visible !== 'boolean') return;

      console.log(`[Admin] toggleElement: ${element} = ${visible}`);

      // Get current visibility state
      let visibility = await settings_db.get("overlayElementVisibility") || { ...DEFAULT_VISIBILITY };
      visibility[element] = visible;

      // Save and broadcast
      await settings_db.set("overlayElementVisibility", visibility);
      io.emit("overlay:elementVisibility", visibility);
    });

    socket.on("admin:requestVisibilityState", async () => {
      const visibility = await settings_db.get("overlayElementVisibility") || { ...DEFAULT_VISIBILITY };
      socket.emit("overlay:elementVisibility", visibility);
    });

    // === SLOT REMOVAL & RESTORATION ===
    // Track pending removal (set when spin completes, cleared on respin or removal)
    // Stored in settings_db so it persists

    // Helper to broadcast removed slots to admin
    const broadcastRemovedSlots = async () => {
      const removedSlots = await wheel_db.get("removedSlots") || [];
      io.emit("admin:removedSlots", { slots: removedSlots });
    };

    // Remove a slot by index (called when respin window closes)
    socket.on("admin:removeSlot", async (data) => {
      const slotIndex = parseInt(data?.index ?? data);
      console.log(`[Admin] removeSlot: index ${slotIndex}`);

      const slots = await wheel_db.get("slots") || [];
      if (slotIndex < 0 || slotIndex >= slots.length) {
        console.log(`[Admin] removeSlot: Invalid index ${slotIndex}`);
        return;
      }

      // Get the slot being removed
      const removedSlot = slots[slotIndex];
      removedSlot.removedAt = new Date().toISOString();
      removedSlot.originalIndex = slotIndex;

      // Remove from active slots
      slots.splice(slotIndex, 1);
      await wheel_db.set("slots", slots);

      // Add to removed slots
      let removedSlots = await wheel_db.get("removedSlots") || [];
      removedSlots.push(removedSlot);
      await wheel_db.set("removedSlots", removedSlots);

      console.log(`[Admin] Slot "${removedSlot.label}" removed. ${slots.length} slots remaining.`);

      // Broadcast updated slots to all clients
      const normalizedSlots = normalizeWheelSlots(slots);
      io.emit("updateSlots", normalizedSlots || []);
      io.emit("admin:wheelSlots", { slots: normalizedSlots || [] });
      await broadcastRemovedSlots();

      // Emit event for overlay to show removal animation
      io.emit("slotRemoved", { slot: removedSlot, remainingCount: slots.length });

      // Clear pending removal
      await settings_db.set("pendingSlotRemoval", null);
    });

    // Restore a slot from removed slots
    socket.on("admin:restoreSlot", async (data) => {
      const slotIndex = parseInt(data?.index ?? data);
      console.log(`[Admin] restoreSlot: removed index ${slotIndex}`);

      let removedSlots = await wheel_db.get("removedSlots") || [];
      if (slotIndex < 0 || slotIndex >= removedSlots.length) {
        console.log(`[Admin] restoreSlot: Invalid index ${slotIndex}`);
        return;
      }

      // Get the slot to restore
      const slotToRestore = removedSlots[slotIndex];
      delete slotToRestore.removedAt;
      delete slotToRestore.originalIndex;

      // Remove from removed slots
      removedSlots.splice(slotIndex, 1);
      await wheel_db.set("removedSlots", removedSlots);

      // Add back to active slots
      let slots = await wheel_db.get("slots") || [];
      // Assign new ID to avoid conflicts
      slotToRestore.id = slots.length > 0 ? Math.max(...slots.map(s => s.id || 0)) + 1 : 1;
      slots.push(slotToRestore);
      await wheel_db.set("slots", slots);

      console.log(`[Admin] Slot "${slotToRestore.label}" restored. ${slots.length} slots now active.`);

      // Broadcast updated slots
      const normalizedSlots = normalizeWheelSlots(slots);
      io.emit("updateSlots", normalizedSlots || []);
      io.emit("admin:wheelSlots", { slots: normalizedSlots || [] });
      await broadcastRemovedSlots();

      // Emit event for overlay
      io.emit("slotRestored", { slot: slotToRestore, totalCount: slots.length });
    });

    // Request removed slots list
    socket.on("admin:requestRemovedSlots", async () => {
      await broadcastRemovedSlots();
    });

    // Clear all removed slots (admin cleanup)
    socket.on("admin:clearRemovedSlots", async () => {
      console.log(`[Admin] Clearing all removed slots`);
      await wheel_db.set("removedSlots", []);
      await broadcastRemovedSlots();
    });

    // Called by overlay when respin window closes without a respin
    socket.on("respinWindowClosed", async (data) => {
      const pendingRemoval = await settings_db.get("pendingSlotRemoval");
      if (!pendingRemoval) {
        console.log(`[Spin] Respin window closed but no pending removal`);
        return;
      }

      console.log(`[Spin] Respin window closed, removing slot: ${pendingRemoval.label} (index ${pendingRemoval.index})`);

      // Trigger the actual removal
      const slots = await wheel_db.get("slots") || [];

      // Find the slot by label+color since index may have shifted
      const currentIndex = slots.findIndex(s =>
        s.label === pendingRemoval.label && s.color === pendingRemoval.color
      );

      if (currentIndex === -1) {
        console.log(`[Spin] Pending slot not found in current slots, may have been manually removed`);
        await settings_db.set("pendingSlotRemoval", null);
        return;
      }

      // Get the slot being removed
      const removedSlot = slots[currentIndex];
      removedSlot.removedAt = new Date().toISOString();
      removedSlot.originalIndex = currentIndex;

      // Remove from active slots
      slots.splice(currentIndex, 1);
      await wheel_db.set("slots", slots);

      // Add to removed slots
      let removedSlots = await wheel_db.get("removedSlots") || [];
      removedSlots.push(removedSlot);
      await wheel_db.set("removedSlots", removedSlots);

      console.log(`[Spin] Slot "${removedSlot.label}" auto-removed after respin window. ${slots.length} slots remaining.`);

      // Broadcast updated slots
      const normalizedSlots = normalizeWheelSlots(slots);
      io.emit("updateSlots", normalizedSlots || []);
      io.emit("admin:wheelSlots", { slots: normalizedSlots || [] });
      await broadcastRemovedSlots();

      io.emit("slotRemoved", { slot: removedSlot, remainingCount: slots.length, automatic: true });

      // Clear pending removal
      await settings_db.set("pendingSlotRemoval", null);
    });

    socket.on("admin:triggerSpin", async () => {
      console.log(`[Admin] triggerSpin`);
      let pending = await settings_db.get("pendingSpins") || 0;
      if (pending > 0) {
        pending--;
        await settings_db.set("pendingSpins", pending);

        let completed = await settings_db.get("completedSpins") || 0;
        completed++;
        await settings_db.set("completedSpins", completed);

        // Get wheel slots and pick a winner using weighted random
        const slots = await wheel_db.get("slots");
        const normalizedSlots = normalizeWheelSlots(slots);

        if (normalizedSlots && normalizedSlots.length > 0) {
          // Calculate total weight
          const totalWeight = normalizedSlots.reduce((sum, slot) => sum + slot.weight, 0);

          // Pick random value based on weight
          let randomValue = Math.random() * totalWeight;
          let winnerIndex = 0;
          let cumulative = 0;

          for (let i = 0; i < normalizedSlots.length; i++) {
            cumulative += normalizedSlots[i].weight;
            if (randomValue <= cumulative) {
              winnerIndex = i;
              break;
            }
          }

          const winner = normalizedSlots[winnerIndex];

          // Calculate the angle where this slot is located
          // We need to figure out where the slot starts and ends
          let slotStartAngle = 0;
          for (let i = 0; i < winnerIndex; i++) {
            slotStartAngle += (normalizedSlots[i].weight / totalWeight) * 360;
          }
          const slotAngle = (winner.weight / totalWeight) * 360;
          // Land somewhere in the middle of the slot (30-70%)
          const landingOffset = 0.3 + Math.random() * 0.4;
          const landingAngle = slotStartAngle + (slotAngle * landingOffset);

          // The pointer is at the right (0 degrees), so we need to calculate
          // how much the wheel needs to rotate to land on this slot
          // Add multiple full rotations for effect (5-8 rotations)
          const fullRotations = 5 + Math.floor(Math.random() * 4);
          const targetRotation = (fullRotations * 360) + (360 - landingAngle);

          // Spin duration in ms (5-7 seconds)
          const spinDuration = 5000 + Math.random() * 2000;

          // Respin settings
          const respinDuration = 120; // 2 minutes for respin
          const respinCost = 10; // $10 to respin

          console.log(`[Spin] Winner: ${winner.label} (index ${winnerIndex}), rotation: ${targetRotation}deg`);

          io.emit("spinTriggered", {
            targetRotation,
            spinDuration,
            winner: {
              index: winnerIndex,
              label: winner.label,
              color: winner.color
            },
            landingOffset, // Send to client so it uses the same position
            respinDuration,
            respinCost
          });

          // Track pending slot removal (will be removed when respin window closes)
          await settings_db.set("pendingSlotRemoval", {
            index: winnerIndex,
            label: winner.label,
            color: winner.color,
            weight: winner.weight,
            spinTimestamp: new Date().toISOString()
          });

          // Record spin in history
          const spinEntry = {
            timestamp: new Date().toISOString(),
            winner: winner.label,
            winnerIndex,
            slots: normalizedSlots.map(s => s.label)
          };
          await wheel_db.push("spinHistory", spinEntry);
        } else {
          console.log(`[Admin] triggerSpin: No valid slots configured`);
          io.emit("spinTriggered", { error: "No wheel slots configured" });
        }

        io.emit("spinStateUpdate", { pending, completed });
      } else {
        console.log(`[Admin] triggerSpin ignored: No pending spins`);
      }
    });

    // RIGGED SPIN - looks normal but lands on a chosen slot
    socket.on("admin:triggerFakeSpin", async (data) => {
      const targetSlotIndex = data?.targetSlotIndex;
      console.log(`[Admin] triggerFakeSpin -> target index: ${targetSlotIndex}`);

      if (targetSlotIndex === undefined || targetSlotIndex === null) {
        console.log(`[Admin] triggerFakeSpin: No target slot specified`);
        return;
      }

      let pending = await settings_db.get("pendingSpins") || 0;
      if (pending > 0) {
        pending--;
        await settings_db.set("pendingSpins", pending);

        let completed = await settings_db.get("completedSpins") || 0;
        completed++;
        await settings_db.set("completedSpins", completed);

        // Get wheel slots
        const slots = await wheel_db.get("slots");
        const normalizedSlots = normalizeWheelSlots(slots);

        if (normalizedSlots && normalizedSlots.length > 0) {
          // Validate target index
          const winnerIndex = Math.max(0, Math.min(targetSlotIndex, normalizedSlots.length - 1));
          const winner = normalizedSlots[winnerIndex];

          // Calculate total weight for angle calculations
          const totalWeight = normalizedSlots.reduce((sum, slot) => sum + slot.weight, 0);

          // Calculate the angle where this slot is located
          let slotStartAngle = 0;
          for (let i = 0; i < winnerIndex; i++) {
            slotStartAngle += (normalizedSlots[i].weight / totalWeight) * 360;
          }
          const slotAngle = (winner.weight / totalWeight) * 360;
          // Land somewhere in the middle of the slot (30-70%)
          const landingOffset = 0.3 + Math.random() * 0.4;
          const landingAngle = slotStartAngle + (slotAngle * landingOffset);

          // Add multiple full rotations for effect (5-8 rotations)
          const fullRotations = 5 + Math.floor(Math.random() * 4);
          const targetRotation = (fullRotations * 360) + (360 - landingAngle);

          // Spin duration in ms (5-7 seconds)
          const spinDuration = 5000 + Math.random() * 2000;

          // Respin settings
          const respinDuration = 120;
          const respinCost = 10;

          console.log(`[Spin RIGGED] Winner: ${winner.label} (index ${winnerIndex}), rotation: ${targetRotation}deg`);

          io.emit("spinTriggered", {
            targetRotation,
            spinDuration,
            winner: {
              index: winnerIndex,
              label: winner.label,
              color: winner.color
            },
            landingOffset, // Send to client so it uses the same position
            respinDuration,
            respinCost
          });

          // Track pending slot removal (will be removed when respin window closes)
          await settings_db.set("pendingSlotRemoval", {
            index: winnerIndex,
            label: winner.label,
            color: winner.color,
            weight: winner.weight,
            spinTimestamp: new Date().toISOString()
          });

          // Record spin in history (mark as rigged for admin reference)
          const spinEntry = {
            timestamp: new Date().toISOString(),
            winner: winner.label,
            winnerIndex,
            slots: normalizedSlots.map(s => s.label),
            rigged: true
          };
          await wheel_db.push("spinHistory", spinEntry);
        } else {
          console.log(`[Admin] triggerFakeSpin: No valid slots configured`);
          io.emit("spinTriggered", { error: "No wheel slots configured" });
        }

        io.emit("spinStateUpdate", { pending, completed });
      } else {
        console.log(`[Admin] triggerFakeSpin ignored: No pending spins`);
      }
    });

    socket.on("admin:triggerEffect", (effectName) => {
      console.log(`[Admin] triggerEffect: ${effectName}`);
      io.emit("microEffect", { type: effectName, text: effectName.toUpperCase() });
    });

    socket.on("admin:openRespin", () => {
      console.log(`[Admin] openRespin`);
      io.emit("respinWindow", { active: true, duration: 60 });
    });

    socket.on("admin:setProgress", async (amount) => {
      console.log(`[Admin] setProgress: ${amount}`);
      // Just treating standard progress tracker as our source of truth for now
      // Assuming 'subsTracker' or similar is used, but for now we might use a dedicated 'anniversaryProgress'
      await settings_db.set("anniversaryProgress", amount);
      io.emit("progressUpdate", amount);
    });

    // === DONATION TRACKING SYSTEM ===
    // Tracks donations toward the next wheel spin ($60 milestone)

    const SPIN_THRESHOLD = 60; // $60 triggers a spin

    // Helper to broadcast donation state
    const broadcastDonationState = async () => {
      const donationTotal = await settings_db.get("donationTotal") || 0;
      const donationProgress = await settings_db.get("donationProgress") || 0;
      const spinThreshold = await settings_db.get("spinThreshold") || SPIN_THRESHOLD;
      const nextSpinIn = Math.max(0, spinThreshold - donationProgress);

      io.emit("donationUpdate", {
        total: donationTotal,
        progress: donationProgress,
        threshold: spinThreshold,
        nextSpinIn,
        progressPercent: Math.min(100, (donationProgress / spinThreshold) * 100)
      });
    };

    // Add a donation (simulates incoming donation)
    socket.on("admin:addDonation", async (data) => {
      const amount = parseFloat(data?.amount || data) || 0;
      const donorName = data?.name || "Anonymous";

      if (amount <= 0) {
        console.log(`[Admin] addDonation: Invalid amount ${amount}`);
        return;
      }

      console.log(`[Admin] addDonation: $${amount} from ${donorName}`);

      // Update totals
      let donationTotal = await settings_db.get("donationTotal") || 0;
      let donationProgress = await settings_db.get("donationProgress") || 0;
      const spinThreshold = await settings_db.get("spinThreshold") || SPIN_THRESHOLD;

      donationTotal += amount;
      donationProgress += amount;

      await settings_db.set("donationTotal", donationTotal);

      // Check for spin threshold
      let spinsEarned = 0;
      while (donationProgress >= spinThreshold) {
        donationProgress -= spinThreshold;
        spinsEarned++;
      }

      await settings_db.set("donationProgress", donationProgress);

      // Add spins if earned
      if (spinsEarned > 0) {
        let pending = await settings_db.get("pendingSpins") || 0;
        pending += spinsEarned;
        await settings_db.set("pendingSpins", pending);
        const completed = await settings_db.get("completedSpins") || 0;
        io.emit("spinStateUpdate", { pending, completed });
        console.log(`[Donation] $${amount} donation added ${spinsEarned} spin(s)! New pending: ${pending}`);

        // Emit spin earned event for overlay effects
        io.emit("spinEarned", { spinsEarned, donorName, amount });
      }

      // Broadcast updated donation state
      await broadcastDonationState();

      // Add time to subathon timer ($1 = 60 seconds)
      const secondsToAdd = Math.floor(amount * 60);
      if (secondsToAdd > 0) {
        await handleSubathonAddTime(secondsToAdd, `donation_${donorName}`, io);
      }

      console.log(`[Donation] Total: $${donationTotal}, Progress: $${donationProgress}/${spinThreshold}, +${secondsToAdd}s timer`);
    });

    // Set donation total directly
    socket.on("admin:setDonationTotal", async (amount) => {
      const total = parseFloat(amount) || 0;
      console.log(`[Admin] setDonationTotal: $${total}`);
      await settings_db.set("donationTotal", total);
      await broadcastDonationState();
    });

    // Set donation progress directly (toward next spin)
    socket.on("admin:setDonationProgress", async (amount) => {
      const progress = parseFloat(amount) || 0;
      console.log(`[Admin] setDonationProgress: $${progress}`);
      await settings_db.set("donationProgress", progress);
      await broadcastDonationState();
    });

    // Reset donation progress (keep total, reset progress toward next spin)
    socket.on("admin:resetDonationProgress", async () => {
      console.log(`[Admin] resetDonationProgress`);
      await settings_db.set("donationProgress", 0);
      await broadcastDonationState();
    });

    // Set spin threshold (default $60)
    socket.on("admin:setSpinThreshold", async (amount) => {
      const threshold = parseFloat(amount) || SPIN_THRESHOLD;
      console.log(`[Admin] setSpinThreshold: $${threshold}`);
      await settings_db.set("spinThreshold", threshold);
      await broadcastDonationState();
    });

    // Request current donation state
    socket.on("admin:requestDonationState", async () => {
      await broadcastDonationState();
    });

    // === EXTERNAL DONATION INTEGRATION ===
    // Bridges sub_tracker events with the anniversary donation system
    // Conversion rates (matching sub_tracker.ejs)
    const SUB_VALUE = 5;      // $5 per sub
    const BITS_VALUE = 0.01;  // $0.01 per bit
    const SECONDS_PER_DOLLAR = 60; // 60 seconds ($1/min subathon)

    // Centralized donation processor - handles all donation types
    const processExternalDonation = async (dollarAmount, source, sourceDetails = {}) => {
      if (dollarAmount <= 0) return;

      const donorName = sourceDetails.username || sourceDetails.name || "Anonymous";

      console.log(`[External] Processing $${dollarAmount.toFixed(2)} from ${source} (${donorName})`);

      // Update donation totals
      let donationTotal = await settings_db.get("donationTotal") || 0;
      let donationProgress = await settings_db.get("donationProgress") || 0;
      const spinThreshold = await settings_db.get("spinThreshold") || SPIN_THRESHOLD;

      donationTotal += dollarAmount;
      donationProgress += dollarAmount;

      await settings_db.set("donationTotal", donationTotal);

      // Check for spin threshold
      let spinsEarned = 0;
      while (donationProgress >= spinThreshold) {
        donationProgress -= spinThreshold;
        spinsEarned++;
      }

      await settings_db.set("donationProgress", donationProgress);

      // Add spins if earned
      if (spinsEarned > 0) {
        let pending = await settings_db.get("pendingSpins") || 0;
        pending += spinsEarned;
        await settings_db.set("pendingSpins", pending);
        const completed = await settings_db.get("completedSpins") || 0;
        io.emit("spinStateUpdate", { pending, completed });
        console.log(`[External] ${source} added ${spinsEarned} spin(s)! New pending: ${pending}`);

        // Emit spin earned event for overlay effects
        io.emit("spinEarned", { spinsEarned, donorName, amount: dollarAmount, source });
      }

      // Broadcast updated donation state
      await broadcastDonationState();

      // Add time to subathon timer
      const secondsToAdd = Math.floor(dollarAmount * SECONDS_PER_DOLLAR);
      if (secondsToAdd > 0) {
        await handleSubathonAddTime(secondsToAdd, source, io);
      }

      console.log(`[External] Total: $${donationTotal.toFixed(2)}, Progress: $${donationProgress.toFixed(2)}/${spinThreshold}, +${secondsToAdd}s timer`);

      return { dollarAmount, spinsEarned, secondsToAdd };
    };

    // Handler for incoming subs (from StreamElements, Twitch webhooks, etc.)
    socket.on("external:sub", async (data, callback) => {
      const subCount = parseInt(data?.count || data?.subs || 1) || 1;
      const tier = data?.tier || 1; // Tier 1 = 1x, Tier 2 = 2x, Tier 3 = 5x
      const tierMultiplier = tier === 3 ? 5 : tier === 2 ? 2 : 1;
      const dollarAmount = subCount * SUB_VALUE * tierMultiplier;

      console.log(`[External] Sub received: ${subCount}x Tier ${tier} = $${dollarAmount}`);

      const result = await processExternalDonation(dollarAmount, "sub", {
        username: data?.username || data?.gifter || data?.name,
        subCount,
        tier
      });

      // Also emit legacy sub_tracker event for backwards compatibility
      const currentSubs = await settings_db.get("subTracker_subs") || 0;
      const newSubs = currentSubs + subCount;
      await settings_db.set("subTracker_subs", newSubs);

      const currentBits = await settings_db.get("subTracker_bits") || 0;
      const currentDonations = await settings_db.get("subTracker_donations") || 0;
      const completedSpins = await settings_db.get("completedSpins") || 0;

      io.emit("updateSubTracker", {
        current_subs: newSubs,
        current_bits: currentBits,
        current_donations: currentDonations,
        subsToAdd: subCount,
        completed_spins: completedSpins
      });

      // Play threshold sound if spin was earned
      if (result?.spinsEarned > 0) {
        io.emit("subTrackerThreshold", result.spinsEarned);
      }

      if (typeof callback === 'function') {
        callback({ ok: true, ...result });
      }
    });

    // Handler for incoming bits
    socket.on("external:bits", async (data, callback) => {
      const bitCount = parseInt(data?.bits || data?.count || data?.amount) || 0;
      if (bitCount <= 0) {
        if (typeof callback === 'function') callback({ ok: false, error: "Invalid bit count" });
        return;
      }

      const dollarAmount = bitCount * BITS_VALUE;

      console.log(`[External] Bits received: ${bitCount} bits = $${dollarAmount.toFixed(2)}`);

      const result = await processExternalDonation(dollarAmount, "bits", {
        username: data?.username || data?.name,
        bitCount
      });

      // Also emit legacy sub_tracker event for backwards compatibility
      const currentBits = await settings_db.get("subTracker_bits") || 0;
      const newBits = currentBits + bitCount;
      await settings_db.set("subTracker_bits", newBits);

      const currentSubs = await settings_db.get("subTracker_subs") || 0;
      const currentDonations = await settings_db.get("subTracker_donations") || 0;
      const completedSpins = await settings_db.get("completedSpins") || 0;

      io.emit("updateBitsTracker", {
        current_subs: currentSubs,
        current_bits: newBits,
        current_donations: currentDonations,
        bitsToAdd: bitCount,
        completed_spins: completedSpins
      });

      // Check for 50-bit VOD redemption
      if (bitCount === 50) {
        const vodsEnabled = await timer_db.get("vods_enabled") || false;
        if (vodsEnabled) {
          const vodUrl = 'https://streamgood.gg/clips/player?mode=random&current_game=false&info=true&volume=50&max_length=60&filter_long_videos=false&show_timer=true&recent_clips=0&channel=abbabox';
          io.emit('play_random_vod', { url: vodUrl });
        }
      }

      if (result?.spinsEarned > 0) {
        io.emit("subTrackerThreshold", result.spinsEarned);
      }

      if (typeof callback === 'function') {
        callback({ ok: true, ...result });
      }
    });

    // Handler for incoming direct donations (StreamElements, Streamlabs, etc.)
    socket.on("external:donation", async (data, callback) => {
      const dollarAmount = parseFloat(data?.amount || data?.donation || 0) || 0;
      if (dollarAmount <= 0) {
        if (typeof callback === 'function') callback({ ok: false, error: "Invalid donation amount" });
        return;
      }

      console.log(`[External] Donation received: $${dollarAmount.toFixed(2)}`);

      const result = await processExternalDonation(dollarAmount, "donation", {
        username: data?.username || data?.name,
        message: data?.message
      });

      // Also emit legacy sub_tracker event for backwards compatibility
      const currentDonations = await settings_db.get("subTracker_donations") || 0;
      const newDonations = currentDonations + dollarAmount;
      await settings_db.set("subTracker_donations", newDonations);

      const currentSubs = await settings_db.get("subTracker_subs") || 0;
      const currentBits = await settings_db.get("subTracker_bits") || 0;
      const completedSpins = await settings_db.get("completedSpins") || 0;

      io.emit("updateDonationsTracker", {
        current_subs: currentSubs,
        current_bits: currentBits,
        current_donations: newDonations,
        donationToAdd: dollarAmount,
        completed_spins: completedSpins
      });

      if (result?.spinsEarned > 0) {
        io.emit("subTrackerThreshold", result.spinsEarned);
      }

      if (typeof callback === 'function') {
        callback({ ok: true, ...result });
      }
    });

    // Sync/initialize sub_tracker totals on request
    socket.on("external:requestState", async () => {
      const currentSubs = await settings_db.get("subTracker_subs") || 0;
      const currentBits = await settings_db.get("subTracker_bits") || 0;
      const currentDonations = await settings_db.get("subTracker_donations") || 0;
      const completedSpins = await settings_db.get("completedSpins") || 0;

      socket.emit("updateSubTracker", {
        current_subs: currentSubs,
        current_bits: currentBits,
        current_donations: currentDonations,
        subsToAdd: 0,
        completed_spins: completedSpins
      });

      await broadcastDonationState();
    });

    // Reset sub_tracker totals (admin function)
    socket.on("admin:resetSubTrackerTotals", async (callback) => {
      console.log(`[Admin] Resetting sub_tracker totals`);
      await settings_db.set("subTracker_subs", 0);
      await settings_db.set("subTracker_bits", 0);
      await settings_db.set("subTracker_donations", 0);

      io.emit("updateSubTracker", {
        current_subs: 0,
        current_bits: 0,
        current_donations: 0,
        subsToAdd: 0,
        completed_spins: await settings_db.get("completedSpins") || 0
      });

      if (typeof callback === 'function') {
        callback({ ok: true });
      }
    });

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
      const spotId = String(splotData.id);
      const currentState = splotStates[spotId] || { isAlt: false };
      currentState.isAlt = !currentState.isAlt;
      splotStates[spotId] = currentState;

      const isSpotSix = spotId === '6';

      if (currentState.isAlt) {
        if (isSpotSix) {
          heavenfireSpotIds.add(spotId);
          hellfireSpotIds.delete(spotId);
        } else {
          heavenfireSpotIds.delete(spotId);
          hellfireSpotIds.add(spotId);
        }
      } else {
        heavenfireSpotIds.delete(spotId);
        if (isSpotSix) {
          hellfireSpotIds.add(spotId);
        } else {
          hellfireSpotIds.delete(spotId);
        }
      }

      const payload = {
        ...splotData,
        isAlt: currentState.isAlt,
        hellfireSpotIds: Array.from(hellfireSpotIds),
        heavenFireSpotIds: Array.from(heavenfireSpotIds)
      };

      io.emit("alt_splot_swap", payload);
      if (typeof callback === 'function') {
        callback(payload);
      }
    });

    socket.on("clear_board", async (arg, callback) => {
      await board_db.set("board", []);
      console.log(arg);
      callback("board_cleared");
      io.emit("clear_board", []);
    });

    socket.on('join_torment_meter', async () => {
      socket.join('torment_meter');
      try {
        const state = await getTormentMeterState();
        socket.emit('torment_meter_update', state);
      } catch (error) {
        console.error('Failed to load torment meter state:', error);
        socket.emit('torment_meter_error', { message: 'Unable to load torment meter state.' });
      }
    });

    socket.on('torment_meter_manual_add', async (payload = {}, callback) => {
      try {
        const amount = Number(payload.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('Amount must be greater than zero.');
        }
        const cents = dollarsToCentsSafe(amount);
        const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
        await recordTormentContribution({
          amountCents: cents,
          source: payload.source || 'manual',
          sourceDetails: payload.sourceDetails,
          note: payload.note || null,
          metadata: { ...metadata, origin: 'admin_manual' }
        });
        if (typeof callback === 'function') {
          callback({ ok: true });
        }
      } catch (error) {
        console.error('Torment meter manual add failed:', error);
        if (typeof callback === 'function') {
          callback({ ok: false, error: error.message });
        }
      }
    });

    socket.on('torment_meter_reset', async (callback) => {
      try {
        const state = await resetTormentMeter();
        if (typeof callback === 'function') {
          callback({ ok: true, state });
        }
      } catch (error) {
        console.error('Torment meter reset failed:', error);
        if (typeof callback === 'function') {
          callback({ ok: false, error: error.message });
        }
      }
    });

    socket.on('torment_meter_set_base_goal', async (payload, callback) => {
      try {
        const amount = Number(typeof payload === 'object' ? payload?.amount : payload);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('Base goal must be greater than zero.');
        }
        const state = await setTormentBaseGoal(amount);
        if (typeof callback === 'function') {
          callback({ ok: true, state });
        }
      } catch (error) {
        console.error('Failed to set torment meter base goal:', error);
        if (typeof callback === 'function') {
          callback({ ok: false, error: error.message });
        }
      }
    });

    socket.on('torment_meter_set_min_goal', async (payload, callback) => {
      try {
        const amount = Number(typeof payload === 'object' ? payload?.amount : payload);
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error('Minimum goal must be zero or greater.');
        }
        const state = await setTormentMinGoal(amount);
        if (typeof callback === 'function') {
          callback({ ok: true, state });
        }
      } catch (error) {
        console.error('Failed to set torment meter minimum goal:', error);
        if (typeof callback === 'function') {
          callback({ ok: false, error: error.message });
        }
      }
    });

    socket.on('torment_meter_set_audio', async (payload, callback) => {
      try {
        const url = typeof payload === 'object' ? payload?.url : payload;
        if (!url || typeof url !== 'string' || url.trim().length === 0) {
          throw new Error('Audio URL must be provided.');
        }
        const state = await setTormentAudioUrl(url);
        if (typeof callback === 'function') {
          callback({ ok: true, state });
        }
      } catch (error) {
        console.error('Failed to set torment meter audio URL:', error);
        if (typeof callback === 'function') {
          callback({ ok: false, error: error.message });
        }
      }
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
