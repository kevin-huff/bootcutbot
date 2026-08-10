import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Mirrors prod kv_store into this environment's database. Reads prod
// exactly once (read-only) and replaces the local copy atomically, so a
// mid-sync reader never sees a half-synced store.

const sourceUrl = process.env.PROD_DATABASE_URL;
const targetUrl = process.env.DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error('downsync: PROD_DATABASE_URL and DATABASE_URL must both be set');
  process.exit(1);
}

const host = (u) => new URL(u).host;
if (host(sourceUrl) === host(targetUrl)) {
  console.error('downsync: source and target are the same database — refusing to run');
  process.exit(1);
}

const source = new pg.Client({
  connectionString: sourceUrl,
  ssl: { rejectUnauthorized: false },
  application_name: 'bootcut-downsync-read',
  statement_timeout: 30_000,
  connectionTimeoutMillis: 15_000,
});
const target = new pg.Client({
  connectionString: targetUrl,
  ssl: /\brailway\.(app|internal)\b|sslmode=require/i.test(targetUrl) ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
});

await source.connect();
const { rows } = await source.query('SELECT namespace, key, value FROM kv_store');
await source.end();
console.log(`downsync: read ${rows.length} rows from prod`);

await target.connect();
try {
  await target.query('BEGIN');
  await target.query('DELETE FROM kv_store');
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const params = [];
    const values = batch.map((r, j) => {
      params.push(r.namespace, r.key, JSON.stringify(r.value));
      return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::jsonb, now())`;
    });
    await target.query(
      `INSERT INTO kv_store (namespace, key, value, updated_at) VALUES ${values.join(',')}`,
      params,
    );
  }
  await target.query('COMMIT');
} catch (err) {
  try { await target.query('ROLLBACK'); } catch (_) {}
  throw err;
} finally {
  await target.end();
}

console.log(`downsync: mirrored ${rows.length} rows into staging`);
