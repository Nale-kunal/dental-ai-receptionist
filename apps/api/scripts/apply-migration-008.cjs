const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '../.env');
const env = fs.readFileSync(envPath, 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const parsedUrl = new URL(connectionString);
console.log('Target Database Identity (Non-Secret):');
console.log(`  Host: ${parsedUrl.hostname}`);
console.log(`  Database: ${parsedUrl.pathname.replace(/^\//, '')}`);
console.log(`  User: ${parsedUrl.username}`);

const pool = new Pool({ connectionString });

async function run() {
  const client = await pool.connect();
  try {
    // 1. Pre-migration safety checks
    const countBefore = await client.query('SELECT count(*) as total FROM api.patients');
    console.log(`\nPatient count before migration: ${countBefore.rows[0].total}`);

    const migrationFile = path.join(__dirname, '../src/database/migrations/008_add_patient_archive_fields.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    console.log('Applying migration 008_add_patient_archive_fields.sql (version 1.7.0) in transaction...');
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

    // 2. Post-migration verification
    const countAfter = await client.query('SELECT count(*) as total FROM api.patients');
    console.log(`Patient count after migration: ${countAfter.rows[0].total}`);
    if (countBefore.rows[0].total !== countAfter.rows[0].total) {
      throw new Error(`CRITICAL: Patient count mismatch! Before: ${countBefore.rows[0].total}, After: ${countAfter.rows[0].total}`);
    }

    const res = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'api' AND table_name = 'patients'
        AND column_name IN ('is_archived', 'archived_at', 'archived_by', 'archive_reason', 'restored_at', 'restored_by')
      ORDER BY column_name;
    `);
    console.log('\nVerified api.patients archive columns:');
    console.table(res.rows);

    const auditTable = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'api' AND table_name = 'patient_audit_events';
    `);
    console.log('Verified api.patient_audit_events table:', auditTable.rows);

    const indexes = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'api'
        AND indexname IN ('patients_clinic_archived_idx', 'patients_archived_at_idx', 'patient_audit_clinic_idx', 'patient_audit_patient_idx')
      ORDER BY indexname;
    `);
    console.log('\nVerified new indexes:');
    console.table(indexes.rows);

    const migrationRow = await client.query("SELECT * FROM api.schema_migrations WHERE version = '1.7.0'");
    console.log('\nVerified schema migration record:');
    console.table(migrationRow.rows);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
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

