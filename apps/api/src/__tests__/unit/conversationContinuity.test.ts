import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

// Load DATABASE_URL from .env if present
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  try {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const match = envContent.match(/DATABASE_URL=([^\r\n]+)/);
      if (match) connectionString = match[1].replace(/['"]/g, '').trim();
    }
  } catch {
    // Ignore error
  }
}

describe('AI Receptionist Conversation Continuity & Lifecycle Suite', () => {
  let client: Client | null = null;
  const clinicA_Id = '00000000-0000-0000-0000-000000000001'; // Demo Dental Clinic
  let clinicB_Id: string;
  let createdTempClinicB = false;

  const runId = Math.floor(Math.random() * 900000 + 100000);
  const testPhone1 = `+155501${runId}`;
  const testPhone2 = `+155502${runId}`;
  const testPatientName1 = `Continuity Patient ${runId}`;
  const testPatientName2 = `Secondary Patient ${runId}`;

  let patient1Id: string;
  let conv1Id: string;

  beforeAll(async () => {
    if (connectionString) {
      client = new Client({ connectionString });
      await client.connect();

      // Find an active secondary clinic or create one
      const bRes = await client.query(`
        SELECT id FROM api.clinics
        WHERE id != $1 AND active = true AND suspended_at IS NULL
        LIMIT 1;
      `, [clinicA_Id]);

      if (bRes.rows.length > 0) {
        clinicB_Id = bRes.rows[0].id;
      } else {
        const newClinic = await client.query(`
          INSERT INTO api.clinics (name, slug, timezone, locale, active)
          VALUES ('Temp Test Clinic B', 'temp-b-' || substr(gen_random_uuid()::text, 1, 8), 'America/New_York', 'en-US', true)
          RETURNING id;
        `);
        clinicB_Id = newClinic.rows[0].id;
        createdTempClinicB = true;
      }
    }
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.query(`DELETE FROM api.messages WHERE provider_message_id LIKE $1`, [`%${runId}%`]);
        await client.query(`DELETE FROM api.handoffs WHERE reason LIKE $1`, [`%${runId}%`]);
        await client.query(`DELETE FROM api.inbound_events WHERE provider_event_id LIKE $1`, [`%${runId}%`]);
        await client.query(`DELETE FROM api.conversations WHERE channel_conversation_id IN ($1, $2, '+1555CONC' || $3)`, [testPhone1, testPhone2, String(runId)]);
        await client.query(`DELETE FROM api.patients WHERE phone IN ($1, $2)`, [testPhone1, testPhone2]);
        if (createdTempClinicB) {
          await client.query('DELETE FROM api.clinics WHERE id = $1::uuid;', [clinicB_Id]);
        }
      } catch {
        // Best-effort cleanup
      }
      await client.end();
    }
  });

  // 1. A first message creates one conversation
  it('1. First inbound contact creates exactly one new conversation thread', async () => {
    if (!client) return;

    const patRes = await client.query(
      'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
      [clinicA_Id, testPatientName1, testPhone1]
    );
    expect(patRes.rows[0].result.ok).toBe(true);
    patient1Id = patRes.rows[0].result.data.patient_id;

    const convRes = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );

    const conv = convRes.rows[0].result;
    expect(conv.ok).toBe(true);
    expect(conv.data.existing).toBe(false);
    expect(conv.data.conversation_id).toBeDefined();
    expect(conv.data.patient_id).toBe(patient1Id);
    conv1Id = conv.data.conversation_id;
  });

  // 2. A second message from the same patient to the same clinic reuses that conversation
  it('2. A second message from the same patient to the same clinic reuses the existing conversation', async () => {
    if (!client) return;

    const convRes = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );

    const conv = convRes.rows[0].result;
    expect(conv.ok).toBe(true);
    expect(conv.data.existing).toBe(true);
    expect(conv.data.conversation_id).toBe(conv1Id);
  });

  // 3. Multiple subsequent messages continue the same thread
  it('3. Multiple subsequent messages continue the same conversation thread in chronological order', async () => {
    if (!client) return;

    const m1 = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Can I book a cleaning?', `wamid-c3-1-${runId}`]
    );
    expect(m1.rows[0].result.ok).toBe(true);

    const m2 = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Certainly! We have openings on Friday.', `ai-reply-c3-2-${runId}`]
    );
    expect(m2.rows[0].result.ok).toBe(true);

    const m3 = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Friday at 2 PM works great.', `wamid-c3-3-${runId}`]
    );
    expect(m3.rows[0].result.ok).toBe(true);

    const msgs = await client.query(
      `SELECT id, direction, body FROM api.messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC;`,
      [conv1Id]
    );
    expect(msgs.rows.length).toBeGreaterThanOrEqual(3);
    expect(msgs.rows[0].direction).toBe('inbound');
    expect(msgs.rows[1].direction).toBe('outbound');
    expect(msgs.rows[2].direction).toBe('inbound');
  });

  // 4. A webhook retry does not duplicate the message or conversation
  it('4. Webhook retries do not duplicate inbound events, messages, or conversations (Idempotency)', async () => {
    if (!client) return;

    // Event idempotency
    const e1 = await client.query(
      'SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as result;',
      [clinicA_Id, 'whatsapp', 'messages', `event-idemp-${runId}`, `hash-idemp-${runId}`, JSON.stringify({ retry: false })]
    );
    expect(e1.rows[0].result.data.duplicate).toBe(false);

    const eRetry = await client.query(
      'SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as result;',
      [clinicA_Id, 'whatsapp', 'messages', `event-idemp-${runId}`, `hash-idemp-${runId}`, JSON.stringify({ retry: true })]
    );
    expect(eRetry.rows[0].result.data.duplicate).toBe(true);

    // Message idempotency
    const msgIdemp = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Can I book a cleaning?', `wamid-c3-1-${runId}`]
    );
    expect(msgIdemp.rows[0].result.data.duplicate).toBe(true);

    // Conversation lookup idempotency
    const convLookup = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    expect(convLookup.rows[0].result.data.conversation_id).toBe(conv1Id);
  });

  // 5. Concurrent first messages do not create duplicate conversations
  it('5. Simultaneous concurrent first messages resolve atomically to a single conversation', async () => {
    if (!client) return;

    const concurrentPhone = `+1555CONC${runId}`;

    // Use separate client instances for true connection concurrency without driver serialization warnings
    const cA = new Client({ connectionString });
    const cB = new Client({ connectionString });
    const cC = new Client({ connectionString });
    await Promise.all([cA.connect(), cB.connect(), cC.connect()]);

    const [resA, resB, resC] = await Promise.all([
      cA.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text) as result;', [clinicA_Id, 'whatsapp', concurrentPhone]),
      cB.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text) as result;', [clinicA_Id, 'whatsapp', concurrentPhone]),
      cC.query('SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text) as result;', [clinicA_Id, 'whatsapp', concurrentPhone]),
    ]);

    await Promise.all([cA.end(), cB.end(), cC.end()]);

    const idA = resA.rows[0].result.data.conversation_id;
    const idB = resB.rows[0].result.data.conversation_id;
    const idC = resC.rows[0].result.data.conversation_id;

    expect(idA).toBe(idB);
    expect(idB).toBe(idC);

    // Verify exactly one active row exists in the database
    const countRes = await client.query(
      'SELECT count(*)::int as count FROM api.conversations WHERE clinic_id = $1::uuid AND channel_conversation_id = $2::text;',
      [clinicA_Id, concurrentPhone]
    );
    expect(countRes.rows[0].count).toBe(1);
  });

  // 6. The same patient contacting a different clinic receives a separate clinic-scoped conversation
  it('6. The same phone number contacting a different clinic receives an isolated clinic-scoped conversation', async () => {
    if (!client) return;

    const patB_Res = await client.query(
      'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
      [clinicB_Id, testPatientName1, testPhone1]
    );
    const patB_Id = patB_Res.rows[0].result.data.patient_id;

    const convB_Res = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicB_Id, 'whatsapp', testPhone1, patB_Id]
    );
    const convB_Id = convB_Res.rows[0].result.data.conversation_id;

    expect(convB_Id).not.toBe(conv1Id);

    // Verify database clinic foreign key separation
    const rowA = await client.query('SELECT clinic_id FROM api.conversations WHERE id = $1::uuid;', [conv1Id]);
    const rowB = await client.query('SELECT clinic_id FROM api.conversations WHERE id = $1::uuid;', [convB_Id]);
    expect(rowA.rows[0].clinic_id).toBe(clinicA_Id);
    expect(rowB.rows[0].clinic_id).toBe(clinicB_Id);
  });

  // 7. Different patients at the same clinic receive separate conversations
  it('7. Different patients contacting the same clinic receive distinct separate conversation threads', async () => {
    if (!client) return;

    const pat2Res = await client.query(
      'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
      [clinicA_Id, testPatientName2, testPhone2]
    );
    const pat2Id = pat2Res.rows[0].result.data.patient_id;

    const conv2Res = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone2, pat2Id]
    );
    const conv2Id = conv2Res.rows[0].result.data.conversation_id;

    expect(conv2Id).not.toBe(conv1Id);
  });

  // 8. A staff handoff and subsequent AI response remain in the correct thread
  it('8. Staff handoffs, human replies, and subsequent AI responses remain bound to the same conversation', async () => {
    if (!client) return;

    // Escalate to handoff
    const handoffRes = await client.query(
      `SELECT api.create_handoff($1::uuid, 'whatsapp'::api.channel_type, $2::text, 'urgent'::text, $3::uuid, $4::uuid, '{"reason": "surgical enquiry"}'::jsonb) as result;`,
      [clinicA_Id, `Enquiry ${runId}`, conv1Id, patient1Id]
    );
    expect(handoffRes.rows[0].result.ok).toBe(true);
    const handoffId = handoffRes.rows[0].result.data.handoff_id;

    // Staff replies
    const staffReply = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text, $5::jsonb) as result;`,
      [clinicA_Id, conv1Id, 'Front desk here. Dr. Smith can fit you in tomorrow at 9 AM.', `staff_reply:${runId}`, JSON.stringify({ sentBy: 'clinic_staff' })]
    );
    expect(staffReply.rows[0].result.ok).toBe(true);

    // Resolve handoff
    const resolveRes = await client.query(
      `SELECT api.resolve_handoff($1::uuid, $2::uuid, NULL, 'Resolved via staff WhatsApp reply') as result;`,
      [clinicA_Id, handoffId]
    );
    expect(resolveRes.rows[0].result.ok).toBe(true);

    // Subsequent AI message
    const aiFollowUp = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'A confirmation SMS has also been sent to your phone.', `ai-msg-follow-${runId}`]
    );
    expect(aiFollowUp.rows[0].result.ok).toBe(true);

    // Verify all messages are in conv1Id
    const thread = await client.query(
      'SELECT id, body, provider_payload FROM api.messages WHERE conversation_id = $1::uuid;',
      [conv1Id]
    );
    const hasStaff = thread.rows.some((m: any) => m.provider_payload?.sentBy === 'clinic_staff');
    expect(hasStaff).toBe(true);
  });

  // 9. Patient names and conversation history load correctly in the dashboard
  it('9. Prioritizes verified patient name over raw phone and loads full ordered history for dashboard', async () => {
    if (!client) return;

    const ctxRes = await client.query(
      'SELECT api.get_conversation_context($1::uuid, $2::uuid, 50) as result;',
      [clinicA_Id, conv1Id]
    );
    const ctx = ctxRes.rows[0].result.data;

    // Verified name resolution: Full name displayed, never generic dummy
    expect(ctx.patient_name).toBe(testPatientName1);
    expect(ctx.patient_name).not.toBe('WhatsApp user');
    expect(ctx.patient_name).not.toBe('Unknown contact');
    expect(ctx.patient_phone).toBe(testPhone1);

    // Messages array exists and is ordered chronologically
    expect(Array.isArray(ctx.messages)).toBe(true);
    expect(ctx.messages.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < ctx.messages.length; i++) {
      const prev = new Date(ctx.messages[i - 1].created_at).getTime();
      const curr = new Date(ctx.messages[i].created_at).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  // 10. Any explicitly configured new-conversation policy works as documented
  it('10. Conversation lifecycle policies (persistent continuation, explicit new-thread, inactivity timeout) work as documented', async () => {
    if (!client) return;

    // 10A: Default active continuation (messaging today and tomorrow reuses the open conversation)
    const continuation = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    expect(continuation.rows[0].result.data.conversation_id).toBe(conv1Id);
    expect(continuation.rows[0].result.data.existing).toBe(true);

    // 10B: Explicit new thread (p_force_new = true) archives previous conversation and starts a new one
    const forcedNew = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid, NULL::interval, true) as result;',
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    const secondConvId = forcedNew.rows[0].result.data.conversation_id;
    expect(secondConvId).not.toBe(conv1Id);
    expect(forcedNew.rows[0].result.data.existing).toBe(false);

    // Verify first conversation was archived with closed_at set
    const oldRow = await client.query('SELECT closed_at, state FROM api.conversations WHERE id = $1::uuid;', [conv1Id]);
    expect(oldRow.rows[0].closed_at).not.toBeNull();
    expect(oldRow.rows[0].state.close_reason).toBe('explicit_new_thread');

    // 10C: Configured inactivity timeout policy
    // Simulate setting last_message_at of second conversation to 2 hours ago
    await client.query(
      `UPDATE api.conversations SET last_message_at = NOW() - interval '2 hours' WHERE id = $1::uuid;`,
      [secondConvId]
    );

    // Patient contacts clinic with a 1-hour inactivity timeout policy
    const timeoutRes = await client.query(
      `SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid, interval '1 hour') as result;`,
      [clinicA_Id, 'whatsapp', testPhone1, patient1Id]
    );
    const thirdConvId = timeoutRes.rows[0].result.data.conversation_id;
    expect(thirdConvId).not.toBe(secondConvId);
    expect(thirdConvId).not.toBe(conv1Id);
    expect(timeoutRes.rows[0].result.data.existing).toBe(false);

    // Verify second conversation was closed with inactivity_timeout
    const secondRow = await client.query('SELECT closed_at, state FROM api.conversations WHERE id = $1::uuid;', [secondConvId]);
    expect(secondRow.rows[0].closed_at).not.toBeNull();
    expect(secondRow.rows[0].state.close_reason).toBe('inactivity_timeout');
  });
});
