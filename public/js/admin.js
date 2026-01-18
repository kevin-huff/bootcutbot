const socket = io();

// LOGGING
function log(msg) {
    const logDiv = document.getElementById('adminLog');
    const entry = document.createElement('div');
    entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logDiv.prepend(entry);
}

socket.on('connect', () => {
    log(`Connected to server. ID: ${socket.id}`);
    // Request initial state if needed
    socket.emit('admin:requestState');
    socket.emit('admin:requestWheelSlots');
});

// LISTENERS (Server -> Admin)
socket.on('timerUpdate', (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    document.getElementById('adminTimer').innerText = `${h}:${m}:${s}`;
});

// Timer pause state
let timerPaused = false;
const pauseResumeBtn = document.getElementById('btnPauseResume');

function updatePauseButtonState(isPaused) {
    timerPaused = isPaused;
    if (pauseResumeBtn) {
        pauseResumeBtn.innerText = isPaused ? 'RESUME' : 'PAUSE';
        pauseResumeBtn.classList.toggle('btn-success', isPaused);
        pauseResumeBtn.classList.toggle('btn-warning', !isPaused);
    }
    const timerDisplay = document.getElementById('adminTimer');
    if (timerDisplay) {
        timerDisplay.style.color = isPaused ? '#ff6666' : '#00ff66';
    }
}

socket.on('timerPauseState', (isPaused) => {
    log(`Timer ${isPaused ? 'PAUSED' : 'RESUMED'}`);
    updatePauseButtonState(isPaused);
});

socket.on('spinStateUpdate', (data) => {
    if (data.pending !== undefined) document.getElementById('adminPendingSpins').innerText = data.pending;
    if (data.completed !== undefined) document.getElementById('adminCompletedSpins').innerText = data.completed;
});

socket.on('progressUpdate', (amount) => {
    // Update input placeholder or value if not focused? 
    // For now just log it
    // log(`Progress Updated: $${amount}`);
});

socket.on('admin:wheelSlots', (data) => {
    const slots = Array.isArray(data?.slots) ? data.slots : [];
    renderWheelSlots(slots);
    log(`Loaded ${slots.length} wheel slots`);
});

socket.on('admin:wheelSlotsError', (data) => {
    const msg = data?.message || 'Unknown wheel slot error';
    log(`Wheel slots error: ${msg}`);
});


// ACTIONS (Admin -> Server)

// Timer
function addTime(seconds) {
    log(`Requesting Time Add: ${seconds}s`);
    socket.emit('admin:addTime', seconds);
}

// Test time added animation (emits directly to overlay)
function testTimeAddedAnimation() {
    const testSeconds = 300; // 5 minutes
    log(`Testing time added animation (${testSeconds}s)`);
    socket.emit('admin:testTimeAdded', { seconds: testSeconds, multiplier: 2 });
}

document.getElementById('btnPauseResume').addEventListener('click', () => {
    log('Requesting Timer Pause/Resume');
    socket.emit('admin:togglePause');
});

// Set Timer
const setTimerBtn = document.getElementById('btnSetTimer');
if (setTimerBtn) {
    setTimerBtn.addEventListener('click', () => {
        const minutes = parseInt(document.getElementById('inputSetTimer').value) || 60;
        const seconds = minutes * 60;
        log(`Setting timer to ${minutes} minutes (${seconds}s)`);
        socket.emit('admin:setTimer', seconds);
    });
}

// Max End Time (Cap)
const maxEndTimeDisplay = document.getElementById('maxEndTimeDisplay');
const inputMaxEndTime = document.getElementById('inputMaxEndTime');
const btnSetMaxEndTime = document.getElementById('btnSetMaxEndTime');
const btnClearMaxEndTime = document.getElementById('btnClearMaxEndTime');

function updateMaxEndTimeDisplay(data) {
    if (!maxEndTimeDisplay) return;
    if (data?.maxEndTime && data?.datetime) {
        const date = new Date(data.datetime);
        maxEndTimeDisplay.innerHTML = `<span style="color: #ffcc00;">Cap: ${date.toLocaleString()}</span>`;
    } else {
        maxEndTimeDisplay.innerHTML = `<span style="color: #888;">No cap set</span>`;
    }
}

socket.on('maxEndTimeUpdate', (data) => {
    log(`Max end time: ${data?.datetime || 'cleared'}`);
    updateMaxEndTimeDisplay(data);
});

