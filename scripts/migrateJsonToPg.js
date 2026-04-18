/**
 * One-shot migration: reads every db/*.json file and UPSERTs the rows
 * into kv_store. Idempotent — re-run any time to re-sync a local
 * snapshot into Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrateJsonToPg.js
 *
 * Flags:
 *   --dry    Print what would happen, don't write.
 *   --dir=path   Alternate source directory (defaults to ./db).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const dirArg = args.find((a) => a.startsWith('--dir='));
const sourceDir = dirArg
  ? path.resolve(dirArg.slice('--dir='.length))
  : path.resolve(__dirname, '..', 'db');

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Source dir not found: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

async function upsertRow(ns, key, value) {
  await pool.query(
    `INSERT INTO kv_store (namespace, key, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (namespace, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [ns, String(key), JSON.stringify(value ?? null)],
  );
}

async function migrateFile(file) {
  const ns = path.basename(file, '.json');
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) {
    console.log(`  ${ns}: empty file, skipping`);
    return 0;
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (err) {
    console.warn(`  ${ns}: invalid JSON, skipping (${err.message})`);
    return 0;
  }

  // jsoning stores a top-level object whose keys are the user keys.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    console.warn(`  ${ns}: expected object, got ${Array.isArray(data) ? 'array' : typeof data}, skipping`);
    return 0;
  }

  const keys = Object.keys(data);
  if (keys.length === 0) {
    console.log(`  ${ns}: no keys, skipping`);
    return 0;
  }

  if (dry) {
    console.log(`  ${ns}: ${keys.length} key(s) (dry run)`);
    return keys.length;
  }

  for (const k of keys) {
    await upsertRow(ns, k, data[k]);
  }
  console.log(`  ${ns}: ${keys.length} key(s) upserted`);
  return keys.length;
}

async function main() {
  console.log(`migrating from ${sourceDir}${dry ? ' (dry run)' : ''}`);
  const files = listJsonFiles(sourceDir);
  if (files.length === 0) {
    console.log('no .json files found');
    return;
  }
  let totalKeys = 0;
  let totalFiles = 0;
  for (const file of files) {
    const name = path.basename(file);
    console.log(`\n${name}`);
    const n = await migrateFile(file);
    if (n > 0) totalFiles += 1;
    totalKeys += n;
  }
  console.log(`\n${dry ? 'would write' : 'wrote'} ${totalKeys} key(s) across ${totalFiles} namespace(s)`);
}

try {
  await main();
} catch (err) {
  console.error('migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
