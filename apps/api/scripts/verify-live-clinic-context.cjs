const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = path.resolve(__dirname, '../../../apps/api/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
if (!dbUrlMatch) {
  console.error('DATABASE_URL not found');
  process.exit(1);
}

const client = new Client({ connectionString: dbUrlMatch[1] });

async function verifyClinicContext() {
  await client.connect();
  const clinicId = '914fb00e-c834-4e44-9646-9d746f536d4e';
  const res = await client.query('SELECT settings FROM api.clinics WHERE id = $1::uuid', [clinicId]);
  console.log('--- FULL SETTINGS FOR ORACLE CLINIC ---');
  console.log(JSON.stringify(res.rows[0]?.settings, null, 2));
  await client.end();
}

verifyClinicContext().catch(e => {
  console.error(e);
  process.exit(1);
});