if (btnSetMaxEndTime && inputMaxEndTime) {
    btnSetMaxEndTime.addEventListener('click', () => {
        const datetime = inputMaxEndTime.value;
        if (!datetime) {
            log('ERROR: Select a date/time first');
            return;
        }
        log(`Setting max end time to ${datetime}`);
        socket.emit('admin:setMaxEndTime', { datetime });
    });
}

if (btnClearMaxEndTime) {
    btnClearMaxEndTime.addEventListener('click', () => {
        log('Clearing max end time cap');
        socket.emit('admin:setMaxEndTime', { clear: true });
    });
}

// Spins
function adjustSpins(delta) {
    log(`Adjusting Spins: ${delta}`);
    socket.emit('admin:adjustSpins', delta);
}

document.getElementById('btnTriggerSpin').addEventListener('click', () => {
    log('Triggering Spin...');
    socket.emit('admin:triggerSpin');
});

// Overlay Wheel Visibility
let wheelVisible = false;
const wheelToggleButton = document.getElementById('btnToggleWheel');

function setWheelToggleState(active) {
    if (!wheelToggleButton) return;
    wheelToggleButton.innerText = active ? 'HIDE WHEEL' : 'SHOW WHEEL';
}

if (wheelToggleButton) {
    setWheelToggleState(wheelVisible);
    wheelToggleButton.addEventListener('click', () => {
        wheelVisible = !wheelVisible;
        setWheelToggleState(wheelVisible);
        log(`Overlay wheel ${wheelVisible ? 'shown' : 'hidden'}`);
        socket.emit('admin:toggleWheel', { active: wheelVisible });
    });
}

socket.on('overlay:wheelVisibility', (data) => {
    if (!data || typeof data.active !== 'boolean') return;
    wheelVisible = data.active;
    setWheelToggleState(wheelVisible);
});

// Wheel Slots
const wheelSlotsList = document.getElementById('wheelSlotsList');
const addWheelSlotButton = document.getElementById('btnAddWheelSlot');
const loadWheelSlotsButton = document.getElementById('btnLoadWheelSlots');
const saveWheelSlotsButton = document.getElementById('btnSaveWheelSlots');

const WHEEL_COLOR_PALETTE = [
    '#ff4444',
    '#00ff66',
    '#444444',
    '#222222',
    '#ffaa00',
    '#aa00aa',
    '#00aaff',
    '#ffffff',
    '#ff66cc',
    '#ffcc00',
    '#66ffcc',
    '#ff9966'
];

function randomWheelColor() {
    return WHEEL_COLOR_PALETTE[Math.floor(Math.random() * WHEEL_COLOR_PALETTE.length)];
}

function createWheelSlotRow(slot = {}) {
    const row = document.createElement('div');
    row.className = 'row g-2 align-items-end mb-2 wheel-slot-row';
    if (slot.id !== undefined && slot.id !== null) {
        row.dataset.slotId = String(slot.id);
    }
    row.innerHTML = `
        <div class="col-8">
            <input type="text" class="form-control bg-dark text-white border-secondary" data-field="label" placeholder="Label">
        </div>
        <div class="col-3">
            <input type="number" class="form-control bg-dark text-white border-secondary" data-field="weight" min="1" step="1" value="1">
        </div>
        <div class="col-1 d-grid">
            <button class="btn btn-outline-danger" type="button" data-action="remove">X</button>
        </div>
        <input type="hidden" data-field="color">
    `;

    const labelInput = row.querySelector('[data-field="label"]');
    const weightInput = row.querySelector('[data-field="weight"]');
    const colorInput = row.querySelector('[data-field="color"]');
    const colorValue = (slot.color && String(slot.color).trim()) || randomWheelColor();

    if (labelInput) labelInput.value = slot.label || '';
    if (weightInput && slot.weight !== undefined && slot.weight !== null) {
        weightInput.value = slot.weight;
    }
    if (colorInput) colorInput.value = colorValue;

    const removeButton = row.querySelector('[data-action="remove"]');
    if (removeButton) {
        removeButton.addEventListener('click', () => {
            row.remove();
        });
    }

    return row;
}

