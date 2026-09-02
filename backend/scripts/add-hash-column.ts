import { getDbPool } from '../src/db.js';

async function run() {
  const pool = getDbPool();
  try {
    await pool.query('ALTER TABLE project_files ADD COLUMN IF NOT EXISTS last_content_hash TEXT;');
    console.log('Column last_content_hash added successfully.');
  } catch (e) {
    console.error('Failed to add column:', e);
  } finally {
    process.exit();
  }
}
run();
