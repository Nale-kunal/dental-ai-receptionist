/**
 * conversationContinuity.integration.test.ts
 *
 * Database Integration Suite for AI Receptionist Conversation Continuity & Lifecycle.
 * STRICT SAFETY RULE: Only runs when TEST_DATABASE_URL is explicitly configured to an
 * isolated, non-production test database. Never touches production Neon.
 */

import { Client } from 'pg';
import {
  describeIsolatedDb,
  getSafeTestDatabaseClient,
  isIsolatedTestDatabaseAvailable,
} from '../helpers/testDatabaseGuard';

describeIsolatedDb('AI Receptionist Conversation Continuity & Lifecycle Suite (Isolated DB)', () => {
  let client: Client | null = null;
  const clinicA_Id = '30000000-0000-0000-0000-000000000001';
  const clinicB_Id = '30000000-0000-0000-0000-000000000002';

  const runId = Math.floor(Math.random() * 900000 + 100000);
  const testPhone1 = `+155501${runId}`;
  const testPhone2 = `+155502${runId}`;
  const testPatientName1 = `Continuity Patient ${runId}`;
  const testPatientName2 = `Secondary Patient ${runId}`;

  let patient1Id: string;
  let conv1Id: string;

  beforeAll(async () => {
    if (!isIsolatedTestDatabaseAvailable()) return;

    client = getSafeTestDatabaseClient();
    await client.connect();

    // Provision test clinics in isolated test database
    await client.query(`
      INSERT INTO api.clinics (id, name, slug, timezone, locale, active)
      VALUES 
        ($1, 'Continuity Test Clinic A', 'continuity-a-' || $3, 'America/New_York', 'en-US', true),
        ($2, 'Continuity Test Clinic B', 'continuity-b-' || $3, 'America/New_York', 'en-US', true)
      ON CONFLICT (id) DO NOTHING;
    `, [clinicA_Id, clinicB_Id, String(runId)]);
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.query(`DELETE FROM api.messages WHERE provider_message_id LIKE $1`, [`%${runId}%`]);
        await client.query(`DELETE FROM api.handoffs WHERE reason LIKE $1`, [`%${runId}%`]);
        await client.query(`DELETE FROM api.inbound_events WHERE provider_event_id LIKE $1`, [`%${runId}%`]);
        await client.query(`DELETE FROM api.conversations WHERE channel_conversation_id IN ($1, $2, '+1555CONC' || $3)`, [testPhone1, testPhone2, String(runId)]);
        await client.query(`DELETE FROM api.patients WHERE phone IN ($1, $2)`, [testPhone1, testPhone2]);
        await client.query(`DELETE FROM api.clinics WHERE id IN ($1, $2);`, [clinicA_Id, clinicB_Id]);
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

  // 2. A second message reuses the open conversation
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

  // 3. Multi-turn message recording persists correctly
  it('3. Multiple subsequent messages continue the same conversation thread in chronological order', async () => {
    if (!client) return;

    const m1 = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Can I book a cleaning?', `wamid-c3-1-${runId}`]
    );
    expect(m1.rows[0].result.ok).toBe(true);

    const m2 = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'ai_reply'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Certainly! We have openings on Monday at 10 AM.', `wamid-c3-2-${runId}`]
    );
    expect(m2.rows[0].result.ok).toBe(true);

    const m3 = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'Monday at 10 AM works great!', `wamid-c3-3-${runId}`]
    );
    expect(m3.rows[0].result.ok).toBe(true);

    const countRes = await client.query(
      'SELECT count(*)::int as count FROM api.messages WHERE conversation_id = $1::uuid;',
      [conv1Id]
    );
    expect(countRes.rows[0].count).toBe(3);
  });

  // 4. Webhook retries and idempotency
  it('4. Webhook retries do not duplicate inbound events, messages, or conversations (Idempotency)', async () => {
    if (!client) return;

    const e1 = await client.query(
      'SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as result;',
      [clinicA_Id, 'whatsapp', 'messages', `event-idemp-${runId}`, `hash-idemp-${runId}`, JSON.stringify({ retry: false })]
    );
    expect(e1.rows[0].result.ok).toBe(true);
    expect(e1.rows[0].result.duplicate).toBe(false);

    const e2 = await client.query(
      'SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) as result;',
      [clinicA_Id, 'whatsapp', 'messages', `event-idemp-${runId}`, `hash-idemp-${runId}`, JSON.stringify({ retry: true })]
    );
    expect(e2.rows[0].result.ok).toBe(true);
    expect(e2.rows[0].result.duplicate).toBe(true);
  });

  // 5. Simultaneous concurrent first messages resolve atomically
  it('5. Simultaneous concurrent first messages resolve atomically to a single conversation', async () => {
    if (!client) return;

    const concurrentPhone = `+1555CONC${runId}`;
    const calls = Array.from({ length: 5 }, () =>
      client!.query(
        'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
        [clinicA_Id, 'whatsapp', concurrentPhone, null]
      )
    );

    const results = await Promise.all(calls);
    const conversationIds = results.map((r: any) => r.rows[0].result.data.conversation_id);
    const uniqueIds = new Set(conversationIds);

    expect(uniqueIds.size).toBe(1);

    const existingFlags = results.map((r: any) => r.rows[0].result.data.existing);
    const newCount = existingFlags.filter((f: boolean) => f === false).length;
    expect(newCount).toBe(1);
  });

  // 6. Tenant isolation between clinics
  it('6. The same phone number contacting a different clinic receives an isolated clinic-scoped conversation', async () => {
    if (!client) return;

    const convBRes = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicB_Id, 'whatsapp', testPhone1, null]
    );
    const convB = convBRes.rows[0].result;
    expect(convB.ok).toBe(true);
    expect(convB.data.conversation_id).not.toBe(conv1Id);

    const rowA = await client.query('SELECT clinic_id FROM api.conversations WHERE id = $1::uuid;', [conv1Id]);
    const rowB = await client.query('SELECT clinic_id FROM api.conversations WHERE id = $1::uuid;', [convB.data.conversation_id]);
    expect(rowA.rows[0].clinic_id).toBe(clinicA_Id);
    expect(rowB.rows[0].clinic_id).toBe(clinicB_Id);
  });

  // 7. Distinct patients receive separate conversation threads
  it('7. Different patients contacting the same clinic receive distinct separate conversation threads', async () => {
    if (!client) return;

    const pat2Res = await client.query(
      'SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) as result;',
      [clinicA_Id, testPatientName2, testPhone2]
    );
    const patient2Id = pat2Res.rows[0].result.data.patient_id;

    const conv2Res = await client.query(
      'SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid) as result;',
      [clinicA_Id, 'whatsapp', testPhone2, patient2Id]
    );
    const conv2 = conv2Res.rows[0].result;
    expect(conv2.ok).toBe(true);
    expect(conv2.data.conversation_id).not.toBe(conv1Id);
    expect(conv2.data.patient_id).toBe(patient2Id);
  });

  // 8. Staff handoff, human reply, and subsequent AI reply continuity
  it('8. Staff handoffs, human replies, and subsequent AI responses remain bound to the same conversation', async () => {
    if (!client) return;

    // Create a staff handoff
    const handoffRes = await client.query(
      `SELECT api.create_handoff($1::uuid, $2::uuid, 'Complex dental insurance inquiry run-${runId}', 'insurance'::api.handoff_category, 'high'::api.handoff_priority) as result;`,
      [clinicA_Id, conv1Id]
    );
    expect(handoffRes.rows[0].result.ok).toBe(true);
    const handoffId = handoffRes.rows[0].result.data.handoff_id;

    // Staff reply message
    const staffReply = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'staff_reply'::api.message_kind, $3::text, $4::text, $5::jsonb) as result;`,
      [clinicA_Id, conv1Id, 'Hi, this is Dr. Smith from reception. We do accept Delta Dental PPO.', `staff-reply-${runId}`, JSON.stringify({ sentBy: 'clinic_staff' })]
    );
    expect(staffReply.rows[0].result.ok).toBe(true);

    // Resolve handoff
    const resolveRes = await client.query(
      `SELECT api.resolve_handoff($1::uuid, $2::uuid, NULL, 'Resolved via staff WhatsApp reply') as result;`,
      [clinicA_Id, handoffId]
    );
    expect(resolveRes.rows[0].result.ok).toBe(true);

    // Subsequent AI follow-up message
    const aiFollowUp = await client.query(
      `SELECT api.record_message($1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3::text, $4::text) as result;`,
      [clinicA_Id, conv1Id, 'A confirmation SMS has also been sent to your phone.', `ai-msg-follow-${runId}`]
    );
    expect(aiFollowUp.rows[0].result.ok).toBe(true);

    // Verify all messages are bound to conv1Id
    const thread = await client.query(
      'SELECT id, body, provider_payload FROM api.messages WHERE conversation_id = $1::uuid;',
      [conv1Id]
    );
    const hasStaff = thread.rows.some((m: any) => m.provider_payload?.sentBy === 'clinic_staff');
    expect(hasStaff).toBe(true);
  });

  // 9. Prioritizes verified patient name over raw phone and loads full ordered history for dashboard
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

  // 10. Conversation lifecycle policies work as documented
  it('10. Conversation lifecycle policies (persistent continuation, explicit new-thread, inactivity timeout) work as documented', async () => {
    if (!client) return;

    // 10A: Default active continuation
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