function renderWheelSlots(slots) {
    if (!wheelSlotsList) return;
    wheelSlotsList.innerHTML = '';
    const list = Array.isArray(slots) && slots.length > 0 ? slots : [{}];
    list.forEach((slot) => {
        wheelSlotsList.appendChild(createWheelSlotRow(slot));
    });
}

function collectWheelSlots() {
    if (!wheelSlotsList) return null;
    const rows = wheelSlotsList.querySelectorAll('.wheel-slot-row');
    const slots = [];
    let hasInvalid = false;

    rows.forEach((row) => {
        const labelInput = row.querySelector('[data-field="label"]');
        const weightInput = row.querySelector('[data-field="weight"]');
        const colorInput = row.querySelector('[data-field="color"]');
        const label = labelInput ? labelInput.value.trim() : '';
        if (!label) return;
        const color = (colorInput ? colorInput.value.trim() : '') || randomWheelColor();
        if (colorInput && !colorInput.value) {
            colorInput.value = color;
        }
        const weight = Number(weightInput ? weightInput.value : 1);
        if (!Number.isFinite(weight) || weight <= 0) {
            hasInvalid = true;
            return;
        }
        const slot = { label, color, weight };
        const slotId = Number(row.dataset.slotId);
        if (Number.isFinite(slotId)) {
            slot.id = slotId;
        }
        slots.push(slot);
    });

    if (hasInvalid) {
        log('Wheel slots: weight must be a positive number');
        return null;
    }
    if (!slots.length) {
        log('Wheel slots: add at least one slot with a label');
        return null;
    }
    return slots;
}

if (loadWheelSlotsButton) {
    loadWheelSlotsButton.addEventListener('click', () => {
        log('Requesting current wheel slots');
        socket.emit('admin:requestWheelSlots');
    });
}

if (addWheelSlotButton && wheelSlotsList) {
    addWheelSlotButton.addEventListener('click', () => {
        wheelSlotsList.appendChild(createWheelSlotRow());
    });
}

if (saveWheelSlotsButton) {
    saveWheelSlotsButton.addEventListener('click', () => {
        const slots = collectWheelSlots();
        if (!slots) return;
        socket.emit('admin:setWheelSlots', { slots });
        log(`Saving ${slots.length} wheel slots`);
    });
}

// Progress (legacy)
const btnSetProgress = document.getElementById('btnSetProgress');
if (btnSetProgress) {
    btnSetProgress.addEventListener('click', () => {
        const val = document.getElementById('inputProgress').value;
        log(`Setting Progress to $${val}`);
        socket.emit('admin:setProgress', parseFloat(val));
    });
}

// === DONATION TRACKING ===

// Donation state display elements
const adminDonationTotal = document.getElementById('adminDonationTotal');
const adminNextSpinIn = document.getElementById('adminNextSpinIn');
const adminProgressBar = document.getElementById('adminProgressBar');
const adminProgressText = document.getElementById('adminProgressText');

// Update donation display
function updateDonationDisplay(data) {
    if (adminDonationTotal) {
        adminDonationTotal.innerText = `$${data.total.toFixed(2)}`;
    }
    if (adminNextSpinIn) {
        adminNextSpinIn.innerText = `$${data.nextSpinIn.toFixed(2)}`;
        adminNextSpinIn.style.color = data.nextSpinIn <= 10 ? '#ffcc00' : '#00ff66';
    }
    if (adminProgressBar) {
        adminProgressBar.style.width = `${data.progressPercent}%`;
        adminProgressBar.setAttribute('aria-valuenow', data.progressPercent);
        // Change color as it fills
        if (data.progressPercent >= 80) {
            adminProgressBar.className = 'progress-bar bg-warning';
        } else {
            adminProgressBar.className = 'progress-bar bg-success';
        }
    }
    if (adminProgressText) {
        adminProgressText.innerText = `$${data.progress.toFixed(2)} / $${data.threshold}`;
    }
    // Update threshold input
    const inputSpinThreshold = document.getElementById('inputSpinThreshold');
    if (inputSpinThreshold && !inputSpinThreshold.matches(':focus')) {
        inputSpinThreshold.value = data.threshold;
    }
}

// Listen for donation updates
socket.on('donationUpdate', (data) => {
    log(`Donations: $${data.total.toFixed(2)} total, $${data.progress.toFixed(2)}/${data.threshold} to spin`);
    updateDonationDisplay(data);
});

