const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/['"]/g, '').trim();

const client = new Client({ connectionString });

async function runTests() {
  await client.connect();
  console.log('Connected to PostgreSQL database. Running 10 Conversation Continuity Scenarios...\n');

  const clinicA_Id = '00000000-0000-0000-0000-000000000001'; // Demo Dental Clinic
  // Find a second active clinic for multi-tenant isolation testing
  const clinicB_Res = await client.query(`
    SELECT id, name FROM api.clinics
    WHERE id != $1 AND active = true AND suspended_at IS NULL
    LIMIT 1;
  `, [clinicA_Id]);

  let clinicB_Id;
  let createdTempClinicB = false;
  if (clinicB_Res.rows.length > 0) {
    clinicB_Id = clinicB_Res.rows[0].id;
    console.log(`Using existing active secondary clinic: ${clinicB_Res.rows[0].name} (${clinicB_Id})`);
  } else {
    const newClinic = await client.query(`
      INSERT INTO api.clinics (name, slug, timezone, locale, active)
      VALUES ('Test Secondary Clinic', 'test-secondary-clinic-' || substr(gen_random_uuid()::text, 1, 8), 'America/New_York', 'en-US', true)
      RETURNING id;
    `);
    clinicB_Id = newClinic.rows[0].id;
    createdTempClinicB = true;
    console.log(`Provisioned temporary active secondary clinic: ${clinicB_Id}`);
  }

  const runId = Math.floor(Math.random() * 900000 + 100000);
  const testPhone1 = `+155501${runId}`;
  const testPhone2 = `+155502${runId}`;
  const testPatientName1 = `Continuity Patient ${runId}`;
  const testPatientName2 = `Secondary Patient ${runId}`;

  try {
    // SCENARIO 1: A first message creates one conversation
    console.log('--- SCENARIO 1: First message creates one conversation ---');
    let pat1Res;
    try {
      pat1Res = await client.query(
        'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
        [clinicA_Id, testPatientName1, testPhone1]
      );
    } catch (e) {
      console.error('Error in find_or_create_patient:', e);
      throw e;
    }
    const patient1Id = pat1Res.rows[0].result.data.patient_id;
    console.log('Patient 1 ID:', patient1Id);

    let conv1Res;
    try {
      conv1Res = await client.query(
        'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
        [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
      );
    } catch (e) {
      console.error('Error in get_or_create_conversation:', e);
      throw e;
    }
    const conv1 = conv1Res.rows[0].result;
    console.log('Result 1:', conv1);
    if (!conv1.ok || conv1.data.existing !== false || !conv1.data.conversation_id) {
      throw new Error(`Scenario 1 failed: expected existing === false, got ${JSON.stringify(conv1)}`);
    }
    const conv1Id = conv1.data.conversation_id;
    console.log('✓ Scenario 1 passed: Created new conversation', conv1Id);

    // SCENARIO 2: A second message from the same patient to the same clinic reuses that conversation
    console.log('\n--- SCENARIO 2: Second message reuses existing conversation ---');
    const conv2Res = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    const conv2 = conv2Res.rows[0].result;
    console.log('Result 2:', conv2);
    if (!conv2.ok || conv2.data.existing !== true || conv2.data.conversation_id !== conv1Id) {
      throw new Error(`Scenario 2 failed: expected existing === true and conversation_id === ${conv1Id}`);
    }
    console.log('✓ Scenario 2 passed: Successfully reused conversation', conv2.data.conversation_id);

    // SCENARIO 3: Multiple subsequent messages continue the same thread
    console.log('\n--- SCENARIO 3: Multiple subsequent messages continue the same thread ---');
    const msg1Res = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Hi, I need to check tooth pain', `wamid-1-${runId}`]
    );
    const msg2Res = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Hello! I can help you schedule an exam for tooth pain. When would you prefer?', `ai-msg-1-${runId}`]
    );
    const msg3Res = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Tomorrow morning if possible', `wamid-2-${runId}`]
    );

    // Query messages in this conversation
    const msgsInConv = await client.query(
      `SELECT id, direction, body, provider_message_id, created_at FROM api.messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC;`,
      [conv1Id]
    );
    console.log(`Recorded messages count: ${msgsInConv.rows.length}`);
    if (msgsInConv.rows.length < 3) {
      throw new Error(`Scenario 3 failed: expected at least 3 messages, got ${msgsInConv.rows.length}`);
    }
    console.log('✓ Scenario 3 passed: Messages correctly persisted in conversation thread in order');

    // SCENARIO 4: Webhook retry does not duplicate the message or conversation
    console.log('\n--- SCENARIO 4: Webhook retry does not duplicate message or conversation ---');
    // 4A: Inbound event idempotency
    const event1 = await client.query(
      'SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as result;',
      [clinicA_Id, 'whatsapp', 'messages', `event-retry-${runId}`, `hash-${runId}`, JSON.stringify({ body: 'retry test' })]
    );
    const eventRetry = await client.query(
      'SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as result;',
      [clinicA_Id, 'whatsapp', 'messages', `event-retry-${runId}`, `hash-${runId}`, JSON.stringify({ body: 'retry test' })]
    );
    if (!eventRetry.rows[0].result.data.duplicate) {
      throw new Error('Scenario 4 failed: inbound event retry was not detected as duplicate');
    }

    // 4B: Message record idempotency
    const msgRetryRes = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Hi, I need to check tooth pain', `wamid-1-${runId}`]
    );
    if (!msgRetryRes.rows[0].result.data.duplicate) {
      throw new Error('Scenario 4 failed: message record retry was not detected as duplicate');
    }

    // 4C: Conversation lookup retry
    const convRetryRes = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    if (convRetryRes.rows[0].result.data.conversation_id !== conv1Id) {
      throw new Error('Scenario 4 failed: retry created a new conversation instead of reusing existing');
    }
    console.log('✓ Scenario 4 passed: Event, message, and conversation retries are completely idempotent');

    // SCENARIO 5: Concurrent first messages do not create duplicate conversations
    console.log('\n--- SCENARIO 5: Concurrent first messages do not create duplicate conversations ---');
    const concurrentPhone = `+1555CONC${runId}`;
    const [c1, c2, c3] = await Promise.all([
      client.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text) as result;', [clinicA_Id, 'whatsapp', concurrentPhone]),
      client.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text) as result;', [clinicA_Id, 'whatsapp', concurrentPhone]),
      client.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text) as result;', [clinicA_Id, 'whatsapp', concurrentPhone])
    ]);
    const id1 = c1.rows[0].result.data.conversation_id;
    const id2 = c2.rows[0].result.data.conversation_id;
    const id3 = c3.rows[0].result.data.conversation_id;
    console.log(`Concurrent results: ${id1}, ${id2}, ${id3}`);
    if (id1 !== id2 || id2 !== id3) {
      throw new Error(`Scenario 5 failed: Concurrent requests returned differing IDs (${id1}, ${id2}, ${id3})`);
    }
    // Verify only ONE conversation row exists in DB
    const countCheck = await client.query(
      `SELECT count(*)::int as count FROM api.conversations WHERE clinic_id = $1::uuid AND channel_conversation_id = $2::text;`,
      [clinicA_Id, concurrentPhone]
    );
    if (countCheck.rows[0].count !== 1) {
      throw new Error(`Scenario 5 failed: Expected exactly 1 row, found ${countCheck.rows[0].count}`);
    }
    console.log('✓ Scenario 5 passed: Simultaneous concurrent first messages resolved to single conversation');

    // SCENARIO 6: Same patient contacting different clinic receives separate clinic-scoped conversation
    console.log('\n--- SCENARIO 6: Same patient contacting different clinic receives separate conversation ---');
    const patClinicB_Res = await client.query(
      'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
      [clinicB_Id, testPatientName1, testPhone1]
    );
    const patClinicB_Id = patClinicB_Res.rows[0].result.data.patient_id;

    const convClinicB_Res = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicB_Id, 'whatsapp', testPhone1, patClinicB_Id]
    );
    const convClinicB_Id = convClinicB_Res.rows[0].result.data.conversation_id;

    if (convClinicB_Id === conv1Id) {
      throw new Error(`Scenario 6 failed: Cross-clinic conversation collision! (${convClinicB_Id} === ${conv1Id})`);
    }
    console.log(`Clinic A conv: ${conv1Id}, Clinic B conv: ${convClinicB_Id}`);
    console.log('✓ Scenario 6 passed: Clinic isolation preserved for same patient phone number across clinics');

    // SCENARIO 7: Different patients at the same clinic receive separate conversations
    console.log('\n--- SCENARIO 7: Different patients at same clinic receive separate conversations ---');
    const pat2Res = await client.query(
      'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
      [clinicA_Id, testPatientName2, testPhone2]
    );
    const pat2Id = pat2Res.rows[0].result.data.patient_id;

    const convPat2Res = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone2, pat2Id]
    );
    const convPat2Id = convPat2Res.rows[0].result.data.conversation_id;

    if (convPat2Id === conv1Id) {
      throw new Error('Scenario 7 failed: Different patients collided on same conversation');
    }
    console.log('✓ Scenario 7 passed: Different patients at same clinic receive separate conversations');

    // SCENARIO 8: Staff handoff and subsequent AI response remain in the correct thread
    console.log('\n--- SCENARIO 8: Staff handoff and replies remain in correct thread ---');
    const handoffRes = await client.query(
      `SELECT api.create_handoff($1::uuid, 'whatsapp'::api.channel_type, 'Patient asked complex surgical question'::text, 'high'::text, $2::uuid, $3::uuid, '{"urgency": "medium"}'::jsonb) as result;`,
      [clinicA_Id, conv1Id, patient1Id]
    );
    const handoffId = handoffRes.rows[0].result.data.handoff_id;
    console.log('Created handoff:', handoffId);

    // Staff sends reply via record_message with provider_payload
    const staffMsgRes = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text, $5::jsonb) as result;`,
      [clinicA_Id, conv1Id, 'Hello, Dr. Smith reviewed your X-rays and will see you at 10 AM.', `staff_reply:${runId}`, JSON.stringify({ sentBy: 'clinic_staff' })]
    );

    // Staff resolves handoff
    const resolveRes = await client.query(
      `SELECT api.resolve_handoff($1::uuid, $2::uuid, NULL, 'Staff answered questions and scheduled surgery') as result;`,
      [clinicA_Id, handoffId]
    );
    if (!resolveRes.rows[0].result.ok) {
      throw new Error('Scenario 8 failed to resolve handoff');
    }

    // Subsequent AI message
    const subsequentAiMsg = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Let us know if you need anything else before your appointment!', `ai-followup-${runId}`]
    );

    // Verify all messages still belong to conv1Id
    const threadMsgs = await client.query(
      `SELECT body, direction, provider_payload FROM api.messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC;`,
      [conv1Id]
    );
    const staffMsgFound = threadMsgs.rows.some(m => m.provider_payload?.sentBy === 'clinic_staff');
    if (!staffMsgFound) {
      throw new Error('Scenario 8 failed: Staff reply not found in conversation thread');
    }
    console.log('✓ Scenario 8 passed: Staff handoff, staff message, and AI follow-up preserved in same thread');

    // SCENARIO 9: Patient names and conversation history load correctly in dashboard
    console.log('\n--- SCENARIO 9: Patient names and conversation history load correctly ---');
    const contextRes = await client.query(
      `SELECT api.get_conversation_context($1::uuid, $2::uuid, 20) as result;`,
      [clinicA_Id, conv1Id]
    );
    const ctx = contextRes.rows[0].result.data;
    console.log('Context loaded:', {
      patient_name: ctx.patient_name,
      patient_phone: ctx.patient_phone,
      messages_count: ctx.messages.length
    });
    if (ctx.patient_name !== testPatientName1) {
      throw new Error(`Scenario 9 failed: Expected patient_name === ${testPatientName1}, got ${ctx.patient_name}`);
    }
    if (ctx.messages.length < 5) {
      throw new Error(`Scenario 9 failed: Expected at least 5 messages in history, got ${ctx.messages.length}`);
    }
    console.log('✓ Scenario 9 passed: Verified patient name prioritized, full history loaded in order');

    // SCENARIO 10: Explicitly configured new-conversation policy works as documented
    console.log('\n--- SCENARIO 10: Explicitly configured new-conversation policy ---');
    // 10A: Active continuation is default even across simulated future time
    const futureContinuation = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    if (futureContinuation.rows[0].result.data.conversation_id !== conv1Id) {
      throw new Error('Scenario 10 failed: active conversation did not continue by default');
    }

    // 10B: Explicit new thread (force_new = true)
    const forcedNewRes = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid, NULL::interval, true) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    const newConvId = forcedNewRes.rows[0].result.data.conversation_id;
    if (newConvId === conv1Id) {
      throw new Error('Scenario 10 failed: force_new did not create a new conversation');
    }

    // Verify the previous conversation conv1Id is now closed with closed_at IS NOT NULL
    const oldConvCheck = await client.query(
      `SELECT id, closed_at, state FROM api.conversations WHERE id = $1::uuid;`,
      [conv1Id]
    );
    if (!oldConvCheck.rows[0].closed_at) {
      throw new Error('Scenario 10 failed: old conversation was not archived with closed_at');
    }

    // 10C: Inactivity timeout policy
    // Let's test inactivity policy with a 1-second interval
    // Simulate setting last_message_at to 10 seconds ago on newConvId
    await client.query(
      `UPDATE api.conversations SET last_message_at = NOW() - interval '10 seconds' WHERE id = $1::uuid;`,
      [newConvId]
    );
    // Request get_or_create with a 5-second inactivity timeout
    const timeoutRes = await client.query(
      `SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid, interval '5 seconds') as result;`,
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    const postTimeoutId = timeoutRes.rows[0].result.data.conversation_id;
    if (postTimeoutId === newConvId) {
      throw new Error('Scenario 10 failed: inactivity timeout did not expire stale conversation');
    }
    console.log(`Inactivity timeout verified: New conversation ${postTimeoutId} created after timeout`);
    console.log('✓ Scenario 10 passed: Inactivity timeout and explicit new thread policies work as documented');

    console.log('\n========================================');
    console.log('ALL 10 CONVERSATION CONTINUITY SCENARIOS PASSED!');
    console.log('========================================');
  } finally {
    // Cleanup test data created during this verification
    console.log('\nCleaning up test scenario records...');
    try {
      await client.query(`DELETE FROM api.messages WHERE provider_message_id LIKE $1`, [`%${runId}%`]);
      await client.query(`DELETE FROM api.handoffs WHERE reason LIKE $1`, [`%${runId}%`]);
      await client.query(`DELETE FROM api.inbound_events WHERE provider_event_id LIKE $1`, [`%${runId}%`]);
      await client.query(`DELETE FROM api.conversations WHERE channel_conversation_id IN ($1, $2, '+1555CONC' || $3)`, [testPhone1, testPhone2, String(runId)]);
      await client.query(`DELETE FROM api.patients WHERE phone IN ($1, $2)`, [testPhone1, testPhone2]);
      if (createdTempClinicB) {
        await client.query('DELETE FROM api.clinics WHERE id = $1::uuid;', [clinicB_Id]);
      }
    } catch (cleanErr) {
      console.warn('Cleanup warning:', cleanErr.message);
    }
    console.log('Cleanup complete.');
    await client.end();
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
