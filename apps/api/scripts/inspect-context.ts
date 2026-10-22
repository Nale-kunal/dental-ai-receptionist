import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
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
        process.env[key] = val;
      }
    }
  }
}

loadEnv();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();

  const clinicsRes = await client.query('SELECT api.list_clinics()');
  console.log('Clinics:', JSON.stringify(clinicsRes.rows[0].list_clinics, null, 2));

  const usersRes = await client.query('SELECT id, clinic_id, auth_subject, full_name, email, role, active FROM api.users');
  console.log('\nUsers:', usersRes.rows);

  const dentistsRes = await client.query('SELECT id, clinic_id, display_name, specialty, active FROM api.dentists');
  console.log('\nDentists:', dentistsRes.rows);

  const servicesRes = await client.query('SELECT id, clinic_id, code, name, duration_minutes, buffer_minutes, active FROM api.services');
  console.log('\nServices:', servicesRes.rows);

  const clinicContextRes = await client.query('SELECT api.get_clinic_context($1)', [clinicsRes.rows[0].list_clinics[0]?.id]);
  console.log('\nClinic Context for First Clinic:', JSON.stringify(clinicContextRes.rows[0]?.get_clinic_context, null, 2));

  await client.end();
}

run().catch(console.error);
