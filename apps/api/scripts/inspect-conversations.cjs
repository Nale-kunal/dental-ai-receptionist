const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const convs = await client.query(`
    SELECT c.id, c.clinic_id, c.patient_id, c.channel, c.channel_conversation_id, p.full_name, p.phone
    FROM api.conversations c
    LEFT JOIN api.patients p ON p.id = c.patient_id
    LIMIT 20
  `);
  console.log('CONVERSATIONS_COUNT:', convs.rows.length);
  console.log('CONVERSATIONS_SAMPLE:', JSON.stringify(convs.rows, null, 2));

  const messages = await client.query(`
    SELECT id, clinic_id, conversation_id, direction, kind, body, provider_payload, created_at
    FROM api.messages
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('MESSAGES_COUNT:', messages.rows.length);
  console.log('MESSAGES_SAMPLE:', JSON.stringify(messages.rows, null, 2));

  // Check tables related to contacts or webhooks
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'api'
  `);
  console.log('API_TABLES:', tables.rows.map(r => r.table_name));

  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
