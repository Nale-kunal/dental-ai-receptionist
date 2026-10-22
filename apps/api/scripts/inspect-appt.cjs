const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const res = await client.query(
    'SELECT id, clinic_id, confirmation_code, starts_at, ends_at, status, created_at, updated_at FROM api.appointments WHERE confirmation_code = $1',
    ['DZXV-CUIN']
  );
  console.log('APPOINTMENT_RECORD:', JSON.stringify(res.rows[0], null, 2));
  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
