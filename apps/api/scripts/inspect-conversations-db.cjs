const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/['"]/g, '').trim();

const client = new Client({ connectionString });

async function run() {
  await client.connect();

  const columns = await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'api' AND table_name IN ('conversations', 'messages')
    ORDER BY table_name, ordinal_position;
  `);
  console.log('--- COLUMNS ---');
  console.log(JSON.stringify(columns.rows, null, 2));

  const constraints = await client.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'api' AND tc.table_name IN ('conversations', 'messages')
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
  `);
  console.log('--- CONSTRAINTS ---');
  console.log(JSON.stringify(constraints.rows, null, 2));

  const indexes = await client.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'api' AND tablename IN ('conversations', 'messages');
  `);
  console.log('--- INDEXES ---');
  console.log(JSON.stringify(indexes.rows, null, 2));

  const params = await client.query(`
    SELECT parameter_name, data_type, udt_name, ordinal_position
    FROM information_schema.parameters
    WHERE specific_schema = 'api' AND specific_name LIKE 'create_handoff%'
    ORDER BY ordinal_position;
  `);
  console.log('--- CREATE HANDOFF PARAMS ---');
  console.log(JSON.stringify(params.rows, null, 2));

  await client.end();
}

run().catch(console.error);
