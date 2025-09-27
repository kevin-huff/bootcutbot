(function () {
    const socket = io();
    let currentState = window.__TORMENT_METER_INITIAL_STATE__ || null;
    let expiryDeadline = null;
    let countdownInterval = null;

    const barFill = document.getElementById('tormentAdminBarFill');
    const activeEl = document.getElementById('adminActiveTotal');
    const goalEl = document.getElementById('adminCurrentGoal');
    const remainingEl = document.getElementById('adminRemaining');
    const decayEl = document.getElementById('adminDecayCountdown');
    const statusEl = document.getElementById('tormentStatus');
    const baseGoalInput = document.getElementById('baseGoalInput');
    const minGoalInput = document.getElementById('minGoalInput');
    const manualAmountInput = document.getElementById('manualAmount');
    const manualSourceInput = document.getElementById('manualSource');
    const manualNoteInput = document.getElementById('manualNote');
    const audioInput = document.getElementById('audioInput');
    const resetBtn = document.getElementById('resetMeterBtn');
    const contributionsTable = document.querySelector('#contributionsTable tbody');
    const reductionsTable = document.querySelector('#reductionsTable tbody');

    function formatCurrency(amount) {
        const value = Number(amount) || 0;
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds)) {
            return '';
        }
        if (seconds <= 0) {
            return 'Expiring';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        if (mins <= 0) {
            return `${secs}s`;
        }
        const hours = Math.floor(mins / 60);
        const minutes = mins % 60;
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
    }

    function showStatus(message, variant = 'info', autoHide = true) {
        if (!statusEl) {
            return;
        }
        statusEl.textContent = message;
        statusEl.className = `alert alert-${variant}`;
        statusEl.style.display = 'block';
        if (autoHide) {
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 4000);
        }
    }

    function scheduleCountdown(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) {
            expiryDeadline = null;
            decayEl.textContent = '';
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            return;
        }
        expiryDeadline = Date.now() + (seconds * 1000);
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }
        countdownInterval = setInterval(() => {
            if (!decayEl) {
                return;
            }
            const remaining = Math.max(0, Math.floor((expiryDeadline - Date.now()) / 1000));
            if (remaining <= 0) {
                decayEl.textContent = 'Next decay moment now';
                clearInterval(countdownInterval);
                countdownInterval = null;
                return;
            }
            decayEl.textContent = `Next decay in ${formatDuration(remaining)}`;
        }, 1000);
        decayEl.textContent = `Next decay in ${formatDuration(seconds)}`;
    }

    function populateTables(state) {
        if (contributionsTable) {
            contributionsTable.innerHTML = '';
            state.contributions
                .filter((entry) => entry.amount > 0)
                .sort((a, b) => a.secondsRemaining - b.secondsRemaining)
                .forEach((entry) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${entry.source || 'unknown'}</td>
                        <td>${formatCurrency(entry.amount)}</td>
                        <td>${formatCurrency(entry.available)}</td>
                        <td>${formatDuration(entry.secondsRemaining)}</td>
                    `;
                    contributionsTable.appendChild(row);
                });
        }
        if (reductionsTable) {
            reductionsTable.innerHTML = '';
            state.triggers
                .sort((a, b) => a.secondsRemaining - b.secondsRemaining)
                .forEach((trigger) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${formatCurrency(trigger.goal)}</td>
                        <td>${formatDuration(trigger.secondsRemaining)}</td>
                    `;
                    reductionsTable.appendChild(row);
                });
        }
    }

    function updateInputs(state) {
        if (baseGoalInput) {
            baseGoalInput.value = state.baseGoal;
        }
        if (minGoalInput) {
            minGoalInput.value = state.minGoal;
        }
        if (audioInput && state.audioUrl) {
            audioInput.value = state.audioUrl;
        }
    }

    function applyState(state) {
        if (!state) {
            showStatus(window.__TORMENT_METER_ERROR__ || 'Unable to load meter state.', 'danger', false);
            return;
        }
        currentState = state;
        const percent = Math.max(0, Math.min(100, Number(state.progressPercent) || 0));
        if (barFill) {
            barFill.style.width = `${percent}%`;
            if (percent <= 0) {
                barFill.classList.add('dimmed');
            } else {
                barFill.classList.remove('dimmed');
            }
        }
        if (activeEl) {
            activeEl.textContent = formatCurrency(state.totalActive);
        }
        if (goalEl) {
            goalEl.textContent = formatCurrency(state.currentGoal);
        }
        if (remainingEl) {
            const remaining = Math.max(0, Number(state.remaining) || 0);
            remainingEl.textContent = remaining === 0 ? 'Ready to trigger' : formatCurrency(remaining);
        }
        populateTables(state);
        updateInputs(state);
        scheduleCountdown(state.nextExpirySeconds);
    }

    function handleSocketResponse(callback) {
        return (response) => {
            if (response?.ok) {
                showStatus('Changes saved.', 'success');
                if (response.state) {
                    applyState(response.state);
                }
                if (typeof callback === 'function') {
                    callback(true, response);
                }
            } else {
                showStatus(response?.error || 'Action failed.', 'danger');
                if (typeof callback === 'function') {
                    callback(false, response);
                }
            }
        };
    }

    function attachFormHandlers() {
        const baseGoalForm = document.getElementById('baseGoalForm');
        if (baseGoalForm) {
            baseGoalForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const value = Number(baseGoalInput.value);
                if (!Number.isFinite(value) || value <= 0) {
                    showStatus('Base goal must be greater than zero.', 'warning');
                    return;
                }
                socket.emit('torment_meter_set_base_goal', { amount: value }, handleSocketResponse());
            });
        }
        const minGoalForm = document.getElementById('minGoalForm');
        if (minGoalForm) {
            minGoalForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const value = Number(minGoalInput.value);
                if (!Number.isFinite(value) || value < 0) {
                    showStatus('Minimum goal must be zero or greater.', 'warning');
                    return;
                }
                socket.emit('torment_meter_set_min_goal', { amount: value }, handleSocketResponse());
            });
        }
        const manualForm = document.getElementById('manualContributionForm');
        if (manualForm) {
            manualForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const amount = Number(manualAmountInput.value);
                if (!Number.isFinite(amount) || amount <= 0) {
                    showStatus('Contribution amount must be greater than zero.', 'warning');
                    return;
                }
                const payload = {
                    amount,
                    source: manualSourceInput.value || 'manual',
                    note: manualNoteInput.value || undefined
                };
                socket.emit('torment_meter_manual_add', payload, handleSocketResponse(() => {
                    manualAmountInput.value = '';
                    manualSourceInput.value = '';
                    manualNoteInput.value = '';
                }));
            });
        }
        const audioForm = document.getElementById('audioForm');
        if (audioForm) {
            audioForm.addEventListener('submit', (event) => {
                event.preventDefault();
                const url = audioInput.value.trim();
                if (!url) {
                    showStatus('Audio URL cannot be empty.', 'warning');
                    return;
                }
                socket.emit('torment_meter_set_audio', { url }, handleSocketResponse());
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Reset torment meter? This clears all active contributions and reductions.')) {
                    socket.emit('torment_meter_reset', handleSocketResponse());
                }
            });
        }
    }

    attachFormHandlers();
    applyState(currentState);

    socket.emit('join_torment_meter');

    socket.on('torment_meter_update', (state) => {
        applyState(state);
    });

    socket.on('torment_meter_trigger', (payload) => {
        if (payload?.currentState) {
            applyState(payload.currentState);
            showStatus(`Torment threshold met (${payload.triggerCount} trigger${payload.triggerCount === 1 ? '' : 's'})!`, 'success');
        }
    });

    socket.on('torment_meter_error', (payload) => {
        showStatus(payload?.message || 'Meter error encountered.', 'danger', false);
    });
})();
