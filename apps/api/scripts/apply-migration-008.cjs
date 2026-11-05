const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '../.env');
const env = fs.readFileSync(envPath, 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const pool = new Pool({ connectionString });

async function run() {
  const client = await pool.connect();
  try {
    const migrationFile = path.join(__dirname, '../src/database/migrations/008_add_patient_archive_fields.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    console.log('Applying migration 008_add_patient_archive_fields.sql (version 1.7.0)...');
    await client.query('BEGIN');
    await client.query(sql);

    await client.query(
      `INSERT INTO api.schema_migrations (version, applied_at, checksum)
       VALUES ('1.7.0', NOW(), $1)
       ON CONFLICT (version) DO UPDATE
       SET applied_at = NOW(), checksum = EXCLUDED.checksum`,
      [checksum]
    );

    await client.query('COMMIT');
    console.log('Migration 1.7.0 applied successfully!');

    // Verification
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'api' AND table_name = 'patients'
        AND column_name IN ('is_archived', 'archived_at', 'archived_by', 'archive_reason', 'restored_at', 'restored_by')
      ORDER BY column_name;
    `);
    console.log('Verified api.patients archive columns:');
    console.table(res.rows);

    const auditTable = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'api' AND table_name = 'patient_audit_events';
    `);
    console.log('Verified api.patient_audit_events table:', auditTable.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
