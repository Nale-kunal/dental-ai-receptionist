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
    const migrationFile = path.join(__dirname, '../src/database/migrations/003_secure_whatsapp_integration.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    console.log('Applying migration 003_secure_whatsapp_integration.sql (version 1.4.0)...');
    await client.query('BEGIN');
    await client.query(sql);

    await client.query(
      `INSERT INTO api.schema_migrations (version, applied_at, checksum)
       VALUES ('1.4.0', NOW(), $1)
       ON CONFLICT (version) DO UPDATE
       SET applied_at = NOW(), checksum = EXCLUDED.checksum`,
      [checksum]
    );

    await client.query('COMMIT');
    console.log('Migration 1.4.0 applied successfully!');

    // Verification queries
    const tableCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'api' AND table_name = 'clinic_whatsapp_integrations'
      ORDER BY ordinal_position;
    `);
    console.log('\nVerified table api.clinic_whatsapp_integrations:');
    console.table(tableCheck.rows);

    const demoCheck = await client.query(`
      SELECT clinic_id, phone_number_id, enabled, status
      FROM api.clinic_whatsapp_integrations
      WHERE clinic_id = '00000000-0000-0000-0000-000000000001';
    `);
    console.log('\nDemo Clinic Integration Record:');
    console.table(demoCheck.rows);

    const fnCheck = await client.query(`
      SELECT api.get_clinic_by_phone_number_id('1330570960147204') as resolution;
    `);
    console.log('\nVerified Phone Number ID Resolution:');
    console.log(JSON.stringify(fnCheck.rows[0].resolution, null, 2));

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
