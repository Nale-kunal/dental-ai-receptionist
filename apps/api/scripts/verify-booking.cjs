const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const client = new Client({ connectionString });

async function verifyBooking() {
  await client.connect();

  const clinicId = '00000000-0000-0000-0000-000000000001';
  const dentistId = '00000000-0000-0000-0000-000000000003'; // Dr. Smith
  const serviceId = '2a9ecbee-5b32-43f4-a673-c119c67ad738'; // Checkup & Exam
  const patientId = '156bbfbe-07c0-49b9-ae23-98ee54fb6105'; // Rahul Sharma
  const startsAt = '2026-10-14T14:00:00.000Z'; // 10:00 AM EDT
  const metadata = {
    source: 'ai-receptionist',
    channel: 'web_chat',
    test_run: true,
    reason: 'Routine dental checkup'
  };

  const bookRes = await client.query(
    'SELECT api.book_appointment($1, $2, $3, $4, $5, $6);',
    [clinicId, dentistId, patientId, serviceId, startsAt, JSON.stringify(metadata)]
  );
  console.log('5. book_appointment result:', JSON.stringify(bookRes.rows[0].book_appointment, null, 2));

  // Check duplicate booking attempt (should return CONFLICT)
  const dupRes = await client.query(
    'SELECT api.book_appointment($1, $2, $3, $4, $5, $6);',
    [clinicId, dentistId, patientId, serviceId, startsAt, JSON.stringify(metadata)]
  );
  console.log('6. duplicate booking attempt:', JSON.stringify(dupRes.rows[0].book_appointment, null, 2));

  await client.end();
}

verifyBooking().catch(err => {
  console.error(err);
  process.exit(1);
});
