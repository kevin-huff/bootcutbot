import jsoning from 'jsoning';
import { randomUUID } from 'crypto';

const tormentDb = new jsoning('db/torment_meter.json');

const INITIAL_GOAL = 75;
const GOAL_REDUCTION_FACTOR = 0.9;
const CONTRIBUTION_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const BROADCAST_ROOM = 'torment_meter';
const MAX_LOG_ENTRIES = 250;

let ioInstance = null;
let purgeIntervalId = null;
let latestPublicState = null;

const defaultState = {
  currentGoal: INITIAL_GOAL,
  events: [],
  lastTriggerAt: null,
  goalHistory: [],
  eventLog: []
};

let meterState = { ...defaultState };

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function sanitizeEvents(events) {
  return (events || []).map((event) => ({
    id: event.id,
    amount: Number(event.amount) || 0,
    type: event.type || 'other',
    source: event.source || null,
    metadata: event.metadata || null,
    timestamp: Number(event.timestamp) || 0
  }));
}

function sanitizeLogEntries(entries) {
  return (entries || []).map((entry) => ({
    id: entry.id,
    amount: Number(entry.amount) || 0,
    type: entry.type || 'other',
    source: entry.source || null,
    metadata: entry.metadata || null,
    timestamp: Number(entry.timestamp) || 0,
    expiresAt: entry.expiresAt ? Number(entry.expiresAt) : null,
    expiredAt: entry.expiredAt ? Number(entry.expiredAt) : null,
    consumedAt: entry.consumedAt ? Number(entry.consumedAt) : null,
    reason: entry.reason || null
  }));
}

async function persistState() {
  const payload = JSON.parse(JSON.stringify(meterState));
  await tormentDb.set('state', payload);
}

function computeMetrics() {
  const perType = {};
  let total = 0;

  for (const event of meterState.events) {
    const amount = roundNumber(event.amount);
    total = roundNumber(total + amount);
    const bucket = event.type || 'other';
    const existing = perType[bucket] || 0;
    perType[bucket] = roundNumber(existing + amount);
  }

  const goal = roundNumber(meterState.currentGoal);
  const remaining = roundNumber(Math.max(0, goal - total));

  return {
    goal,
    total,
    remaining,
    perType,
    progress: goal > 0 ? Math.min(1, roundNumber(total / goal, 4)) : 0
  };
}

function buildPublicState() {
  const metrics = computeMetrics();
  return {
    goal: metrics.goal,
    total: metrics.total,
    remaining: metrics.remaining,
    progress: metrics.progress,
    perType: metrics.perType,
    windowMs: CONTRIBUTION_WINDOW_MS,
    events: meterState.events.map((event) => ({
      amount: roundNumber(event.amount),
      type: event.type,
      source: event.source,
      timestamp: event.timestamp,
      expiresAt: event.timestamp + CONTRIBUTION_WINDOW_MS,
      metadata: event.metadata
    })),
    lastTriggerAt: meterState.lastTriggerAt,
    nextGoal: metrics.goal,
    reductionFactor: GOAL_REDUCTION_FACTOR,
    goalHistory: meterState.goalHistory.slice(-20)
  };
}

function appendLogEntry(entry) {
  const payload = {
    id: entry.id || randomUUID(),
    timestamp: entry.timestamp || Date.now(),
    amount: entry.amount ?? 0,
    type: entry.type || 'other',
    source: entry.source || null,
    metadata: entry.metadata || null,
    expiresAt: entry.expiresAt ?? null,
    expiredAt: entry.expiredAt ?? null,
    consumedAt: entry.consumedAt ?? null,
    reason: entry.reason || null
  };

  meterState.eventLog = [...(meterState.eventLog || []), payload].slice(-MAX_LOG_ENTRIES);
}

function markLogEntries(ids, prop, value) {
  if (!Array.isArray(meterState.eventLog) || !meterState.eventLog.length) {
    return;
  }

  const idSet = new Set(ids);
  if (!idSet.size) {
    return;
  }

  meterState.eventLog = meterState.eventLog.map((entry) => {
    if (!idSet.has(entry.id)) {
      return entry;
    }
    if (entry[prop]) {
      return entry;
    }
    return {
      ...entry,
      [prop]: value
    };
  });
}

function appendContributionLog(event) {
  appendLogEntry({
    id: event.id,
    type: event.type,
    source: event.source,
    amount: event.amount,
    metadata: event.metadata,
    timestamp: event.timestamp,
    expiresAt: event.timestamp + CONTRIBUTION_WINDOW_MS
  });
}

function appendTriggerLog(triggeredGoal, nextGoal) {
  appendLogEntry({
    type: 'trigger',
    source: 'system',
    amount: triggeredGoal,
    metadata: {
      triggeredGoal,
      nextGoal,
      reductionFactor: GOAL_REDUCTION_FACTOR
    },
    reason: 'goal_met'
  });
}

function appendResetLog(goal) {
  appendLogEntry({
    type: 'reset',
    source: 'system',
    amount: goal,
    metadata: { goal },
    reason: 'manual_reset'
  });
}

