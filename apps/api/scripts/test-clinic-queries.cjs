const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  console.log('Testing Always-1-Row Validate Test Clinic query...');

  const query = `
    SELECT 
      c.id, 
      c.name, 
      c.slug, 
      c.timezone, 
      c.settings,
      COALESCE(c.id IS NOT NULL, false) AS is_valid
    FROM (SELECT 1) AS dummy
    LEFT JOIN api.clinics c
      ON c.id::text = $1
      AND c.id = '00000000-0000-0000-0000-000000000001'::uuid
      AND c.active = true
      AND c.suspended_at IS NULL;
  `;

  // 1. Valid test clinic
  const r1 = await client.query(query, ['00000000-0000-0000-0000-000000000001']);
  console.log('1. Valid Clinic -> rows:', r1.rows.length, 'is_valid:', r1.rows[0].is_valid, 'name:', r1.rows[0].name);

  // 2. Unauthorized clinic
  const r2 = await client.query(query, ['00000000-0000-0000-0000-000000000002']);
  console.log('2. Unauthorized Clinic -> rows:', r2.rows.length, 'is_valid:', r2.rows[0].is_valid, 'id:', r2.rows[0].id);

  // 3. Empty string
  const r3 = await client.query(query, ['']);
  console.log('3. Empty String -> rows:', r3.rows.length, 'is_valid:', r3.rows[0].is_valid);

  // 4. Malformed string
  const r4 = await client.query(query, ['not-a-uuid']);
  console.log('4. Malformed String -> rows:', r4.rows.length, 'is_valid:', r4.rows[0].is_valid);

  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
