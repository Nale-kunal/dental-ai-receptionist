const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const res = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'api' AND table_name = 'dentists'
    ORDER BY ordinal_position;
  `);
  console.log('API.DENTISTS COLUMNS:');
  console.table(res.rows);

  const sample = await client.query(`SELECT * FROM api.dentists LIMIT 2;`);
  console.log('SAMPLE DATA:');
  console.log(JSON.stringify(sample.rows, null, 2));

  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
