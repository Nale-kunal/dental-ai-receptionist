const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function runTests() {
  await client.connect();
  console.log('Connected to Neon PostgreSQL for Function Behavior Diagnostics (Transactions will ROLLBACK)');

  const validClinicId = '00000000-0000-0000-0000-000000000001';
  const fakeClinicId = '00000000-0000-0000-0000-999999999999';
  const dentistId = '00000000-0000-0000-0000-000000000003';
  const serviceId = '2a9ecbee-5b32-43f4-a673-c119c67ad738';

  // --- Test 1: assert_clinic_active behavior ---
  console.log('\n--- 1. assert_clinic_active Behavior ---');
  try {
    await client.query('SELECT api.assert_clinic_active($1::uuid)', [validClinicId]);
    console.log('Valid clinic: OK (No exception)');
  } catch (e) {
    console.log('Valid clinic error:', e.message);
  }

  try {
    await client.query('SELECT api.assert_clinic_active($1::uuid)', [fakeClinicId]);
    console.log('Fake clinic: FAILED (Expected exception)');
  } catch (e) {
    console.log('Fake clinic correctly raised exception:', e.message, 'Code:', e.code);
  }

  try {
    await client.query('SELECT api.assert_clinic_active(NULL::uuid)');
    console.log('NULL clinic: FAILED (Expected exception)');
  } catch (e) {
    console.log('NULL clinic correctly raised exception:', e.message, 'Code:', e.code);
  }

  // --- Test 2: Suspended Clinic Behavior across Functions with SAVEPOINTs ---
  console.log('\n--- 2. Suspended Clinic Behavior across Functions ---');
  await client.query('BEGIN;');
  try {
    const suspendedRes = await client.query(`
      INSERT INTO api.clinics (id, name, slug, timezone, active, suspended_at)
      VALUES (gen_random_uuid(), 'Suspended Clinic', 'suspended-test', 'America/New_York', true, NOW())
      RETURNING id;
    `);
    const suspId = suspendedRes.rows[0].id;

    // A. assert_clinic_active on suspended
    await client.query('SAVEPOINT sp_act;');
    try {
      await client.query('SELECT api.assert_clinic_active($1::uuid)', [suspId]);
      console.log('ERROR: Suspended clinic was not rejected by assert_clinic_active!');
    } catch (e) {
      console.log('SUCCESS: assert_clinic_active rejected suspended clinic with code:', e.code, e.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_act;');

    // B. find_or_create_patient on suspended
    await client.query('SAVEPOINT sp_pat;');
    try {
      await client.query('SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text)', [suspId, 'Test Patient', '+15559990001']);
      console.log('ERROR: find_or_create_patient did not reject suspended clinic!');
    } catch (e) {
      console.log('SUCCESS: find_or_create_patient rejected suspended clinic with:', e.code, e.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_pat;');

    // C. get_or_create_conversation on suspended
    await client.query('SAVEPOINT sp_conv;');
    try {
      await client.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text)', [suspId, 'web_chat', 'test-conv']);
      console.log('ERROR: get_or_create_conversation did not reject suspended clinic!');
    } catch (e) {
      console.log('SUCCESS: get_or_create_conversation rejected suspended clinic with:', e.code, e.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_conv;');

    // D. search_availability on suspended
    await client.query('SAVEPOINT sp_avail;');
    try {
      await client.query('SELECT api.search_availability($1::uuid, $2::uuid, $3::uuid, $4::date)', [suspId, dentistId, serviceId, '2026-10-15']);
      console.log('ERROR: search_availability did not reject suspended clinic!');
    } catch (e) {
      console.log('SUCCESS: search_availability rejected suspended clinic with:', e.code, e.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_avail;');

    // E. book_appointment on suspended
    await client.query('SAVEPOINT sp_book;');
    try {
      await client.query('SELECT api.book_appointment($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz)', [suspId, dentistId, dentistId, serviceId, '2026-10-15T14:00:00Z']);
      console.log('ERROR: book_appointment did not reject suspended clinic!');
    } catch (e) {
      console.log('SUCCESS: book_appointment rejected suspended clinic with:', e.code, e.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_book;');

    // F. register_inbound_event on suspended
    await client.query('SAVEPOINT sp_reg;');
    try {
      const regRes = await client.query('SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as res', [
        suspId, 'test', 'message', 'susp-event-001', 'hash001', JSON.stringify({ test: true })
      ]);
      console.log('NOTE: register_inbound_event on suspended clinic result:', regRes.rows[0].res);
    } catch (e) {
      console.log('register_inbound_event rejected suspended clinic with:', e.code, e.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT sp_reg;');

    // G. get_clinic_context on suspended
    await client.query('SAVEPOINT sp_ctx;');
    const ctxRes = await client.query('SELECT api.get_clinic_context($1::uuid) as res', [suspId]);
    console.log('NOTE: get_clinic_context on suspended clinic returned:', ctxRes.rows[0].res);
    await client.query('ROLLBACK TO SAVEPOINT sp_ctx;');

  } finally {
    await client.query('ROLLBACK;');
    console.log('Suspended clinic transaction ROLLED BACK cleanly.');
  }

  // --- Test 3: find_or_create_patient Parameter Ordering & Resolution ---
  console.log('\n--- 3. find_or_create_patient Parameter Ordering & Resolution ---');
  await client.query('BEGIN;');
  try {
    const p1 = await client.query(`
      SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as res;
    `, [validClinicId, 'Audit Test Patient Alpha', '+15557770001']);
    console.log('Patient creation result:', p1.rows[0].res);

    const patId = p1.rows[0].res.data.patient_id;
    const checkPat = await client.query('SELECT id, full_name, phone, whatsapp_id FROM api.patients WHERE id = $1', [patId]);
    console.log('Stored patient row:', checkPat.rows[0]);

    const p2 = await client.query(`
      SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as res;
    `, [validClinicId, 'Audit Test Patient Alpha Updated', '+15557770001']);
    console.log('Patient lookup result (existing):', p2.rows[0].res);

    const pNull = await client.query(`
      SELECT api.find_or_create_patient($1::uuid, $2::text, NULL, NULL, NULL) as res;
    `, [validClinicId, 'No Contact Patient']);
    console.log('Patient with NULL contact info returned:', pNull.rows[0].res);

  } finally {
    await client.query('ROLLBACK;');
    console.log('Patient transaction ROLLED BACK cleanly.');
  }

  // --- Test 4: register_inbound_event Idempotency & Duplicate Behavior ---
  console.log('\n--- 4. register_inbound_event Idempotency ---');
  await client.query('BEGIN;');
  try {
    const ev1 = await client.query(`
      SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as res;
    `, [validClinicId, 'test-audit', 'message', 'audit-event-1001', 'hash-1001', JSON.stringify({ audit: true })]);
    console.log('First event register result:', ev1.rows[0].res);

    const ev2 = await client.query(`
      SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as res;
    `, [validClinicId, 'test-audit', 'message', 'audit-event-1001', 'hash-1001', JSON.stringify({ audit: true })]);
    console.log('Second event register result (duplicate replay):', ev2.rows[0].res);

  } finally {
    await client.query('ROLLBACK;');
    console.log('Inbound event transaction ROLLED BACK cleanly.');
  }

  // --- Test 5: Concurrency & Exclusion Violation in book_appointment ---
  console.log('\n--- 5. Concurrency & Slot Overlap in book_appointment ---');
  await client.query('BEGIN;');
  try {
    const patRes = await client.query(`
      INSERT INTO api.patients (clinic_id, full_name, phone)
      VALUES ($1::uuid, 'Audit Concurrency Patient', '+15558880001')
      RETURNING id;
    `, [validClinicId]);
    const testPatId = patRes.rows[0].id;

    // Slot at 11:00 AM on 2026-10-15 (15:00 UTC)
    const slotTime = '2026-10-15T15:00:00Z';
    const b1 = await client.query(`
      SELECT api.book_appointment($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz) as res;
    `, [validClinicId, dentistId, testPatId, serviceId, slotTime]);
    console.log('First booking result:', b1.rows[0].res);

    // Attempt second booking for SAME dentist at SAME slotTime (Overlap!)
    const b2 = await client.query(`
      SELECT api.book_appointment($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz) as res;
    `, [validClinicId, dentistId, testPatId, serviceId, slotTime]);
    console.log('Second booking attempt (Conflict):', b2.rows[0].res);

    // Attempt booking in the past
    const bPast = await client.query(`
      SELECT api.book_appointment($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz) as res;
    `, [validClinicId, dentistId, testPatId, serviceId, '2020-01-01T15:00:00Z']);
    console.log('Past booking attempt:', bPast.rows[0].res);

  } finally {
    await client.query('ROLLBACK;');
    console.log('Booking concurrency transaction ROLLED BACK cleanly.');
  }

  await client.end();
}

runTests().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