function markConsumed(contributions, timestamp) {
  if (!contributions?.length) {
    return;
  }

  const ids = contributions.map((event) => event.id);
  markLogEntries(ids, 'consumedAt', timestamp);
}

async function broadcastState(reason = 'update') {
  latestPublicState = buildPublicState();
  if (ioInstance) {
    ioInstance.to(BROADCAST_ROOM).emit('torment_meter_update', {
      ...latestPublicState,
      reason
    });
  }
  return latestPublicState;
}

async function purgeExpiredEvents({ emit = true, persist = true } = {}) {
  if (!meterState.events.length) {
    return false;
  }

  const cutoff = Date.now() - CONTRIBUTION_WINDOW_MS;
  const expiredEvents = meterState.events.filter((event) => event.timestamp < cutoff);

  if (!expiredEvents.length) {
    return false;
  }

  meterState.events = meterState.events.filter((event) => event.timestamp >= cutoff);
  const expiredIds = expiredEvents.map((event) => event.id);
  markLogEntries(expiredIds, 'expiredAt', Date.now());

  if (persist) {
    await persistState();
  }

  if (emit) {
    await broadcastState('decay');
  }

  return true;
}

async function handleTrigger(currentTotal) {
  const triggeredGoal = roundNumber(meterState.currentGoal);
  const now = Date.now();

  const consumedEvents = meterState.events.slice();

  meterState.lastTriggerAt = now;
  meterState.goalHistory = [
    ...meterState.goalHistory.slice(-19),
    { goal: triggeredGoal, triggeredAt: now }
  ];

  const nextGoal = roundNumber(triggeredGoal * GOAL_REDUCTION_FACTOR);
  meterState.currentGoal = nextGoal;
  meterState.events = [];

  markConsumed(consumedEvents, now);
  appendTriggerLog(triggeredGoal, nextGoal);

  await persistState();

  latestPublicState = buildPublicState();

  if (ioInstance) {
    ioInstance.to(BROADCAST_ROOM).emit('torment_meter_trigger', {
      triggeredGoal,
      triggeredAt: now,
      nextGoal,
      reductionFactor: GOAL_REDUCTION_FACTOR
    });
    ioInstance.to(BROADCAST_ROOM).emit('torment_meter_update', {
      ...latestPublicState,
      reason: 'trigger'
    });
  }

  return {
    triggeredGoal,
    nextGoal
  };
}

async function evaluateForTrigger() {
  const { total } = computeMetrics();
  if (meterState.currentGoal <= 0) {
    return false;
  }

  if (total >= meterState.currentGoal) {
    await handleTrigger(total);
    return true;
  }

  return false;
}

async function loadState() {
  const stored = await tormentDb.get('state');
  if (stored) {
    meterState = {
      ...defaultState,
      ...stored,
      events: sanitizeEvents(stored.events),
      eventLog: sanitizeLogEntries(stored.eventLog)
    };
  } else {
    meterState = { ...defaultState };
    await persistState();
  }

  await purgeExpiredEvents({ emit: false, persist: true });
  latestPublicState = buildPublicState();
}

export async function initializeTormentMeter(io) {
  ioInstance = io;
  await loadState();
  await broadcastState('init');

  if (purgeIntervalId) {
    clearInterval(purgeIntervalId);
  }

  purgeIntervalId = setInterval(() => {
    purgeExpiredEvents({ emit: true, persist: true }).catch((error) => {
      console.error('Torment meter purge failed', error);
    });
  }, 30 * 1000);
  purgeIntervalId.unref?.();
}

export async function addTormentContribution({ amount, type, source, metadata }) {
  const numericAmount = roundNumber(Number(amount || 0));
  if (!numericAmount || numericAmount <= 0) {
    return latestPublicState || buildPublicState();
  }

  const event = {
    id: randomUUID(),
    amount: numericAmount,
    type: type || 'other',
    source: source || null,
    metadata: metadata || null,
    timestamp: Date.now()
  };

  meterState.events.push(event);
  appendContributionLog(event);
  await persistState();
  await purgeExpiredEvents({ emit: false, persist: true });

  const triggered = await evaluateForTrigger();
  if (!triggered) {
    await broadcastState('contribution');
  }

  return latestPublicState;
}

export function getTormentState() {
  if (!latestPublicState) {
    latestPublicState = buildPublicState();
  }
  return latestPublicState;
}

export function getTormentLog() {
  return (meterState.eventLog || []).slice().sort((a, b) => b.timestamp - a.timestamp);
}

export function getTormentWindowMs() {
  return CONTRIBUTION_WINDOW_MS;
}

export function getTormentReductionFactor() {
  return GOAL_REDUCTION_FACTOR;
}

export async function resetTormentMeter(goal = INITIAL_GOAL) {
  const now = Date.now();
  markConsumed(meterState.events.slice(), now);

  const preservedLog = (meterState.eventLog || []).slice(-MAX_LOG_ENTRIES);
  meterState = {
    ...defaultState,
    currentGoal: roundNumber(goal),
    eventLog: preservedLog
  };

  appendResetLog(goal);
  await persistState();
  await broadcastState('reset');
  return latestPublicState;
}