// Listen for spin earned
socket.on('spinEarned', (data) => {
    log(`🎡 SPIN EARNED! ${data.donorName} donated $${data.amount} - ${data.spinsEarned} spin(s) added!`);
});

// Add donation
function quickAddDonation(amount) {
    log(`Quick adding $${amount} donation`);
    socket.emit('admin:addDonation', { amount });
}

const btnAddDonation = document.getElementById('btnAddDonation');
if (btnAddDonation) {
    btnAddDonation.addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('inputDonationAmount').value) || 0;
        if (amount <= 0) {
            log('ERROR: Enter a positive donation amount');
            return;
        }
        log(`Adding $${amount} donation`);
        socket.emit('admin:addDonation', { amount });
    });
}

// Set donation total
const btnSetDonationTotal = document.getElementById('btnSetDonationTotal');
if (btnSetDonationTotal) {
    btnSetDonationTotal.addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('inputSetDonationTotal').value);
        if (isNaN(amount) || amount < 0) {
            log('ERROR: Enter a valid total amount');
            return;
        }
        log(`Setting donation total to $${amount}`);
        socket.emit('admin:setDonationTotal', amount);
    });
}

// Set donation progress
const btnSetDonationProgress = document.getElementById('btnSetDonationProgress');
if (btnSetDonationProgress) {
    btnSetDonationProgress.addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('inputSetDonationProgress').value);
        if (isNaN(amount) || amount < 0) {
            log('ERROR: Enter a valid progress amount');
            return;
        }
        log(`Setting donation progress to $${amount}`);
        socket.emit('admin:setDonationProgress', amount);
    });
}

// Reset donation progress
const btnResetDonationProgress = document.getElementById('btnResetDonationProgress');
if (btnResetDonationProgress) {
    btnResetDonationProgress.addEventListener('click', () => {
        log('Resetting donation progress to $0');
        socket.emit('admin:resetDonationProgress');
    });
}

// Set spin threshold
const btnSetSpinThreshold = document.getElementById('btnSetSpinThreshold');
if (btnSetSpinThreshold) {
    btnSetSpinThreshold.addEventListener('click', () => {
        const threshold = parseFloat(document.getElementById('inputSpinThreshold').value) || 60;
        if (threshold <= 0) {
            log('ERROR: Threshold must be positive');
            return;
        }
        log(`Setting spin threshold to $${threshold}`);
        socket.emit('admin:setSpinThreshold', threshold);
    });
}

// Effects
function triggerEffect(name) {
    log(`Triggering Effect: ${name}`);
    socket.emit('admin:triggerEffect', name);
}

function triggerRespinWindow() {
    log('Opening Respin Window');
    socket.emit('admin:openRespin');
}

// Rigged Spin
const riggedSlotSelect = document.getElementById('riggedSlotSelect');
const btnRiggedSpin = document.getElementById('btnRiggedSpin');

function populateRiggedSlotDropdown(slots) {
    if (!riggedSlotSelect) return;
    riggedSlotSelect.innerHTML = '<option value="">-- Select Target --</option>';
    if (!Array.isArray(slots)) return;
    slots.forEach((slot, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = slot.label || `Slot ${index + 1}`;
        option.style.backgroundColor = slot.color || '#333';
        riggedSlotSelect.appendChild(option);
    });
}

// Update dropdown when wheel slots are received
socket.on('admin:wheelSlots', (data) => {
    const slots = Array.isArray(data?.slots) ? data.slots : [];
    populateRiggedSlotDropdown(slots);
});

if (btnRiggedSpin) {
    btnRiggedSpin.addEventListener('click', () => {
        if (!riggedSlotSelect || riggedSlotSelect.value === '') {
            log('ERROR: Select a target slot first!');
            return;
        }
        const selectedIndex = parseInt(riggedSlotSelect.value, 10);
        const selectedLabel = riggedSlotSelect.options[riggedSlotSelect.selectedIndex].textContent;
        log(`Triggering RIGGED spin -> "${selectedLabel}" (index ${selectedIndex})`);
        socket.emit('admin:triggerFakeSpin', { targetSlotIndex: selectedIndex });
    });
}

// === REMOVED SLOTS ===

const removedSlotsList = document.getElementById('removedSlotsList');
const removedSlotsCount = document.getElementById('removedSlotsCount');
const noRemovedSlots = document.getElementById('noRemovedSlots');
const btnClearRemovedSlots = document.getElementById('btnClearRemovedSlots');

