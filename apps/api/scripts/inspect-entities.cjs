const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const res = await client.query('SELECT api.search_availability($1, $2, $3, $4, $5);', [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003',
    '2a9ecbee-5b32-43f4-a673-c119c67ad738',
    '2026-10-14',
    10
  ]);
  console.log('Search availability slots for Dr. Smith on 2026-10-14:');
  console.log(JSON.stringify(res.rows[0].search_availability, null, 2));

  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
