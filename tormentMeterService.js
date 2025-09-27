import jsoning from 'jsoning';
import { randomUUID } from 'crypto';

const meterDb = new jsoning('db/torment_meter.json');
const DECAY_MINUTES = 60;
const DECAY_MS = DECAY_MINUTES * 60 * 1000;
const REDUCTION_FACTOR = 0.9;
const DEFAULT_AUDIO_URL = 'https://cdn.leantube.org/hellfire.mp3?v=1714958299269';
const DB_KEY = 'state';

const DEFAULT_STATE = {
  baseGoalCents: 7500,
  minGoalCents: 2500,
  contributions: [],
  triggers: [],
  audioUrl: DEFAULT_AUDIO_URL,
  lastTriggerAt: null,
  createdAt: null,
  updatedAt: null
};

let stateCache = null;
let ioRef = null;
let pruneTimer = null;

function dollarsToCents(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value * 100));
}

function centsToDollars(cents) {
  if (!Number.isFinite(cents)) {
    return 0;
  }
  return Number((cents / 100).toFixed(2));
}

function normalizeContribution(raw) {
  const timestamp = Number(raw?.timestamp) || Date.now();
  const amountCents = Math.max(0, Math.round(Number(raw?.amountCents) || 0));
  const consumedCents = Math.min(Math.max(0, Math.round(Number(raw?.consumedCents) || 0)), amountCents);
  const expiresAt = Number(raw?.expiresAt) || timestamp + DECAY_MS;
  return {
    id: raw?.id || randomUUID(),
    source: typeof raw?.source === 'string' ? raw.source : 'unknown',
    sourceDetails: raw?.sourceDetails ?? null,
    metadata: raw?.metadata ?? null,
    amountCents,
    consumedCents,
    timestamp,
    expiresAt,
    note: typeof raw?.note === 'string' ? raw.note : null
  };
}

function normalizeTrigger(raw) {
  const timestamp = Number(raw?.timestamp) || Date.now();
  const goalCents = Math.max(0, Math.round(Number(raw?.goalCents) || 0));
  const expiresAt = Number(raw?.expiresAt) || timestamp + DECAY_MS;
  return {
    id: raw?.id || randomUUID(),
    timestamp,
    expiresAt,
    goalCents,
    source: raw?.source ?? 'torment_meter'
  };
}

function ensureStateShape(rawState) {
  const state = rawState && typeof rawState === 'object' ? { ...rawState } : {};
  state.baseGoalCents = Number.isFinite(state.baseGoalCents) ? Math.max(100, Math.round(state.baseGoalCents)) : DEFAULT_STATE.baseGoalCents;
  state.minGoalCents = Number.isFinite(state.minGoalCents) ? Math.max(0, Math.round(state.minGoalCents)) : Math.round(state.baseGoalCents * 0.5);
  if (state.minGoalCents > state.baseGoalCents) {
    state.minGoalCents = Math.round(state.baseGoalCents * 0.5);
  }
  state.audioUrl = typeof state.audioUrl === 'string' ? state.audioUrl : DEFAULT_AUDIO_URL;
  state.contributions = Array.isArray(state.contributions) ? state.contributions.map(normalizeContribution) : [];
  state.triggers = Array.isArray(state.triggers) ? state.triggers.map(normalizeTrigger) : [];
  state.lastTriggerAt = Number.isFinite(state.lastTriggerAt) ? state.lastTriggerAt : null;
  state.createdAt = Number.isFinite(state.createdAt) ? state.createdAt : Date.now();
  state.updatedAt = Number.isFinite(state.updatedAt) ? state.updatedAt : Date.now();
  return state;
}

async function loadState() {
  if (stateCache) {
    return stateCache;
  }
  const stored = await meterDb.get(DB_KEY);
  if (!stored) {
    stateCache = ensureStateShape({ ...DEFAULT_STATE, createdAt: Date.now(), updatedAt: Date.now() });
    await meterDb.set(DB_KEY, stateCache);
    return stateCache;
  }
  stateCache = ensureStateShape(stored);
  return stateCache;
}

async function saveState(state) {
  state.updatedAt = Date.now();
  stateCache = state;
  await meterDb.set(DB_KEY, state);
}

function pruneExpiredEntities(state, now = Date.now()) {
  let changed = false;
  state.contributions = state.contributions.filter((contribution) => {
    const expiresAt = Number(contribution.expiresAt) || (contribution.timestamp + DECAY_MS);
    contribution.expiresAt = expiresAt;
    if (expiresAt <= now) {
      changed = true;
      return false;
    }
    contribution.amountCents = Math.max(0, Math.round(contribution.amountCents));
    contribution.consumedCents = Math.min(Math.max(0, Math.round(contribution.consumedCents || 0)), contribution.amountCents);
    return true;
  });

  state.triggers = state.triggers.filter((trigger) => {
    const expiresAt = Number(trigger.expiresAt) || (trigger.timestamp + DECAY_MS);
    trigger.expiresAt = expiresAt;
    if (expiresAt <= now) {
      changed = true;
      return false;
    }
    trigger.goalCents = Math.max(0, Math.round(trigger.goalCents || 0));
    return true;
  });

  return changed;
}

