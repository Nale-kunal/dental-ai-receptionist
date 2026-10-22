const { Pool } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const pool = new Pool({
  connectionString
});

async function run() {
  try {
    const r = await pool.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name LIKE '%migrat%'");
    console.log('Migration tables:', r.rows);
    for (const row of r.rows) {
      const data = await pool.query(`SELECT * FROM ${row.table_schema}.${row.table_name} LIMIT 10`);
      console.log(`Data from ${row.table_schema}.${row.table_name}:`, data.rows);
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
