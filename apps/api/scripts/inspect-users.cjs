const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });
client.connect().then(async () => {
  const cols = await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'api' AND table_name = 'users'");
  console.log('USERS_COLUMNS:', cols.rows);
  const users = await client.query('SELECT id, clinic_id, auth_subject, full_name, email, role, active, created_at FROM api.users');
  console.log('EXISTING_USERS:', users.rows);
  const constraints = await client.query("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'api.users'::regclass");
  console.log('CONSTRAINTS:', constraints.rows);
  await client.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
