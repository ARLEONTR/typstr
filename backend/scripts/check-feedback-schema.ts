import { getDbPool } from '../src/db.js';

async function run() {
  const pool = getDbPool();
  try {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'feedback';");
    console.log('Columns in feedback table:', res.rows.map(r => r.column_name));
  } catch (e) {
    console.error('Failed to check schema:', e);
  } finally {
    process.exit();
  }
}
run();
