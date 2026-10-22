/**
 * Read-Only Database Schema Discovery & Inventory Script
 * 
 * Safely inspects the existing Neon PostgreSQL database:
 * - Schemas, tables, columns, types, defaults, nullability
 * - Primary keys, foreign keys, constraints, indexes
 * - Enums and custom types
 * - Stored functions and procedures (especially api.* used by n8n)
 * - Row counts
 * 
 * NEVER prints credentials or connection strings.
 * Executes ONLY read-only queries.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Load .env if present
function loadEnv() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/api/.env'),
    path.resolve(__dirname, '../.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

// Mask connection string for safety
const maskedUrl = connectionString.replace(/:([^:@]+)@/, ':****@');
console.log(`Connecting read-only to: ${maskedUrl}`);

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function runDiscovery() {
  await client.connect();
  console.log('Connected successfully. Starting read-only schema discovery...\n');

  // 1. Schemas
  const schemasRes = await client.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
    ORDER BY schema_name;
  `);
  const schemas = schemasRes.rows.map((r: any) => r.schema_name);
  console.log('Discovered Schemas:', schemas);

  // 2. Tables & Views
  const tablesRes = await client.query(`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY table_schema, table_name;
  `);

  console.log(`\nFound ${tablesRes.rows.length} tables/views:`);
  for (const row of tablesRes.rows) {
    console.log(`  - [${row.table_schema}] ${row.table_name} (${row.table_type})`);
  }

  // 3. Columns for each table
  const columnsRes = await client.query(`
    SELECT 
      table_schema, 
      table_name, 
      column_name, 
      ordinal_position,
      column_default, 
      is_nullable, 
      data_type, 
      udt_name,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY table_schema, table_name, ordinal_position;
  `);

  // 4. Primary Keys & Foreign Keys
  const constraintsRes = await client.query(`
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY tc.table_schema, tc.table_name, tc.constraint_type;
  `);

  // 5. Indexes
  const indexesRes = await client.query(`
    SELECT
      schemaname,
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
    ORDER BY schemaname, tablename, indexname;
  `);

  // 6. Enums / Custom Types
  const enumsRes = await client.query(`
    SELECT
      n.nspname AS schema_name,
      t.typname AS enum_name,
      e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
    ORDER BY schema_name, enum_name, e.enumsortorder;
  `);

  // 7. Functions & Stored Procedures (specifically in 'api' and 'public')
  const routinesRes = await client.query(`
    SELECT 
      n.nspname AS routine_schema,
      p.proname AS routine_name,
      pg_get_function_result(p.oid) AS return_type,
      pg_get_function_arguments(p.oid) AS argument_list,
      CASE 
        WHEN p.prokind = 'p' THEN 'PROCEDURE'
        WHEN p.prokind = 'a' THEN 'AGGREGATE'
        WHEN p.prokind = 'w' THEN 'WINDOW'
        ELSE 'FUNCTION'
      END AS routine_type,
      CASE 
        WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid)
        ELSE NULL
      END AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname IN ('api', 'public')
    ORDER BY n.nspname, p.proname;
  `);

  console.log(`\nFound ${routinesRes.rows.length} functions/routines:`);
  for (const r of routinesRes.rows) {
    console.log(`  - ${r.routine_schema}.${r.routine_name}(${r.argument_list}) -> ${r.return_type}`);
  }

  // 8. Triggers
  const triggersRes = await client.query(`
    SELECT 
      trigger_schema,
      event_object_table,
      trigger_name,
      event_manipulation,
      action_statement,
      action_timing
    FROM information_schema.triggers
    WHERE trigger_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY trigger_schema, event_object_table, trigger_name;
  `);

  // 9. Table Row Counts (Read-only count)
  console.log('\nChecking row counts:');
  const tableCounts: Record<string, number> = {};
  for (const row of tablesRes.rows) {
    if (row.table_type === 'BASE TABLE') {
      try {
        const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM "${row.table_schema}"."${row.table_name}"`);
        const count = countRes.rows[0].count;
        tableCounts[`${row.table_schema}.${row.table_name}`] = count;
        console.log(`  - ${row.table_schema}.${row.table_name}: ${count} rows`);
      } catch (err: any) {
        console.log(`  - ${row.table_schema}.${row.table_name}: error reading count (${err.message})`);
      }
    }
  }

  // Compile full report
  const discoveryReport = {
    timestamp: new Date().toISOString(),
    schemas,
    tables: tablesRes.rows,
    tableCounts,
    columns: columnsRes.rows,
    constraints: constraintsRes.rows,
    indexes: indexesRes.rows,
    enums: enumsRes.rows,
    routines: routinesRes.rows.map((r: any) => ({
      schema: r.routine_schema,
      name: r.routine_name,
      type: r.routine_type,
      return_type: r.return_type,
      arguments: r.argument_list,
      definition: r.definition,
    })),
    triggers: triggersRes.rows,
  };

  const outputPath = path.resolve(__dirname, 'schema-discovery-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(discoveryReport, null, 2), 'utf-8');
  console.log(`\nDetailed discovery report written to: ${outputPath}`);

  await client.end();
  console.log('Discovery completed successfully.');
}

runDiscovery().catch((err) => {
  console.error('Discovery failed:', err.message);
  process.exit(1);
});
