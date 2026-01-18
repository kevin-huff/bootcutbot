(() => {
  let socket;
  let audioContext = null;

  // Initialize Web Audio API for wheel sounds
  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  // Play an annoying tick/click sound
  function playTickSound(volume = 0.3, pitch = 800) {
    try {
      const ctx = getAudioContext();
      if (ctx.state !== 'running') return; // Skip if audio not ready

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = pitch + Math.random() * 200;
      oscillator.type = 'square';

      gainNode.gain.setValueAtTime(volume, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.05);
    } catch (e) {
      console.warn('Audio tick failed:', e);
    }
  }

  // Play a winning fanfare sound
  function playWinSound() {
    try {
      const ctx = getAudioContext();
      if (ctx.state !== 'running') return; // Skip if audio not ready

      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.value = freq;
        osc.type = 'triangle';

        const startTime = ctx.currentTime + i * 0.15;
        gain.gain.setValueAtTime(0.4, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);

        osc.start(startTime);
        osc.stop(startTime + 0.3);
      });
    } catch (e) {
      console.warn('Win sound failed:', e);
    }
  }

  // Play a "time added" power-up sound
  function playTimeAddedSound(seconds) {
    try {
      const ctx = getAudioContext();
      if (ctx.state !== 'running') return;

      // Ascending arpeggio - more notes for more time
      const baseNotes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
      const noteCount = Math.min(4, Math.max(2, Math.ceil(seconds / 300))); // 2-4 notes based on time

      for (let i = 0; i < noteCount; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.value = baseNotes[i];
        osc.type = 'sine';

        const startTime = ctx.currentTime + i * 0.08;
        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);

        osc.start(startTime);
        osc.stop(startTime + 0.2);
      }

      // Add a shimmer/sparkle effect
      setTimeout(() => {
        const shimmer = ctx.createOscillator();
        const shimmerGain = ctx.createGain();
        shimmer.connect(shimmerGain);
        shimmerGain.connect(ctx.destination);

        shimmer.frequency.value = 1200 + Math.random() * 400;
        shimmer.type = 'sine';

        shimmerGain.gain.setValueAtTime(0.15, ctx.currentTime);
        shimmerGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

        shimmer.start(ctx.currentTime);
        shimmer.stop(ctx.currentTime + 0.15);
      }, noteCount * 80);
    } catch (e) {
      console.warn('Time added sound failed:', e);
    }
  }

  // Format seconds to readable time string
  function formatTimeAdded(seconds) {
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return m > 0 ? `+${h}h ${m}m` : `+${h}h`;
    } else if (seconds >= 60) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return s > 0 ? `+${m}m ${s}s` : `+${m}m`;
    }
    return `+${seconds}s`;
  }

  // Show time added animation
  function showTimeAddedAnimation(data) {
    const timerEl = document.getElementById('subathonTimer');
    if (!timerEl) return;

    // Create the floating text element
    const floater = document.createElement('div');
    floater.className = 'time-added-floater';
    floater.textContent = formatTimeAdded(data.seconds);

    // Add multiplier badge if applicable
    if (data.multiplier > 1) {
      const badge = document.createElement('span');
      badge.className = 'multiplier-badge';
      badge.textContent = `${data.multiplier}x`;
      floater.appendChild(badge);
    }

    // Position near the timer
    const timerParent = timerEl.closest('.overlay-hud--left') || timerEl.parentElement;
    if (timerParent) {
      timerParent.style.position = 'relative';
      timerParent.appendChild(floater);
    }

    // Pulse the timer
    timerEl.classList.add('time-added-pulse');

    // Play sound
    playTimeAddedSound(data.seconds);

    // Clean up after animation
    setTimeout(() => {
      floater.remove();
      timerEl.classList.remove('time-added-pulse');
    }, 2000);
  }

  // Play "spin earned" celebration sound
  function playSpinEarnedSound() {
    try {
      const ctx = getAudioContext();
      if (ctx.state !== 'running') return;

      // Fanfare-style ascending notes
      const notes = [392.00, 493.88, 587.33, 783.99]; // G4, B4, D5, G5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.value = freq;
        osc.type = 'triangle';

        const startTime = ctx.currentTime + i * 0.1;
        gain.gain.setValueAtTime(0.35, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.25);

        osc.start(startTime);
        osc.stop(startTime + 0.25);
      });

      // Final chord
      setTimeout(() => {
        const chord = [392.00, 493.88, 587.33];
        chord.forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.frequency.value = freq;
          osc.type = 'sine';

          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        });
      }, 400);
    } catch (e) {
      console.warn('Spin earned sound failed:', e);
    }
  }

  // Show "spin earned" animation
  function showSpinEarnedAnimation(data) {
    // Flash the wheel section
    const wheelSection = document.querySelector('.overlay-hud--right');
    if (wheelSection) {
      wheelSection.classList.add('spin-earned-pulse');
      setTimeout(() => wheelSection.classList.remove('spin-earned-pulse'), 1500);
    }

    // Create floating "SPIN EARNED!" text
    const floater = document.createElement('div');
    floater.className = 'spin-earned-floater';
    floater.innerHTML = `
      <div class="spin-earned-text">SPIN EARNED!</div>
      ${data.donorName ? `<div class="spin-earned-donor">${data.donorName}</div>` : ''}
    `;

    document.body.appendChild(floater);

    // Remove after animation
    setTimeout(() => floater.remove(), 3000);
  }

  // Unlock audio on any user interaction (for browser autoplay policy)
  function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        console.log('Audio context unlocked');
      });
    }
    // Remove listeners after first interaction
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  }

  // Set up audio unlock listeners
  document.addEventListener('click', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  document.addEventListener('touchstart', unlockAudio);

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof io === 'undefined') {
      console.error('BootcutBot: Socket.IO client not loaded. Real-time updates disabled.');
      return;
    }

    socket = io(); // Connect via Socket.IO
    socket.onAny((event, ...args) => {
      console.log('[Overlay socket]', event, ...args);
    });

    // Socket Listeners for Real-Time Updates

    // Timer Updates
    socket.on('timerUpdate', (seconds) => {
      const timerEl = document.getElementById('subathonTimer');
      if (timerEl) {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        timerEl.textContent = `${h}:${m}:${s}`;
      }
    });

    socket.on('timerPauseState', (isPaused) => {
      const timerEl = document.getElementById('subathonTimer');
      if (timerEl) {
        timerEl.classList.toggle('paused', isPaused);
      }
    });

    // Time Added Animation
    socket.on('timeAdded', (data) => {
      console.log('[Overlay] Time added:', data);
      showTimeAddedAnimation(data);
    });

    // Legacy timer events (keep for compatibility)
    socket.on('timer_paused', (remaining) => console.log('Timer Paused', remaining));
    socket.on('timer_resumed', (endTime) => console.log('Timer Resumed', endTime));

    socket.on('spinStateUpdate', (data) => {
      const p1 = document.getElementById('pendingSpins');
      const p2 = document.getElementById('completedSpins');
      if (p1) p1.textContent = data.pending;
      if (p2) p2.textContent = data.completed;
    });

    socket.on('progressUpdate', (amount) => {
      const el = document.getElementById('progressCurrent');
      if (el) el.textContent = amount;
      // Calculate percentage if goal is known, for now just width
      const goal = 1000; // Hardcoded or fetched
      const pct = Math.min(100, (amount / goal) * 100);
      const fill = document.getElementById('anniversaryProgressFill');
      if (fill) fill.style.width = `${pct}%`;
    });

    // === DONATION TRACKING ===
    // Conversion rates
    const SUB_VALUE = 5;      // $5 per sub
    const BITS_PER_DOLLAR = 100; // 100 bits = $1

    // Update progress bar and "Next Spin In" display based on donation state
    socket.on('donationUpdate', (data) => {
      console.log('[Overlay] Donation update:', data);

      const nextSpinIn = data.nextSpinIn;

      // Calculate equivalents
      const subsNeeded = Math.ceil(nextSpinIn / SUB_VALUE);
      const bitsNeeded = Math.ceil(nextSpinIn * BITS_PER_DOLLAR);
      const dollarsNeeded = nextSpinIn.toFixed(0);

      // Update "Next Spin In" display elements
      const nextSpinSubs = document.getElementById('nextSpinSubs');
      const nextSpinBits = document.getElementById('nextSpinBits');
      const nextSpinDollars = document.getElementById('nextSpinDollars');

      if (nextSpinSubs) nextSpinSubs.textContent = subsNeeded;
      if (nextSpinBits) nextSpinBits.textContent = bitsNeeded.toLocaleString();
      if (nextSpinDollars) nextSpinDollars.textContent = `$${dollarsNeeded}`;

      // Update progress bar (using donation progress instead of generic progress)
      const progressCurrent = document.getElementById('progressCurrent');
      const progressGoal = document.getElementById('progressGoal');
      const progressFill = document.getElementById('anniversaryProgressFill');

      if (progressCurrent) progressCurrent.textContent = data.progress.toFixed(0);
      if (progressGoal) progressGoal.textContent = data.threshold;
      if (progressFill) {
        progressFill.style.width = `${data.progressPercent}%`;
        // Change color as it fills
        if (data.progressPercent >= 80) {
          progressFill.style.backgroundColor = 'var(--comic-accent)';
        } else {
          progressFill.style.backgroundColor = 'var(--comic-accent-2)';
        }
      }
    });

    // Spin earned effect
    socket.on('spinEarned', (data) => {
      console.log('[Overlay] Spin earned!', data);
      playSpinEarnedSound();
      showSpinEarnedAnimation(data);
    });

    socket.on('microEffect', (data) => {
      const layer = document.getElementById('microEffectsLayer');
      if (layer) {
        const el = document.createElement('div');
        el.className = 'comic-chip'; // reuse existing class
        el.style.animation = 'bounceIn 0.5s';
        el.innerText = data.text || 'POW!';
        layer.appendChild(el);
        setTimeout(() => el.remove(), 3000);
      }
    });

    socket.on('respinWindow', (data) => {
      const respinWin = document.getElementById('respinWindow');
      if (respinWin) {
        respinWin.style.display = 'block'; // Ensure visible
        // logic to countdown could go here
      }
    });

    // === ELEMENT VISIBILITY ===
    const ELEMENT_SELECTORS = {
      timer: '.overlay-hud--left',
      spins: '.overlay-hud--right',
      leaderboard: '.overlay-leaderboard',
      wheel: '.overlay-wheel',
      nextSpin: '.overlay-effects',
      progress: '.overlay-progress'
    };

    function applyElementVisibility(visibility) {
      if (!visibility || typeof visibility !== 'object') return;

      Object.entries(visibility).forEach(([element, visible]) => {
        const selector = ELEMENT_SELECTORS[element];
        if (!selector) return;

        const el = document.querySelector(selector);
        if (el) {
          el.style.display = visible ? '' : 'none';
        }
      });
    }

    socket.on('overlay:elementVisibility', (visibility) => {
      console.log('[Overlay] Element visibility update:', visibility);
      applyElementVisibility(visibility);
    });

    // Request initial visibility state on connect
    socket.emit('admin:requestVisibilityState');

    runOverlayLogic();
  });

  function runOverlayLogic() {
    const params = new URLSearchParams(window.location.search);
    const mode = window.__ANNIVERSARY_MODE__ || document.body.dataset.mode || 'overlay';
    const isTestMode = params.has('test');

    document.body.dataset.mode = mode;

    // Mock Data Generators
    const mockLeaderboard = [
      { name: "BigSpender99", amount: 500 },
      { name: "CasualFan", amount: 120 },
      { name: "LurkerNoMore", amount: 50 },
      { name: "Newbie", amount: 10 },
      { name: "AnotherOne", amount: 5 }
    ];

    const mockRecent = [
      { name: "BigSpender99", amount: 100, type: "donation" },
      { name: "CasualFan", amount: 20, type: "bits" },
      { name: "LurkerNoMore", amount: 5, type: "sub" }
    ];

    if (isTestMode) {
      console.log("Starting Anniversary Overlay in TEST MODE");

      // Timer Mock
      const tTimer = document.getElementById('subathonTimer');
      if (tTimer) tTimer.textContent = "12:34:56";
      // Removed subathonStatus

      // Spin Mock
      const tPending = document.getElementById('pendingSpins');
      if (tPending) tPending.textContent = "5";
      const tComp = document.getElementById('completedSpins');
      if (tComp) tComp.textContent = "12";

      // Progress Mock
      const tProg = document.getElementById('progressCurrent');
      if (tProg) tProg.textContent = "450";
      const tGoal = document.getElementById('progressGoal');
      if (tGoal) tGoal.textContent = "1,000";
      const fill = document.getElementById('anniversaryProgressFill');
      if (fill) fill.style.width = "45%";

      // Leaderboard Mock
      const leaderboardList = document.getElementById('leaderboardList');
      if (leaderboardList) {
        leaderboardList.innerHTML = mockLeaderboard
          .map((p, i) => `
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-family: var(--comic-font-body); padding: 4px; background: rgba(255,255,255,0.05);">
               <span>${i + 1}. ${p.name}</span>
               <span style="color:var(--comic-accent-2); font-weight:bold;">$${p.amount}</span>
            </div>
          `)
          .join('');
      }
      // Effects Placeholder
      const fxL = document.getElementById('microEffectsLayer');
      if (fxL) fxL.innerHTML = `<span style="color:var(--comic-accent-2); font-family:var(--comic-font-display); font-size:2em; text-shadow:2px 2px 0 #000;">POW!</span>`;

      const rsTimer = document.getElementById('respinTimer');
      if (rsTimer) rsTimer.textContent = "1:59";
    }

    // Wheel Logic
    const wheelStage = document.getElementById('wheelStage');
    if (wheelStage && (mode === 'wheel' || mode === 'overlay')) {
      wheelStage.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 500;
      canvas.id = 'wheelCanvas';
      wheelStage.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      let currentRotation = 0;
      const isOverlayMode = mode === 'overlay';
      let isWheelActive = mode === 'wheel';
      let manualWheelState = null;
      let autoWheelActive = false;

      function setWheelActive(active) {
        isWheelActive = active;
        if (isOverlayMode) {
          document.body.classList.toggle('wheel-active', active);
        }
      }

      // Default slots until fetched
      let wheelSlots = [
        { label: "Gift 5", color: "#ff4444", weight: 1 },
        { label: "Hydrate", color: "#00ff66", weight: 1 },
        { label: "Beanboozled", color: "#ffcc00", weight: 1 },
        { label: "Plank", color: "#00aaff", weight: 1 },
        { label: "VIP", color: "#ffaa00", weight: 1 },
        { label: "Timeout", color: "#aa00aa", weight: 1 }
      ];

      function drawWheel() {
        if (!ctx) return;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 210;
        const innerRadius = 40;
        const totalWeight = wheelSlots.reduce((a, b) => a + b.weight, 0);
        let startAngle = currentRotation;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw outer ring/border
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 12, 0, 2 * Math.PI);
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#333';
        ctx.stroke();

        // Draw tick marks around the edge
        const tickCount = 36;
        for (let i = 0; i < tickCount; i++) {
          const tickAngle = (i / tickCount) * 2 * Math.PI;
          const innerTick = radius + 2;
          const outerTick = radius + 10;
          ctx.beginPath();
          ctx.moveTo(
            centerX + Math.cos(tickAngle) * innerTick,
            centerY + Math.sin(tickAngle) * innerTick
          );
          ctx.lineTo(
            centerX + Math.cos(tickAngle) * outerTick,
            centerY + Math.sin(tickAngle) * outerTick
          );
          ctx.strokeStyle = i % 3 === 0 ? '#ffcc00' : '#666';
          ctx.lineWidth = i % 3 === 0 ? 3 : 1;
          ctx.stroke();
        }

        // Draw wheel segments
        wheelSlots.forEach((slot) => {
          const sliceAngle = (slot.weight / totalWeight) * 2 * Math.PI;

          // Draw Slice with gradient
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
          ctx.closePath();

          // Create radial gradient for 3D effect
          const midAngle = startAngle + sliceAngle / 2;
          const gradientX = centerX + Math.cos(midAngle) * (radius / 2);
          const gradientY = centerY + Math.sin(midAngle) * (radius / 2);
          const gradient = ctx.createRadialGradient(
            gradientX, gradientY, 0,
            centerX, centerY, radius
          );
          gradient.addColorStop(0, lightenColor(slot.color, 30));
          gradient.addColorStop(0.7, slot.color);
          gradient.addColorStop(1, darkenColor(slot.color, 30));

          ctx.fillStyle = gradient;
          ctx.fill();

          // Segment border
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#000';
          ctx.stroke();

          // Draw Text with better styling
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(startAngle + sliceAngle / 2);
          ctx.textAlign = "right";

          // Text shadow/outline for readability
          const textColor = getContrastColor(slot.color);
          ctx.font = "bold 18px 'Bangers', 'Comic Neue', sans-serif";
          ctx.letterSpacing = "1px";

          // Draw text outline
          ctx.strokeStyle = textColor === '#fff' ? '#000' : '#fff';
          ctx.lineWidth = 3;
          ctx.strokeText(slot.label, radius - 25, 6);

          // Draw text fill
          ctx.fillStyle = textColor;
          ctx.fillText(slot.label, radius - 25, 6);
          ctx.restore();

          startAngle += sliceAngle;
        });

        // Draw center hub
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius + 5, 0, 2 * Math.PI);
        const hubGradient = ctx.createRadialGradient(
          centerX - 10, centerY - 10, 0,
          centerX, centerY, innerRadius + 5
        );
        hubGradient.addColorStop(0, '#444');
        hubGradient.addColorStop(0.5, '#222');
        hubGradient.addColorStop(1, '#111');
        ctx.fillStyle = hubGradient;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#555';
        ctx.stroke();

        // Hub inner circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius - 10, 0, 2 * Math.PI);
        ctx.fillStyle = '#b80f0a';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw Pointer (triangle pointing left into wheel)
        ctx.beginPath();
        ctx.moveTo(centerX + radius + 25, centerY);
        ctx.lineTo(centerX + radius + 45, centerY - 20);
        ctx.lineTo(centerX + radius + 45, centerY + 20);
        ctx.closePath();

        // Pointer gradient
        const pointerGradient = ctx.createLinearGradient(
          centerX + radius + 25, centerY - 20,
          centerX + radius + 25, centerY + 20
        );
        pointerGradient.addColorStop(0, '#ffcc00');
        pointerGradient.addColorStop(0.5, '#ff9900');
        pointerGradient.addColorStop(1, '#cc6600');
        ctx.fillStyle = pointerGradient;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.stroke();

        // Pointer highlight
        ctx.beginPath();
        ctx.moveTo(centerX + radius + 28, centerY - 5);
        ctx.lineTo(centerX + radius + 40, centerY - 15);
        ctx.lineTo(centerX + radius + 40, centerY - 5);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
      }

      // Helper functions for color manipulation
      function lightenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
      }

      function darkenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, (num >> 16) - amt);
        const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
        const B = Math.max(0, (num & 0x0000FF) - amt);
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
      }

      function getContrastColor(hexColor) {
        const num = parseInt(hexColor.replace('#', ''), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#000' : '#fff';
      }

      // Initial Draw
      drawWheel();
      setWheelActive(isWheelActive);

      socket.on('overlay:wheelVisibility', (data) => {
        if (!isOverlayMode || !data || typeof data.active !== 'boolean') return;
        manualWheelState = data.active;
        autoWheelActive = false;
        setWheelActive(manualWheelState);
      });

      // Listen for socket updates to slots
      socket.on('updateSlots', (slots) => {
        wheelSlots = slots;
        drawWheel();
      });

      // Spin Animation
      let isSpinning = false;
      let currentSpinData = null;
      let lastTickAngle = 0;
      const TICK_ANGLE_THRESHOLD = 15; // Play tick every 15 degrees

      // Respin timer state (so we can clear on new spin)
      let respinCountdownInterval = null;
      let respinShowTimeout = null;

      socket.on('spinTriggered', (data) => {
        if (isSpinning) return;
        if (data?.error) {
          console.error('Spin error:', data.error);
          return;
        }

        isSpinning = true;
        currentSpinData = data;
        lastTickAngle = currentRotation;

        // Clear any existing respin timer/window (for respins)
        if (respinCountdownInterval) {
          clearInterval(respinCountdownInterval);
          respinCountdownInterval = null;
        }
        if (respinShowTimeout) {
          clearTimeout(respinShowTimeout);
          respinShowTimeout = null;
        }
        const respinWin = document.getElementById('respinWindow');
        if (respinWin) {
          respinWin.classList.remove('show');
        }

        // Show wheel if in overlay mode
        if (isOverlayMode && manualWheelState === null && !isWheelActive) {
          setWheelActive(true);
          autoWheelActive = true;
        }

        // Hide any existing result display
        const resultDisplay = document.getElementById('spinResultDisplay');
        if (resultDisplay) {
          resultDisplay.classList.remove('show');
        }

        // Calculate target rotation based on winning slot
        // The pointer is at 0 degrees (right side), so we need the winning slot's
        // center to end up at 0 degrees after rotation
        const winnerIndex = data.winner?.index ?? 0;
        const totalWeight = wheelSlots.reduce((sum, s) => sum + s.weight, 0);

        // Calculate where the winning slot's center is (in radians, at wheel rotation 0)
        let slotStartAngle = 0;
        for (let i = 0; i < winnerIndex; i++) {
          slotStartAngle += (wheelSlots[i].weight / totalWeight) * 2 * Math.PI;
        }
        const slotAngle = (wheelSlots[winnerIndex].weight / totalWeight) * 2 * Math.PI;
        // Land somewhere in the middle of the slot (30-70% through)
        // Use server-provided offset if available, otherwise generate locally
        const landingOffset = data.landingOffset ?? (0.3 + Math.random() * 0.4);
        const slotCenterAngle = slotStartAngle + slotAngle * landingOffset;

        // To get this slot to the pointer at 0, we need to figure out where
        // the wheel must END (mod 2π) so the slot is at the pointer
        // When wheel is at finalAngle, slot is at (finalAngle + slotCenterAngle)
        // We want: finalAngle + slotCenterAngle = 0 (mod 2π)
        // So: finalAngle = -slotCenterAngle = 2π - slotCenterAngle (mod 2π)
        const finalNormalizedAngle = (2 * Math.PI - slotCenterAngle) % (2 * Math.PI);

        // Calculate how much we need to rotate from current position to reach finalNormalizedAngle
        const startRotation = currentRotation;
        const currentNormalized = ((startRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // Base rotation needed (always positive, always forward)
        let baseRotation = finalNormalizedAngle - currentNormalized;
        if (baseRotation <= 0) baseRotation += 2 * Math.PI; // Always rotate forward

        // Add 5-8 full spins for visual effect
        const fullSpins = 5 + Math.floor(Math.random() * 4);
        const finalTarget = startRotation + baseRotation + (fullSpins * 2 * Math.PI);

        const duration = data.spinDuration || 6000;
        const startTime = performance.now();

        function easeOutCubic(t) {
          return 1 - Math.pow(1 - t, 3);
        }

        function animate(currentTime) {
          if (!isSpinning) return;

          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easedProgress = easeOutCubic(progress);

          currentRotation = startRotation + (finalTarget - startRotation) * easedProgress;
          drawWheel();

          // Calculate velocity for tick sounds (faster = more frequent)
          const velocity = (1 - progress) * 0.5; // Slows down over time
          const angleDiff = Math.abs(currentRotation - lastTickAngle);

          // Play tick sound when passing threshold
          if (angleDiff > (TICK_ANGLE_THRESHOLD * Math.PI / 180)) {
            // Volume and pitch based on speed
            const volume = 0.2 + velocity * 0.3;
            const pitch = 600 + velocity * 600;
            playTickSound(volume, pitch);
            lastTickAngle = currentRotation;
          }

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            // Spin complete!
            finishSpin();
          }
        }

        requestAnimationFrame(animate);
      });

      function finishSpin() {
        isSpinning = false;

        if (!currentSpinData?.winner) return;

        // Play winning sound
        playWinSound();

        // Show result display
        const resultDisplay = document.getElementById('spinResultDisplay');
        const resultText = document.getElementById('spinResultText');
        if (resultDisplay && resultText) {
          resultText.textContent = currentSpinData.winner.label;
          resultText.style.color = currentSpinData.winner.color;
          resultDisplay.classList.add('show');
        }

        // Open respin window after a delay
        respinShowTimeout = setTimeout(() => {
          const respinWin = document.getElementById('respinWindow');
          const respinTimerEl = document.getElementById('respinTimer');
          const respinCostEl = document.querySelector('#respinWindow .respin-cost');

          if (respinWin) {
            respinWin.classList.add('show');

            // Set cost if element exists
            if (respinCostEl && currentSpinData.respinCost) {
              respinCostEl.textContent = `$${currentSpinData.respinCost}`;
            }

            // Start countdown
            if (respinTimerEl && currentSpinData.respinDuration) {
              let remaining = currentSpinData.respinDuration;
              respinTimerEl.textContent = formatRespinTime(remaining);

              respinCountdownInterval = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                  clearInterval(respinCountdownInterval);
                  respinCountdownInterval = null;
                  respinWin.classList.remove('show');

                  // Also hide the result display
                  if (resultDisplay) {
                    resultDisplay.classList.remove('show');
                  }

                  // Notify server that respin window closed without respin
                  // This triggers automatic slot removal
                  socket.emit('respinWindowClosed', {
                    winner: currentSpinData?.winner
                  });

                  // Hide wheel if it was auto-shown
                  if (isOverlayMode) {
                    if (manualWheelState === true) {
                      setWheelActive(true);
                    } else if (manualWheelState === false) {
                      setWheelActive(false);
                    } else if (autoWheelActive) {
                      setWheelActive(false);
                    }
                    autoWheelActive = false;
                  }
                } else {
                  respinTimerEl.textContent = formatRespinTime(remaining);
                }
              }, 1000);
            }
          }
          respinShowTimeout = null;
        }, 2000); // Show respin window 2 seconds after spin ends
      }

      function formatRespinTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      }

      // Stop Event (legacy - keeping for compatibility)
      socket.on('spinResult', (targetIndex) => {
        console.log("Legacy spinResult received:", targetIndex);
      });
    }
  }
  }) ();
