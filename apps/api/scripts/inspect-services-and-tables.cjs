const { Pool } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const pool = new Pool({ connectionString });

async function run() {
  try {
    const sCols = await pool.query(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='api' AND table_name='services' ORDER BY ordinal_position"
    );
    console.log('SERVICES COLUMNS:');
    console.table(sCols.rows);

    const cCols = await pool.query(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='api' AND table_name='clinics' ORDER BY ordinal_position"
    );
    console.log('CLINICS COLUMNS:');
    console.table(cCols.rows);

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='api' ORDER BY table_name"
    );
    console.log('API TABLES:', tables.rows.map(r => r.table_name));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
