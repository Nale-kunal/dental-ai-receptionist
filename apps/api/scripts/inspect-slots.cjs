const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const res = await client.query("SELECT id, clinic_id, status, confirmation_code, starts_at, ends_at, created_at FROM api.appointments WHERE confirmation_code IN ('DZXV-CUIN', 'BWH1-KZQG');");
  console.log('Appointments check:', res.rows.length, 'found');
  res.rows.forEach(r => console.log(r));
  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