function calculateCurrentGoalCents(state, now = Date.now()) {
  const activeTriggers = state.triggers.filter((trigger) => trigger.expiresAt > now).length;
  const reducedGoal = Math.round(state.baseGoalCents * Math.pow(REDUCTION_FACTOR, activeTriggers));
  return Math.max(state.minGoalCents, reducedGoal);
}

function computeAvailableCents(state) {
  return state.contributions.reduce((total, contribution) => {
    const available = contribution.amountCents - (contribution.consumedCents || 0);
    if (available > 0) {
      return total + available;
    }
    return total;
  }, 0);
}

function consumeContributions(state, amountCents) {
  let remaining = amountCents;
  for (const contribution of state.contributions) {
    if (remaining <= 0) {
      break;
    }
    const available = contribution.amountCents - (contribution.consumedCents || 0);
    if (available <= 0) {
      continue;
    }
    const toConsume = Math.min(available, remaining);
    contribution.consumedCents = (contribution.consumedCents || 0) + toConsume;
    remaining -= toConsume;
  }
}

function buildContributionView(contribution, now = Date.now()) {
  const secondsRemaining = Math.max(0, Math.floor((contribution.expiresAt - now) / 1000));
  const availableCents = Math.max(0, contribution.amountCents - (contribution.consumedCents || 0));
  return {
    id: contribution.id,
    source: contribution.source,
    sourceDetails: contribution.sourceDetails,
    note: contribution.note,
    metadata: contribution.metadata,
    amount: centsToDollars(contribution.amountCents),
    consumed: centsToDollars(contribution.consumedCents || 0),
    available: centsToDollars(availableCents),
    timestamp: contribution.timestamp,
    expiresAt: contribution.expiresAt,
    secondsRemaining
  };
}

function buildTriggerView(trigger, now = Date.now()) {
  const secondsRemaining = Math.max(0, Math.floor((trigger.expiresAt - now) / 1000));
  return {
    id: trigger.id,
    timestamp: trigger.timestamp,
    expiresAt: trigger.expiresAt,
    secondsRemaining,
    goal: centsToDollars(trigger.goalCents)
  };
}

function buildPublicState(state, now = Date.now()) {
  const activeTriggers = state.triggers.filter((trigger) => trigger.expiresAt > now).length;
  const currentGoalCents = calculateCurrentGoalCents(state, now);
  const totalAvailableCents = computeAvailableCents(state);
  const remainingCents = Math.max(0, currentGoalCents - totalAvailableCents);
  const progressPercent = currentGoalCents === 0 ? 100 : Math.min(100, Math.round((totalAvailableCents / currentGoalCents) * 100));

  let nextExpirySeconds = null;
  const nextContributionExpiry = state.contributions.reduce((next, contribution) => {
    if (contribution.amountCents - (contribution.consumedCents || 0) <= 0) {
      return next;
    }
    const expiresIn = contribution.expiresAt - now;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      return next;
    }
    if (next === null || expiresIn < next) {
      return expiresIn;
    }
    return next;
  }, null);

  const nextTriggerExpiry = state.triggers.reduce((next, trigger) => {
    const expiresIn = trigger.expiresAt - now;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      return next;
    }
    if (next === null || expiresIn < next) {
      return expiresIn;
    }
    return next;
  }, null);

  if (nextContributionExpiry !== null || nextTriggerExpiry !== null) {
    const nearest = Math.min(
      nextContributionExpiry ?? Number.POSITIVE_INFINITY,
      nextTriggerExpiry ?? Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(nearest)) {
      nextExpirySeconds = Math.max(0, Math.floor(nearest / 1000));
    }
  }

  return {
    baseGoal: centsToDollars(state.baseGoalCents),
    minGoal: centsToDollars(state.minGoalCents),
    currentGoal: centsToDollars(currentGoalCents),
    activeTriggers,
    progressPercent,
    totalActive: centsToDollars(totalAvailableCents),
    remaining: centsToDollars(remainingCents),
    excess: centsToDollars(Math.max(0, totalAvailableCents - currentGoalCents)),
    contributions: state.contributions.map((contribution) => buildContributionView(contribution, now)),
    triggers: state.triggers.map((trigger) => buildTriggerView(trigger, now)),
    nextExpirySeconds,
    audioUrl: state.audioUrl,
    lastTriggerAt: state.lastTriggerAt,
    decayMinutes: DECAY_MINUTES,
    updatedAt: state.updatedAt
  };
}

function broadcastUpdate(state) {
  if (!ioRef) {
    return;
  }
  const payload = buildPublicState(state);
  ioRef.to('torment_meter').emit('torment_meter_update', payload);
}

