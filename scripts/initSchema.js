import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sql = fs.readFileSync(path.join(__dirname, '..', 'lib', 'schema.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('schema applied');
} catch (err) {
  console.error('schema failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
