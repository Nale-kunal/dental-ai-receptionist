const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const res = await client.query("DELETE FROM api.clinics WHERE email LIKE '%@testisolation.example.com'");
  console.log('Cleaned test clinic rows:', res.rowCount);
  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
