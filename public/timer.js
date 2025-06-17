// Initialize shared socket
window.socket = window.socket || io();

// Initialize clock and handlers when document is ready
$(document).ready(function() {
    // Join the timer room to get current state
    window.socket.emit('join_subathon_timer');

    // Format seconds into readable duration
    function formatDuration(seconds) {
        if (seconds < 60) {
            return `+${seconds}s`;
        } else if (seconds < 3600) {
            return `+${Math.floor(seconds / 60)}m`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            if (minutes === 0) {
                return `+${hours}h`;
            }
            return `+${hours}h ${minutes}m`;
        }
    }

    // Listen for time modifications
    window.socket.on('subathon_time_added', (seconds) => {
        if (window.clock) {
            const currentTime = Math.ceil(window.clock.getTime().time);
            const newTime = Math.ceil(currentTime + seconds);
            window.clock.setTime(newTime);
            
            // Start if we were at 0 and not paused
            if (currentTime === 0 && !window.clock.isPaused) {
                window.clock.start();
            }

            // Flash animation
            const container = document.querySelector('.container-fluid, .container');
            if (container) {
                container.classList.remove('flash');
                // Force reflow to restart animation
                void container.offsetWidth;
                container.classList.add('flash');
            }

            // Show time added notification
            const notification = document.querySelector('.time-added-notification');
            if (notification) {
                notification.textContent = formatDuration(seconds);
                notification.classList.remove('float-up');
                // Force reflow to restart animation
                void notification.offsetWidth;
                notification.classList.add('float-up');
            }

            // Update end time display
            const endTimeDisplay = document.querySelector('.end-time');
            if (endTimeDisplay) {
                const endTime = new Date(Date.now() + (newTime * 1000));
                const estTime = new Date(endTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                const formattedTime = estTime.toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
                endTimeDisplay.textContent = `Ends ${formattedTime} EST`;
            }
        }
    });

    // Listen for multiplier state
    window.socket.on('multiplier_state', (data) => {
        window.multiplierEnabled = data.enabled;
        const indicator = document.querySelector('.multiplier-indicator');
        if (indicator) {
            indicator.style.display = data.enabled ? 'block' : 'none';
            indicator.textContent = `${data.value}X`;
        }
    });

    window.socket.on('subathon_time_subtracted', (seconds) => {
        if (window.clock) {
            const currentTime = Math.ceil(window.clock.getTime().time);
            const newTime = Math.max(0, Math.ceil(currentTime - seconds));
            window.clock.setTime(newTime);
            
            // Stop if we hit 0
            if (newTime === 0) {
                window.clock.stop();
                window.clock.isPaused = true;
                
                // Update button state if it exists
                const toggleBtn = document.getElementById('toggleBtn');
                if (toggleBtn) {
                    toggleBtn.textContent = 'Start Timer';
                    toggleBtn.className = 'btn btn-success';
                }

                // Clear end time display
                const endTimeDisplay = document.querySelector('.end-time');
                if (endTimeDisplay) {
                    endTimeDisplay.textContent = '';
                }
            } else {
                // Update end time display
                const endTimeDisplay = document.querySelector('.end-time');
                if (endTimeDisplay) {
                    const endTime = new Date(Date.now() + (newTime * 1000));
                    const estTime = new Date(endTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    const formattedTime = estTime.toLocaleString('en-US', {
                        timeZone: 'America/New_York',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    });
                    endTimeDisplay.textContent = `Ends ${formattedTime} EST`;
                }
            }
        }
    });

    window.socket.on('subathon_time_set', (seconds) => {
        if (window.clock) {
            window.clock.setTime(seconds);
            
            if (seconds > 0 && !window.clock.isPaused) {
                window.clock.start();
            } else if (seconds === 0) {
                window.clock.stop();
                window.clock.isPaused = true;
                
                // Update button state if it exists
                const toggleBtn = document.getElementById('toggleBtn');
                if (toggleBtn) {
                    toggleBtn.textContent = 'Start Timer';
                    toggleBtn.className = 'btn btn-success';
                }
            }

            // Update end time display
            const endTimeDisplay = document.querySelector('.end-time');
            if (endTimeDisplay) {
                const endTime = new Date(Date.now() + (seconds * 1000));
                // Convert to EST
                const estTime = new Date(endTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                const formattedTime = estTime.toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
                endTimeDisplay.textContent = `Ends ${formattedTime} EST`;
            }
        }
    });

    window.socket.on('subathon_timer_state', (isPaused) => {
        if (window.clock) {
            window.clock.isPaused = isPaused;
            
            if (isPaused) {
                window.clock.stop();
            } else {
                const currentTime = Math.ceil(window.clock.getTime().time);
                if (currentTime > 0) {
                    window.clock.start();
                }

                // Update end time when resuming
                const endTimeDisplay = document.querySelector('.end-time');
                if (endTimeDisplay && currentTime > 0) {
                    const endTime = new Date(Date.now() + (currentTime * 1000));
                    const estTime = new Date(endTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    const formattedTime = estTime.toLocaleString('en-US', {
                        timeZone: 'America/New_York',
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                    });
                    endTimeDisplay.textContent = `Ends ${formattedTime} EST`;
                }
            }
            
            // Update button state if it exists
            const toggleBtn = document.getElementById('toggleBtn');
            if (toggleBtn) {
                toggleBtn.textContent = isPaused ? 'Start Timer' : 'Pause Timer';
                toggleBtn.className = isPaused ? 'btn btn-success' : 'btn btn-warning';
            }
        }
    });
});

// Helper functions to control timer
window.addTime = function(minutes) {
    window.socket.emit('subathon_add_time', minutes * 60);
};

window.subtractTime = function(minutes) {
    window.socket.emit('subathon_subtract_time', minutes * 60);
};

window.setTime = function(hours) {
    window.socket.emit('subathon_set_time', hours * 3600);
};

window.toggleTimer = function() {
    window.socket.emit('subathon_toggle_timer');
};

// Helper function to emit time with source
function emitTimeAdd(minutes, source) {
    window.socket.emit('subathon_add_time', minutes * 60, source);
}

// Bits handling (100 bits = 1 minute)
window.addBits = function() {
    const bits = parseInt(document.getElementById('bitsAmount').value) || 0;
    const minutes = Math.floor(bits / 100);
    if (minutes > 0) {
        emitTimeAdd(minutes, `bits_${bits}`);
        document.getElementById('bitsAmount').value = '';
    }
};

// Subscription handling
window.addSub = function(tier) {
    const minutes = tier === 1 ? 5 : (tier === 2 ? 10 : 25);
    emitTimeAdd(minutes, `sub_tier${tier}`);
};

// Gift subs handling
window.addGiftSubs = function() {
    const tier = parseInt(document.getElementById('giftTier').value);
    const amount = parseInt(document.getElementById('giftAmount').value) || 0;
    const minutesPerSub = tier === 1 ? 5 : (tier === 2 ? 10 : 25);
    const totalMinutes = amount * minutesPerSub;
    if (totalMinutes > 0) {
        emitTimeAdd(totalMinutes, `gift_subs_tier${tier}_x${amount}`);
        document.getElementById('giftAmount').value = '';
    }
};

// Direct donation handling ($1 = 1 minute)
window.addDonation = function() {
    const amount = parseFloat(document.getElementById('donationAmount').value) || 0;
    if (amount > 0) {
        emitTimeAdd(Math.floor(amount), `donation_$${amount}`);
        document.getElementById('donationAmount').value = '';
    }
};

// Merch purchase handling ($1 = 1 minute)
window.addMerch = function() {
    const amount = parseFloat(document.getElementById('merchAmount').value) || 0;
    if (amount > 0) {
        emitTimeAdd(Math.floor(amount), `merch_$${amount}`);
        document.getElementById('merchAmount').value = '';
    }
};

// Manual time control
window.addManualTime = function() {
    const minutes = parseInt(document.getElementById('manualMinutes').value) || 0;
    if (minutes > 0) {
        emitTimeAdd(minutes, 'manual_add');
        document.getElementById('manualMinutes').value = '';
    }
};

window.subtractManualTime = function() {
    const minutes = parseInt(document.getElementById('manualMinutes').value) || 0;
    if (minutes > 0) {
        window.socket.emit('subathon_subtract_time', minutes * 60, 'manual_subtract');
        document.getElementById('manualMinutes').value = '';
    }
};
