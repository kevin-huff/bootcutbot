import { settings_db, acquireLock, releaseLock } from './db.js';

async function calculateTotalValue(subs, bits, donations) {
  const SUB_VALUE = 5;      // $5 per sub
  const BITS_VALUE = 0.01;  // $0.01 per bit
  return (subs * SUB_VALUE) + (bits * BITS_VALUE) + donations;
}

async function checkMilestone(oldTotal, newTotal, io) {
  const MILESTONE_VALUE = 50; // $50 per spin
  const oldMilestones = Math.floor(oldTotal / MILESTONE_VALUE);
  const newMilestones = Math.floor(newTotal / MILESTONE_VALUE);

  if (newMilestones > oldMilestones) {
    console.log('Milestone reached! New spins:', newMilestones - oldMilestones);
    io.emit('subTrackerThreshold', newMilestones);
  }
}

async function handleSubTracker(subsToAdd, io) {
  await acquireLock();

  try {
    subsToAdd = parseInt(subsToAdd);
    let current_subs = await settings_db.get("subsTracker") || 0;
    let current_bits = await settings_db.get("bitsTracker") || 0;
    let current_donations = await settings_db.get("donationsTracker") || 0;
    let completed_spins = await settings_db.get("completedSpins");

    const oldTotal = await calculateTotalValue(current_subs, current_bits, current_donations);
    const newTotal = await calculateTotalValue(current_subs + subsToAdd, current_bits, current_donations);

    await settings_db.set("subsTracker", current_subs + subsToAdd);

    io.emit('updateSubTracker', {
      current_subs: current_subs + subsToAdd,
      current_bits,
      current_donations,
      subsToAdd,
      completed_spins
    });

    await checkMilestone(oldTotal, newTotal, io);
  } finally {
    releaseLock();
  }
}

async function handleBitTracker(bitsToAdd, io) {
  await acquireLock();

  try {
    bitsToAdd = parseInt(bitsToAdd);
    let current_subs = await settings_db.get("subsTracker") || 0;
    let current_bits = await settings_db.get("bitsTracker") || 0;
    let current_donations = await settings_db.get("donationsTracker") || 0;
    let completed_spins = await settings_db.get("completedSpins");

    const oldTotal = await calculateTotalValue(current_subs, current_bits, current_donations);
    const newTotal = await calculateTotalValue(current_subs, current_bits + bitsToAdd, current_donations);

    await settings_db.set("bitsTracker", current_bits + bitsToAdd);

    io.emit('updateBitsTracker', {
      current_subs,
      current_bits: current_bits + bitsToAdd,
      current_donations,
      bitsToAdd,
      completed_spins
    });

    await checkMilestone(oldTotal, newTotal, io);
  } finally {
    releaseLock();
  }
}

async function handleDonationTracker(donationToAdd, io) {
  await acquireLock();

  try {
    donationToAdd = parseFloat(donationToAdd);
    let current_subs = await settings_db.get("subsTracker") || 0;
    let current_bits = await settings_db.get("bitsTracker") || 0;
    let current_donations = await settings_db.get("donationsTracker") || 0;
    let completed_spins = await settings_db.get("completedSpins");

    const oldTotal = await calculateTotalValue(current_subs, current_bits, current_donations);
    const newTotal = await calculateTotalValue(current_subs, current_bits, current_donations + donationToAdd);

    await settings_db.set("donationsTracker", current_donations + donationToAdd);

    io.emit('updateDonationsTracker', {
      current_subs,
      current_bits,
      current_donations: current_donations + donationToAdd,
      donationToAdd,
      completed_spins
    });

    await checkMilestone(oldTotal, newTotal, io);
  } finally {
    releaseLock();
  }
}

async function handleSpinTracker(spinsToAdd, io) {
  await acquireLock();

  try {
    spinsToAdd = parseInt(spinsToAdd);
    let completed_spins = await settings_db.get("completedSpins") || 0;
    let current_subs = await settings_db.get("subsTracker") || 0;
    let current_bits = await settings_db.get("bitsTracker") || 0;
    let current_donations = await settings_db.get("donationsTracker") || 0;

    let new_completed_spins = completed_spins + spinsToAdd;
    await settings_db.set("completedSpins", new_completed_spins);

    io.emit('updateSpinTracker', {
      current_subs,
      current_bits,
      current_donations,
      completed_spins: new_completed_spins
    });
  } finally {
    releaseLock();
  }
}

export {
  handleSubTracker,
  handleBitTracker,
  handleDonationTracker,
  handleSpinTracker
};
