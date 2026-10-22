const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function inspect() {
  await client.connect();

  console.log('--- assert_clinic_active ---');
  const act = await client.query(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'assert_clinic_active'`);
  console.log(act.rows[0]?.def);

  console.log('--- APPOINTMENT EXCLUSION CONSTRAINTS ---');
  const excl = await client.query(`
    SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'api.appointments'::regclass;
  `);
  console.log(JSON.stringify(excl.rows, null, 2));

  console.log('--- INBOUND EVENTS CONSTRAINTS ---');
  const inb = await client.query(`
    SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'api.inbound_events'::regclass;
  `);
  console.log(JSON.stringify(inb.rows, null, 2));

  console.log('--- PATIENTS CONSTRAINTS ---');
  const pat = await client.query(`
    SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'api.patients'::regclass;
  `);
  console.log(JSON.stringify(pat.rows, null, 2));

  console.log('--- CONVERSATIONS CONSTRAINTS ---');
  const conv = await client.query(`
    SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'api.conversations'::regclass;
  `);
  console.log(JSON.stringify(conv.rows, null, 2));

  await client.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
