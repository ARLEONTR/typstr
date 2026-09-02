import { getDbPool } from '../src/db.js';

async function run() {
  const pool = getDbPool();
  try {
    await pool.query('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'pending\';');
    await pool.query('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_response TEXT;');
    console.log('Feedback columns added successfully.');
  } catch (e) {
    console.error('Failed to add columns:', e);
  } finally {
    process.exit();
  }
}
run();
