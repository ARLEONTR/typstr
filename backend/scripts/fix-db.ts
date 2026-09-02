import { getDbPool } from '../src/db.js';

async function run() {
  const pool = getDbPool();
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;');
    console.log('Column gemini_api_key added successfully.');
  } catch (e) {
    console.error('Failed to add column:', e);
  } finally {
    process.exit();
  }
}
run();