function renderRemovedSlots(slots) {
    if (!removedSlotsList) return;

    // Update count badge
    if (removedSlotsCount) {
        removedSlotsCount.innerText = slots.length;
    }

    // Show/hide "no slots" message
    if (noRemovedSlots) {
        noRemovedSlots.style.display = slots.length === 0 ? 'block' : 'none';
    }

    // Clear existing slot elements (keep the "no slots" message)
    const existingSlots = removedSlotsList.querySelectorAll('.removed-slot-item');
    existingSlots.forEach(el => el.remove());

    // Render each removed slot
    slots.forEach((slot, index) => {
        const row = document.createElement('div');
        row.className = 'removed-slot-item d-flex align-items-center justify-content-between p-2 mb-1 rounded';
        row.style.backgroundColor = slot.color || '#333';
        row.style.border = '1px solid #555';

        // Determine text color based on background
        const bgColor = slot.color || '#333';
        const textColor = getContrastColor(bgColor);

        const removedDate = slot.removedAt ? new Date(slot.removedAt).toLocaleTimeString() : '';

        row.innerHTML = `
            <div style="color: ${textColor};">
                <strong>${slot.label}</strong>
                <small class="ms-2 opacity-75">(removed ${removedDate})</small>
            </div>
            <button class="btn btn-sm btn-success" data-index="${index}">RESTORE</button>
        `;

        // Add restore click handler
        const restoreBtn = row.querySelector('button');
        restoreBtn.addEventListener('click', () => {
            log(`Restoring slot: ${slot.label}`);
            socket.emit('admin:restoreSlot', { index });
        });

        removedSlotsList.appendChild(row);
    });
}

// Helper to determine text color for contrast
function getContrastColor(hexColor) {
    if (!hexColor) return '#fff';
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000' : '#fff';
}

// Listen for removed slots updates
socket.on('admin:removedSlots', (data) => {
    const slots = Array.isArray(data?.slots) ? data.slots : [];
    log(`Removed slots updated: ${slots.length} slots`);
    renderRemovedSlots(slots);
});

// Listen for slot removal events
socket.on('slotRemoved', (data) => {
    const auto = data?.automatic ? ' (auto)' : '';
    log(`Slot removed${auto}: "${data?.slot?.label}" - ${data?.remainingCount} slots remaining`);
});

// Listen for slot restore events
socket.on('slotRestored', (data) => {
    log(`Slot restored: "${data?.slot?.label}" - ${data?.totalCount} slots now active`);
});

// Clear all removed slots
if (btnClearRemovedSlots) {
    btnClearRemovedSlots.addEventListener('click', () => {
        if (confirm('Clear all removed slots? This cannot be undone.')) {
            log('Clearing all removed slots');
            socket.emit('admin:clearRemovedSlots');
        }
    });
}

// Request removed slots on load
socket.emit('admin:requestRemovedSlots');

// === OVERLAY ELEMENT VISIBILITY TOGGLES ===

const visibilityToggles = document.querySelectorAll('.visibility-toggle');
const elementVisibilityState = {
    timer: true,
    spins: true,
    leaderboard: true,
    wheel: true,
    nextSpin: true,
    progress: true
};

// Initialize toggles
visibilityToggles.forEach(btn => {
    const element = btn.dataset.element;
    if (!element) return;

    btn.addEventListener('click', () => {
        const isActive = btn.classList.contains('active');
        const newState = !isActive;

        // Update local state
        elementVisibilityState[element] = newState;

        // Update button appearance
        btn.classList.toggle('active', newState);

        // Send to server/overlay
        log(`Toggling ${element}: ${newState ? 'visible' : 'hidden'}`);
        socket.emit('admin:toggleElement', { element, visible: newState });
    });
});

// Listen for visibility state updates (e.g., on reconnect)
socket.on('overlay:elementVisibility', (data) => {
    if (!data || typeof data !== 'object') return;

    Object.entries(data).forEach(([element, visible]) => {
        elementVisibilityState[element] = visible;
        const btn = document.querySelector(`.visibility-toggle[data-element="${element}"]`);
        if (btn) {
            btn.classList.toggle('active', visible);
        }
    });
});

// Request initial visibility state
socket.emit('admin:requestVisibilityState');
