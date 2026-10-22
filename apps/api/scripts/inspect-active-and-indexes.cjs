const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function inspect() {
  await client.connect();

  console.log('=== 1. assert_clinic_active definition ===');
  const act = await client.query(`
    SELECT pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'api' AND p.proname = 'assert_clinic_active';
  `);
  console.log(act.rows[0]?.def);

  console.log('\n=== 2. ALL CONSTRAINTS IN API SCHEMA ===');
  const constraints = await client.query(`
    SELECT 
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      pg_get_constraintdef(c.oid) as definition
    FROM information_schema.table_constraints tc
    JOIN pg_namespace n ON n.nspname = tc.table_schema
    JOIN pg_constraint c ON c.conname = tc.constraint_name
    WHERE tc.table_schema = 'api'
    ORDER BY tc.table_name, tc.constraint_name;
  `);
  console.log(JSON.stringify(constraints.rows, null, 2));

  console.log('\n=== 3. ALL INDEXES IN API SCHEMA ===');
  const indexes = await client.query(`
    SELECT
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'api'
    ORDER BY tablename, indexname;
  `);
  console.log(JSON.stringify(indexes.rows, null, 2));

  console.log('\n=== 4. PERMISSIONS / GRANTS ON FUNCTIONS AND TABLES ===');
  const tablePrivs = await client.query(`
    SELECT table_name, grantee, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'api'
    ORDER BY table_name, grantee;
  `);
  console.log('TABLE PRIVILEGES COUNT:', tablePrivs.rows.length);
  const sampleTablePrivs = tablePrivs.rows.filter(r => ['clinics', 'appointments', 'patients', 'conversations', 'inbound_events'].includes(r.table_name));
  console.log('SAMPLE TABLE PRIVILEGES:', sampleTablePrivs);

  const routinePrivs = await client.query(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'api'
    ORDER BY routine_name, grantee;
  `);
  console.log('ROUTINE PRIVILEGES:', routinePrivs.rows);

  await client.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
