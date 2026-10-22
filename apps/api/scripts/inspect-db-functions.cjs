const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function inspect() {
  await client.connect();

  console.log('=== 1. ALL FUNCTIONS IN API SCHEMA ===');
  const funcs = await client.query(`
    SELECT 
      p.proname as name,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as result_type,
      pg_get_userbyid(p.proowner) as owner,
      p.prosecdef as is_security_definer,
      p.proacl as acl,
      p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api'
    ORDER BY p.proname;
  `);

  console.log(JSON.stringify(funcs.rows.map(r => ({
    name: r.name,
    arguments: r.arguments,
    result_type: r.result_type,
    owner: r.owner,
    is_security_definer: r.is_security_definer,
    acl: r.acl
  })), null, 2));

  console.log('\n=== 2. FUNCTION DEFINITIONS ===');
  const targetFunctions = [
    'register_inbound_event',
    'find_or_create_patient',
    'get_or_create_conversation',
    'search_availability',
    'book_appointment',
    'get_clinic_context'
  ];

  for (const row of funcs.rows) {
    if (targetFunctions.includes(row.name)) {
      const defRes = await client.query(`SELECT pg_get_functiondef($1) as def`, [row.oid]);
      console.log(`\n------------------------------------------------------------`);
      console.log(`FUNCTION: api.${row.name}(${row.arguments}) -> ${row.result_type}`);
      console.log(`OWNER: ${row.owner} | SECURITY DEFINER: ${row.is_security_definer}`);
      console.log(`------------------------------------------------------------`);
      console.log(defRes.rows[0].def);
    }
  }

  console.log('\n=== 3. MIGRATION TABLES & APPLIED MIGRATIONS ===');
  const migTables = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_name LIKE '%migrat%' OR table_name LIKE '%schema%';
  `);
  console.log('Migration tables:', migTables.rows);

  for (const t of migTables.rows) {
    const fullTable = `"${t.table_schema}"."${t.table_name}"`;
    try {
      const migRows = await client.query(`SELECT * FROM ${fullTable} LIMIT 50;`);
      console.log(`Rows in ${fullTable}:`, migRows.rows);
    } catch (e) {
      console.log(`Error reading ${fullTable}:`, e.message);
    }
  }

  await client.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
