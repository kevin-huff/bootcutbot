(function () {
    const socket = io();
    const audioEl = document.getElementById('tormentAudio');
    const barFill = document.getElementById('tormentBarFill');
    const activeEl = document.getElementById('tormentActive');
    const goalEl = document.getElementById('tormentGoal');
    const remainingEl = document.getElementById('tormentRemaining');
    const decayEl = document.getElementById('tormentDecay');
    const flareEl = document.getElementById('tormentFlare');

    let currentState = window.__INITIAL_TORMENT_METER_STATE__ || null;
    let expiryDeadline = null;
    let decayInterval = null;

    function formatCurrency(amount) {
        const value = Number(amount) || 0;
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    }

    function formatCountdown(deadline) {
        if (!deadline) {
            return '';
        }
        const diffMs = deadline - Date.now();
        if (diffMs <= 0) {
            return 'Decay imminent';
        }
        const totalSeconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes <= 0) {
            return `Decay in ${seconds}s`;
        }
        return `Decay in ${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }

    function updateDecayCountdown() {
        if (!decayEl) {
            return;
        }
        if (!expiryDeadline) {
            decayEl.textContent = '';
            return;
        }
        decayEl.textContent = formatCountdown(expiryDeadline);
        if (expiryDeadline <= Date.now()) {
            expiryDeadline = null;
        }
    }

    function scheduleDecay(deadlineSeconds) {
        if (!Number.isFinite(deadlineSeconds) || deadlineSeconds <= 0) {
            expiryDeadline = null;
            updateDecayCountdown();
            if (decayInterval) {
                clearInterval(decayInterval);
                decayInterval = null;
            }
            return;
        }
        expiryDeadline = Date.now() + (deadlineSeconds * 1000);
        updateDecayCountdown();
        if (decayInterval) {
            clearInterval(decayInterval);
        }
        decayInterval = setInterval(updateDecayCountdown, 1000);
    }

    function updateBar(state) {
        if (!barFill) {
            return;
        }
        const percent = Math.max(0, Math.min(100, Number(state.progressPercent) || 0));
        barFill.style.width = `${percent}%`;
        if (percent <= 0) {
            barFill.classList.add('dimmed');
        } else {
            barFill.classList.remove('dimmed');
        }
        if (flareEl) {
            if (percent <= 0) {
                flareEl.classList.remove('active');
            } else {
                flareEl.classList.add('active');
                const clamped = Math.max(0, Math.min(100, percent));
                flareEl.style.left = `calc(${clamped}% - 70px)`;
                flareEl.style.animation = 'emberPulse 1.8s ease-in-out infinite';
            }
        }
    }

    function updateStats(state) {
        if (activeEl) {
            activeEl.textContent = formatCurrency(state.totalActive);
        }
        if (goalEl) {
            goalEl.textContent = formatCurrency(state.currentGoal);
        }
        if (remainingEl) {
            const remaining = Math.max(0, Number(state.remaining) || 0);
            if (remaining === 0) {
                remainingEl.textContent = 'Threshold reached!';
            } else {
                remainingEl.textContent = `${formatCurrency(remaining)} to go`;
            }
        }
    }

    function applyState(state) {
        if (!state) {
            if (remainingEl) {
                const message = window.__INITIAL_TORMENT_ERROR__ || 'Meter offline';
                remainingEl.textContent = message;
            }
            return;
        }
        currentState = state;
        updateBar(state);
        updateStats(state);
        scheduleDecay(state.nextExpirySeconds);
        if (audioEl && typeof state.audioUrl === 'string' && audioEl.src !== state.audioUrl) {
            audioEl.src = state.audioUrl;
        }
    }

    function triggerCelebration(payload) {
        if (!payload || !audioEl) {
            return;
        }
        try {
            audioEl.currentTime = 0;
            const playPromise = audioEl.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((error) => {
                    console.warn('Torment audio play blocked:', error);
                });
            }
        } catch (error) {
            console.warn('Torment audio playback failed:', error);
        }
        if (flareEl) {
            flareEl.classList.add('active');
            flareEl.style.animation = 'emberPulse 0.8s ease-out 0s 3';
            setTimeout(() => {
                flareEl.style.animation = 'emberPulse 1.8s ease-in-out infinite';
            }, 2400);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentState) {
            updateDecayCountdown();
        }
    });

    applyState(currentState);

    socket.emit('join_torment_meter');
    socket.on('torment_meter_update', (state) => {
        applyState(state);
    });

    socket.on('torment_meter_trigger', (payload) => {
        if (payload && payload.currentState) {
            applyState(payload.currentState);
        }
        triggerCelebration(payload);
    });

    socket.on('torment_meter_error', (payload) => {
        if (remainingEl) {
            remainingEl.textContent = payload?.message || 'Meter error';
        }
    });
})();
