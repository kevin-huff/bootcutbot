import { JsoningPg } from './jsoningPg.js';

// Personal-breakaway economy ledger. Every balance change lands here with a source
// tag so /economy can show where breakaways come from and where they go. Kept
// KV-shim-friendly: running per-source totals plus a capped recent-events list,
// so writes stay O(cap) instead of growing forever.
//
// Sources: bits_pack, channel_points, gift, mod_grant (mod !give_ba / board admin,
// which is also how splot-completion rewards are paid out), breakaway_used.

const ledger_db = new JsoningPg('ba_ledger');
const RECENT_CAP = 300;

async function recordBaEvent({ username, delta, balance, source }) {
  if (!delta) return;
  try {
    await ledger_db.update('totals', (totals) => {
      const all = totals && typeof totals === 'object' ? { ...totals } : {};
      const row = { events: 0, credited: 0, debited: 0, ...(all[source] || {}) };
      row.events += 1;
      if (delta > 0) row.credited += delta;
      else row.debited += -delta;
      all[source] = row;
      return all;
    });
    await ledger_db.update('recent', (recent) => {
      const arr = Array.isArray(recent) ? recent : [];
      arr.unshift({ ts: Date.now(), username, delta, balance, source });
      return arr.slice(0, RECENT_CAP);
    });
  } catch (error) {
    // Stats are best-effort — never let ledger trouble break a purchase or gift.
    console.error('[BA-LEDGER] Failed to record event:', error);
  }
}

async function getBaLedger() {
  const [totals, recent] = await Promise.all([
    ledger_db.get('totals'),
    ledger_db.get('recent'),
  ]);
  return {
    totals: totals && typeof totals === 'object' ? totals : {},
    recent: Array.isArray(recent) ? recent : [],
  };
}

export { recordBaEvent, getBaLedger };
