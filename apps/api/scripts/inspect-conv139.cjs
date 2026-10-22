const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const conv = await client.query(`
    SELECT c.*, p.full_name, p.phone
    FROM api.conversations c
    LEFT JOIN api.patients p ON p.id = c.patient_id
    WHERE c.id = '139df572-d2c3-4919-a2f6-d87d77c5b419'
  `);
  console.log('CONV_139:', JSON.stringify(conv.rows[0], null, 2));
  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
