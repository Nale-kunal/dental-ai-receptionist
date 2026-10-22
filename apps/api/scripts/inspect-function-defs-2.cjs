const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function inspect() {
  await client.connect();

  const targetFunctions = [
    'assert_clinic_active',
    'find_or_create_patient',
    'book_appointment',
    'get_clinic_context'
  ];

  for (const name of targetFunctions) {
    const q = await client.query(`
      SELECT p.proname, pg_get_function_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def,
             pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'api' AND p.proname = $1;
    `, [name]);

    for (const row of q.rows) {
      console.log(`\n============================================================`);
      console.log(`FUNCTION: api.${row.proname}(${row.args})`);
      console.log(`OWNER: ${row.owner} | SECDEF: ${row.secdef}`);
      console.log(`============================================================`);
      console.log(row.def);
    }
  }

  await client.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
