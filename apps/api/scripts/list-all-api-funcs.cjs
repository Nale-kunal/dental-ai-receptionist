const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function inspect() {
  await client.connect();

  const q = await client.query(`
    SELECT p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api'
    ORDER BY p.proname, args;
  `);

  console.log('ALL API FUNCTIONS:');
  for (const r of q.rows) {
    console.log(`- api.${r.proname}(${r.args}) -> ${r.res}`);
  }

  await client.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
