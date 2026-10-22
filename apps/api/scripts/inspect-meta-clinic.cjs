const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const res = await client.query('SELECT id, name, slug, timezone, settings FROM api.clinics;');
  console.log('Clinics:');
  for (const c of res.rows) {
    console.log({
      id: c.id,
      name: c.name,
      slug: c.slug,
      timezone: c.timezone,
      whatsapp_phone_number_id: c.settings?.whatsapp_phone_number_id,
      phone_number_id: c.settings?.phone_number_id,
      meta_phone_number_id: c.settings?.meta_phone_number_id,
      settings: c.settings
    });
  }
  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
