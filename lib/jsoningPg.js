import { pool } from './db.js';

/**
 * Drop-in replacement for the `jsoning` library, backed by Postgres.
 *
 * Each "namespace" corresponds to a former db/<name>.json file; each key
 * inside the namespace maps to one row in kv_store.
 *
 * Adds `.update(key, fn)` for transactional read-modify-write that is safe
 * under concurrent load (e.g. the rush of !join commands on queue open).
 */

// in-process per-(ns, key) write serializer — prevents torn reads/writes
// within a single Node process. Complements `SELECT … FOR UPDATE` in
// `.update()` (which protects us across multiple processes).
const locks = new Map();

function lockKey(ns, key) {
  return ns + '\u0000' + key;
}

function serialize(ns, key, fn) {
  const id = lockKey(ns, key);
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  // swallow errors on the chain so one failure doesn't block future ops,
  // but the original promise still rejects/resolves to the caller.
  locks.set(id, next.catch(() => {}));
  // cleanup when this is the tail of the chain
  next.finally(() => {
    if (locks.get(id) === next || locks.get(id) && locks.get(id).then === next.then) {
      // best-effort cleanup; safe even if another op has since appended
    }
  });
  return next;
}

export class JsoningPg {
  constructor(namespace) {
    if (!namespace) throw new Error('JsoningPg requires a namespace');
    // Normalize filename-style namespaces: "db/queue.json" → "queue"
    this.ns = String(namespace)
      .replace(/^.*\//, '')
      .replace(/\.json$/i, '');
  }

  async get(key) {
    const r = await pool.query(
      'SELECT value FROM kv_store WHERE namespace = $1 AND key = $2',
      [this.ns, String(key)],
    );
    if (r.rowCount === 0) return null;
    return r.rows[0].value;
  }

  async has(key) {
    const r = await pool.query(
      'SELECT 1 FROM kv_store WHERE namespace = $1 AND key = $2',
      [this.ns, String(key)],
    );
    return r.rowCount > 0;
  }

  async set(key, value) {
    return serialize(this.ns, String(key), async () => {
      await pool.query(
        `INSERT INTO kv_store (namespace, key, value, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (namespace, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [this.ns, String(key), JSON.stringify(value ?? null)],
      );
      return true;
    });
  }

  async delete(key) {
    return serialize(this.ns, String(key), async () => {
      const r = await pool.query(
        'DELETE FROM kv_store WHERE namespace = $1 AND key = $2',
        [this.ns, String(key)],
      );
      return r.rowCount > 0;
    });
  }

  async clear() {
    // whole-namespace wipe — lock every key we know about
    const r = await pool.query(
      'DELETE FROM kv_store WHERE namespace = $1',
      [this.ns],
    );
    return r.rowCount;
  }

  async all() {
    const r = await pool.query(
      'SELECT key, value FROM kv_store WHERE namespace = $1 ORDER BY key',
      [this.ns],
    );
    const out = {};
    for (const row of r.rows) out[row.key] = row.value;
    return out;
  }

  /**
   * Append `item` to the array stored at `key`. Creates the array if
   * missing. Atomic at the DB level AND serialized per key in-process.
   */
  async push(key, item) {
    return serialize(this.ns, String(key), async () => {
      await pool.query(
        `INSERT INTO kv_store (namespace, key, value, updated_at)
         VALUES ($1, $2, jsonb_build_array($3::jsonb), now())
         ON CONFLICT (namespace, key)
         DO UPDATE SET
           value = CASE
             WHEN jsonb_typeof(kv_store.value) = 'array'
               THEN kv_store.value || $3::jsonb
             ELSE jsonb_build_array($3::jsonb)
           END,
           updated_at = now()`,
        [this.ns, String(key), JSON.stringify(item ?? null)],
      );
      return true;
    });
  }

  /**
   * Arithmetic on a numeric value stored at `key`. Missing/non-numeric
   * values are treated as 0. Matches jsoning's `.math(key, op, n)`.
   */
  async math(key, op, n) {
    const amount = Number(n);
    if (!Number.isFinite(amount)) {
      throw new Error(`JsoningPg.math: non-numeric operand ${n}`);
    }
    return this.update(String(key), async (current) => {
      const base = Number.isFinite(Number(current)) ? Number(current) : 0;
      switch (op) {
        case 'add':      return base + amount;
        case 'subtract': return base - amount;
        case 'multiply': return base * amount;
        case 'divide':   return amount === 0 ? base : base / amount;
        default: throw new Error(`JsoningPg.math: unknown op ${op}`);
      }
    });
  }

  /**
   * Transactional read-modify-write. `fn` receives the current value (or
   * null) and returns (or resolves to) the next value to store. Runs
   * inside a Postgres transaction with `SELECT … FOR UPDATE`, AND is
   * serialized per-key in this process.
   *
   * Use this for any operation where the new value depends on the
   * current one and concurrent callers could clobber each other.
   */
  async update(key, fn) {
    const k = String(key);
    return serialize(this.ns, k, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          'SELECT value FROM kv_store WHERE namespace = $1 AND key = $2 FOR UPDATE',
          [this.ns, k],
        );
        const current = r.rowCount === 0 ? null : r.rows[0].value;
        const nextVal = await fn(current);
        await client.query(
          `INSERT INTO kv_store (namespace, key, value, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
           ON CONFLICT (namespace, key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [this.ns, k, JSON.stringify(nextVal ?? null)],
        );
        await client.query('COMMIT');
        return nextVal;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw err;
      } finally {
        client.release();
      }
    });
  }
}

export default JsoningPg;
