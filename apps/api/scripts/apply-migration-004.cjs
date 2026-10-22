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
    const migrationFile = path.join(__dirname, '../src/database/migrations/004_add_unvalidated_status.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    console.log('Applying migration 004_add_unvalidated_status.sql (version 1.5.0)...');
    await client.query('BEGIN');
    await client.query(sql);

    await client.query(
      `INSERT INTO api.schema_migrations (version, applied_at, checksum)
       VALUES ('1.5.0', NOW(), $1)
       ON CONFLICT (version) DO UPDATE
       SET applied_at = NOW(), checksum = EXCLUDED.checksum`,
      [checksum]
    );

    await client.query('COMMIT');
    console.log('Migration 1.5.0 applied successfully!');

    // Verification
    const res = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'clinic_whatsapp_integrations_status_check';
    `);
    console.log('Verified updated constraint:');
    console.table(res.rows);

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
