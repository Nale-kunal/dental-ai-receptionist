const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const clinicId = '00000000-0000-0000-0000-000000000001';
  const serviceId = '2a9ecbee-5b32-43f4-a673-c119c67ad738'; // checkup (30 min)
  
  // Dr. Smith
  const resSmith = await client.query('SELECT api.search_availability($1, $2, $3, $4, 5);', [
    clinicId, '00000000-0000-0000-0000-000000000003', serviceId, '2026-10-14'
  ]);
  console.log('Dr. Smith slots:', resSmith.rows[0].search_availability.data?.map(s => s.starts_at));

  // Dr. Emily Chen
  const resChen = await client.query('SELECT api.search_availability($1, $2, $3, $4, 5);', [
    clinicId, '00000000-0000-0000-0000-000000000004', serviceId, '2026-10-14'
  ]);
  console.log('Dr. Emily Chen slots:', resChen.rows[0].search_availability.data?.map(s => s.starts_at));

  // October 15, 2026 (Thursday)
  const resSmithThu = await client.query('SELECT api.search_availability($1, $2, $3, $4, 5);', [
    clinicId, '00000000-0000-0000-0000-000000000003', serviceId, '2026-10-15'
  ]);
  console.log('Dr. Smith Oct 15 slots:', resSmithThu.rows[0].search_availability.data?.map(s => s.starts_at));

  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
