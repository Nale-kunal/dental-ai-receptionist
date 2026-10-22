const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const pool = new Pool({ connectionString });

async function run() {
  const client = await pool.connect();
  try {
    const migrationFile = path.join(__dirname, '../src/database/migrations/002_add_services_pricing_and_holiday_overrides.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    console.log('Applying migration 002_add_services_pricing_and_holiday_overrides.sql...');
    await client.query('BEGIN');
    await client.query(sql);

    // Record in schema_migrations if not already recorded
    await client.query(
      `INSERT INTO api.schema_migrations (version, applied_at, checksum)
       VALUES ('1.3.0', NOW(), $1)
       ON CONFLICT (version) DO NOTHING`,
      [checksum]
    );

    await client.query('COMMIT');
    console.log('Migration 1.3.0 applied successfully!');

    // Verify
    const sCols = await client.query(
      "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='api' AND table_name='services' ORDER BY ordinal_position"
    );
    console.log('Updated services columns:');
    console.table(sCols.rows);

    const hCols = await client.query(
      "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='api' AND table_name='clinic_holiday_overrides' ORDER BY ordinal_position"
    );
    console.log('clinic_holiday_overrides columns:');
    console.table(hCols.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