function broadcastTriggers(triggers, state) {
  if (!ioRef || !triggers.length) {
    return;
  }
  const payload = {
    triggerCount: triggers.length,
    triggers: triggers.map((trigger) => ({
      id: trigger.id,
      timestamp: trigger.timestamp,
      goal: centsToDollars(trigger.goalCents)
    })),
    currentState: buildPublicState(state)
  };
  ioRef.to('torment_meter').emit('torment_meter_trigger', payload);
}

async function evaluateTriggers(state, baseTimestamp = Date.now()) {
  const triggers = [];
  let guard = 0;
  while (guard < 25) { // prevent runaway loops
    const now = Date.now();
    const currentGoalCents = calculateCurrentGoalCents(state, now);
    if (currentGoalCents <= 0) {
      break;
    }
    const availableCents = computeAvailableCents(state);
    if (availableCents < currentGoalCents) {
      break;
    }

    consumeContributions(state, currentGoalCents);
    const trigger = normalizeTrigger({
      id: randomUUID(),
      timestamp: baseTimestamp,
      goalCents: currentGoalCents,
      expiresAt: baseTimestamp + DECAY_MS,
      source: 'torment_meter'
    });
    state.triggers.push(trigger);
    triggers.push(trigger);
    state.lastTriggerAt = baseTimestamp;
    guard += 1;
  }
  return triggers;
}

export async function initializeTormentMeter(ioInstance) {
  ioRef = ioInstance;
  const state = await loadState();
  pruneExpiredEntities(state);
  await saveState(state);
  broadcastUpdate(state);

  if (pruneTimer) {
    clearInterval(pruneTimer);
  }
  pruneTimer = setInterval(async () => {
    const currentState = await loadState();
    const changed = pruneExpiredEntities(currentState);
    if (changed) {
      await saveState(currentState);
      broadcastUpdate(currentState);
    }
  }, 30000);
}

export async function shutdownTormentMeter() {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

export async function getTormentMeterState() {
  const state = await loadState();
  pruneExpiredEntities(state);
  await saveState(state);
  return buildPublicState(state);
}

export async function recordContribution({ amountCents, source, sourceDetails, metadata, note }) {
  const cents = Math.max(0, Math.round(Number(amountCents) || 0));
  if (cents <= 0) {
    return { ignored: true };
  }

  const state = await loadState();
  const now = Date.now();
  pruneExpiredEntities(state, now);

  const contribution = normalizeContribution({
    id: randomUUID(),
    timestamp: now,
    amountCents: cents,
    consumedCents: 0,
    source,
    sourceDetails,
    metadata,
    note
  });

  state.contributions.push(contribution);

  const triggers = await evaluateTriggers(state, now);

  await saveState(state);
  broadcastUpdate(state);
  if (triggers.length) {
    broadcastTriggers(triggers, state);
  }

  return {
    contribution: buildContributionView(contribution, now),
    triggersFired: triggers.length
  };
}

export async function resetTormentMeter() {
  const state = await loadState();
  state.contributions = [];
  state.triggers = [];
  state.lastTriggerAt = null;
  await saveState(state);
  broadcastUpdate(state);
  return buildPublicState(state);
}

export async function setBaseGoal(dollars) {
  const state = await loadState();
  const cents = Math.max(100, dollarsToCents(dollars));
  state.baseGoalCents = cents;
  if (state.minGoalCents > state.baseGoalCents) {
    state.minGoalCents = Math.round(state.baseGoalCents * 0.5);
  }
  pruneExpiredEntities(state);
  const triggers = await evaluateTriggers(state);
  await saveState(state);
  broadcastUpdate(state);
  if (triggers.length) {
    broadcastTriggers(triggers, state);
  }
  return buildPublicState(state);
}

export async function setMinGoal(dollars) {
  const state = await loadState();
  const cents = Math.max(0, dollarsToCents(dollars));
  state.minGoalCents = Math.min(Math.round(state.baseGoalCents), cents);
  pruneExpiredEntities(state);
  const triggers = await evaluateTriggers(state);
  await saveState(state);
  broadcastUpdate(state);
  if (triggers.length) {
    broadcastTriggers(triggers, state);
  }
  return buildPublicState(state);
}

export async function setAudioUrl(url) {
  const state = await loadState();
  if (typeof url === 'string' && url.trim().length > 0) {
    state.audioUrl = url.trim();
  }
  await saveState(state);
  broadcastUpdate(state);
  return buildPublicState(state);
}

export function centsToDollarsSafe(cents) {
  return centsToDollars(cents);
}

export function dollarsToCentsSafe(dollars) {
  return dollarsToCents(dollars);
}

export function getDecayMinutes() {
  return DECAY_MINUTES;
}

export async function getDerivedState() {
  return getTormentMeterState();
}

export async function getServiceDebug() {
  const state = await loadState();
  return {
    rawState: state,
    derived: buildPublicState(state)
  };
}
