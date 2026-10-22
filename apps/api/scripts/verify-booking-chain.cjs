const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function verifyBookingChain() {
  await client.connect();
  console.log('Connected to Neon DB. Verifying full booking chain functions...');

  const clinicId = '00000000-0000-0000-0000-000000000001';
  const testPhone = '+919876543210';
  const testName = 'Rahul Sharma';

  // 1. Inbound Event Registration
  const eventPayload = {
    clinic_id: clinicId,
    channel: 'web_chat',
    provider: 'test',
    patient_name: testName,
    phone: testPhone,
    message: 'Hello, my name is Rahul Sharma. I want to book a dental appointment on October 14, 2026, at 10:00 AM for a routine dental checkup.',
    intent: 'book_appointment',
    appointmentDate: '2026-10-14',
    appointmentTime: '10:00 AM',
    reason: 'Routine dental checkup',
    provider_event_id: 'hoppscotch-rahul-test-001',
    channel_conversation_id: 'conv-rahul-test-001'
  };

  const regRes = await client.query(
    'SELECT api.register_inbound_event($1, $2, $3, $4, $5, $6);',
    [clinicId, 'test', 'message', 'hoppscotch-rahul-test-001', 'hash-test-001', JSON.stringify(eventPayload)]
  );
  console.log('1. register_inbound_event:', regRes.rows[0].register_inbound_event);

  // 2. Patient lookup/creation
  const patientRes = await client.query(
    'SELECT api.find_or_create_patient($1, $2, $3);',
    [clinicId, testName, testPhone]
  );
  console.log('2. find_or_create_patient:', patientRes.rows[0].find_or_create_patient);
  const patientId = patientRes.rows[0].find_or_create_patient.data.patient_id;

  // 3. Conversation lookup/creation
  const convRes = await client.query(
    'SELECT api.get_or_create_conversation($1, $2, $3, $4);',
    [clinicId, 'web_chat', 'conv-rahul-test-001', patientId]
  );
  console.log('3. get_or_create_conversation:', convRes.rows[0].get_or_create_conversation);

  // 4. Availability Check for Dr. Smith on 2026-10-14
  const dentistId = '00000000-0000-0000-0000-000000000003'; // Dr. Smith
  const serviceId = '2a9ecbee-5b32-43f4-a673-c119c67ad738'; // Checkup & Exam (30m)
  const slotDate = '2026-10-14';

  const availRes = await client.query(
    'SELECT api.search_availability($1, $2, $3, $4, 10);',
    [clinicId, dentistId, serviceId, slotDate]
  );
  console.log('4. search_availability ok:', availRes.rows[0].search_availability.ok, 'found slots:', availRes.rows[0].search_availability.data?.length);

  // Let's test checking if 2026-10-14 10:00 AM EDT (14:00:00Z) is available
  const targetStartsAt = '2026-10-14T14:00:00.000Z';
  const matchingSlot = availRes.rows[0].search_availability.data?.find(s => s.starts_at === '2026-10-14T14:00:00+00:00' || s.starts_at === targetStartsAt);
  console.log('Target 10:00 AM slot available:', !!matchingSlot);

  await client.end();
}

verifyBookingChain().catch(err => {
  console.error(err);
  process.exit(1);
});
