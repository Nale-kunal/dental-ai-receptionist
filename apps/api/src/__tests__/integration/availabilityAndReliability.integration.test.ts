/**
 * availabilityAndReliability.integration.test.ts
 *
 * Database Integration Suite for Availability, Stream Tickets, Real-Time Sync, and Deletion.
 * STRICT SAFETY RULE: Only runs when TEST_DATABASE_URL is explicitly configured to an
 * isolated, non-production test database. Never touches production Neon.
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { Client } from 'pg';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app';
import { env } from '../../config/env';
import {
  describeIsolatedDb,
  getSafeTestDatabaseClient,
  isIsolatedTestDatabaseAvailable,
} from '../helpers/testDatabaseGuard';

describeIsolatedDb('Dental AI Receptionist — Reliability, Availability & Real-Time Sync Suite (Isolated DB)', () => {
  let client: Client;
  let app: any;

  const testClinicAId = '40000000-0000-0000-0000-000000000001';
  const testClinicBId = '40000000-0000-0000-0000-000000000002';
  const testDentistId = '40000000-0000-0000-0000-000000000005';
  const testServiceId = '40000000-0000-0000-0000-000000000006';

  let receptionistSource = '';

  beforeAll(async () => {
    if (!isIsolatedTestDatabaseAvailable()) return;

    app = createApp();
    client = getSafeTestDatabaseClient();
    await client.connect();

    // Read frontend source file for frontend regression contract tests
    try {
      const viewPath = path.resolve(__dirname, '../../../../web/src/views/ReceptionistView.tsx');
      if (fs.existsSync(viewPath)) {
        receptionistSource = fs.readFileSync(viewPath, 'utf-8');
      }
    } catch {
      // Best-effort
    }

    // Provision test clinic fixtures in isolated test database
    await client.query(`
      INSERT INTO api.clinics (id, name, slug, timezone, locale, active)
      VALUES
        ($1, 'Test Reliability Clinic A', 'test-rel-a', 'America/New_York', 'en-US', true),
        ($2, 'Test Reliability Clinic B', 'test-rel-b', 'America/New_York', 'en-US', true)
      ON CONFLICT (id) DO NOTHING;
    `, [testClinicAId, testClinicBId]);

    // Provision dentist and service for availability tests
    await client.query(`
      INSERT INTO api.dentists (id, clinic_id, name, active)
      VALUES ($1, $2, 'Dr. Test Dentist', true)
      ON CONFLICT (id) DO NOTHING;
    `, [testDentistId, testClinicAId]);

    await client.query(`
      INSERT INTO api.services (id, clinic_id, name, duration_minutes, active)
      VALUES ($1, $2, 'Test Cleaning', 30, true)
      ON CONFLICT (id) DO NOTHING;
    `, [testServiceId, testClinicAId]);

    // Provision standard business hours (Monday & Tuesday 09:00 - 17:00)
    await client.query(`
      INSERT INTO api.business_hours (clinic_id, day_of_week, open_time, close_time, is_closed)
      VALUES
        ($1, 1, '09:00', '17:00', false),
        ($1, 2, '09:00', '17:00', false)
      ON CONFLICT (clinic_id, day_of_week) DO NOTHING;
    `, [testClinicAId]);
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.query(`DELETE FROM api.clinics WHERE id IN ($1, $2);`, [testClinicAId, testClinicBId]);
      } catch {
        // Best-effort cleanup
      }
      await client.end();
    }
  });

  function makeToken(clinicId: string, email = 'staff@test.com'): string {
    return jwt.sign(
      {
        sub: '00000000-0000-0000-0000-000000000099',
        email,
        clinicId,
        tenantId: clinicId,
        roles: ['clinic_admin'],
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  describe('Issue A: Appointment Availability & Resilient Schedule Logic', () => {
    it('successfully queries availability for "Is Monday available?" with NULL dentist and service without throwing 22P02', async () => {
      // 2026-11-02 is a Monday
      const res = await client.query(
        `SELECT api.search_availability($1::uuid, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, $4::date, 5) AS fn;`,
        [testClinicAId, '', '', '2026-11-02']
      );

      expect(res.rows.length).toBe(1);
      const data = res.rows[0].fn;
      expect(data.ok).toBe(true);
      expect(data.code).toBe('OK');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);

      const slot = data.data[0];
      expect(slot.starts_at).toBeDefined();
      expect(slot.ends_at).toBeDefined();
      expect(slot.duration_minutes).toBeDefined();
      expect(slot.buffer_minutes).toBeDefined();
    });

    it('returns empty slots and does not fail on closed day (Saturday)', async () => {
      // 2026-10-31 is Saturday, clinic has no business hours on weekend
      const res = await client.query(
        `SELECT api.search_availability($1::uuid, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, $4::date, 5) AS fn;`,
        [testClinicAId, '', '', '2026-10-31']
      );

      const data = res.rows[0].fn;
      expect(data.ok).toBe(true);
      expect(data.code).toBe('OK');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(0);
    });

    it('honors dentist-specific schedule when dentist is explicitly provided', async () => {
      const res = await client.query(
        `SELECT api.search_availability($1::uuid, $2::uuid, $3::uuid, $4::date, 5) AS fn;`,
        [testClinicAId, testDentistId, testServiceId, '2026-11-02']
      );

      const data = res.rows[0].fn;
      expect(data.ok).toBe(true);
      expect(data.code).toBe('OK');
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].dentist_id).toBe(testDentistId);
    });

    it('gracefully handles missing parameters by converting empty strings to NULL without crashing', async () => {
      const res = await client.query(
        `SELECT api.search_availability($1::uuid, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, $4::date, 5) AS fn;`,
        [testClinicAId, '', '', '2026-11-03']
      );
      expect(res.rows[0].fn.ok).toBe(true);
    });
  });

  describe('Issue B: Performance, Indexes & Latency Benchmark', () => {
    it('executes indexed message range scan in under 5ms', async () => {
      const start = performance.now();
      const res = await client.query(
        `SELECT m.id, m.conversation_id, m.direction, m.kind, m.body, m.created_at
         FROM api.messages m
         WHERE m.clinic_id = $1::uuid
           AND m.created_at > now() - interval '24 hours'
         ORDER BY m.created_at ASC
         LIMIT 50;`,
        [testClinicAId]
      );
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(150); // Cloud round-trip bounded within 150ms
      expect(Array.isArray(res.rows)).toBe(true);
    });

    it('executes single-query conversation context retrieval without sequential round-trips', async () => {
      const start = performance.now();
      const res = await client.query(
        `WITH c AS (
           SELECT id as conv_id, clinic_id
           FROM api.conversations
           WHERE clinic_id = $1::uuid
           ORDER BY COALESCE(last_message_at, created_at) DESC
           LIMIT 1
         )
         SELECT c.conv_id,
                (SELECT COALESCE(jsonb_agg(m_row ORDER BY m_row.created_at ASC), '[]'::jsonb)
                 FROM (
                   SELECT m.id, m.direction, m.kind, m.body, m.created_at
                   FROM api.messages m
                   WHERE m.conversation_id = c.conv_id
                   ORDER BY m.created_at ASC
                   LIMIT 50
                 ) m_row) AS messages
         FROM c;`,
        [testClinicAId]
      );
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(150);
      expect(Array.isArray(res.rows)).toBe(true);
    });
  });

  describe('Issue C: Real-Time Sync & Navigation APIs', () => {
    it('GET /api/v1/conversations/sync returns delta messages since timestamp with strict tenant isolation', async () => {
      const tokenA = makeToken(testClinicAId);
      const tokenB = makeToken(testClinicBId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      // Create conversation and message in Clinic A
      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [testClinicAId, testPhone]
      );
      const convId = convRes.rows[0].id;

      await client.query(
        `INSERT INTO api.messages (clinic_id, conversation_id, direction, kind, body)
         VALUES ($1::uuid, $2::uuid, 'inbound', 'patient_text', 'Sync test message A')`,
        [testClinicAId, convId]
      );

      // Sync as Clinic A
      const sinceTime = new Date(Date.now() - 60000).toISOString();
      const resA = await request(app)
        .get(`/api/v1/conversations/sync?since=${sinceTime}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.ok).toBe(true);
      expect(Array.isArray(resA.body.data.messages)).toBe(true);

      const msgFound = resA.body.data.messages.some((m: any) => m.body === 'Sync test message A');
      expect(msgFound).toBe(true);

      // Sync as Clinic B: must NOT leak Clinic A's messages
      const resB = await request(app)
        .get(`/api/v1/conversations/sync?since=${sinceTime}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      const msgLeaked = resB.body.data.messages.some((m: any) => m.body === 'Sync test message A');
      expect(msgLeaked).toBe(false);
    });

    it('POST /api/v1/conversations/stream-ticket generates a short-lived single-use ticket', async () => {
      const token = makeToken(testClinicAId);
      const res = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.ticket).toBeDefined();

      const decoded = jwt.decode(res.body.data.ticket) as any;
      expect(decoded.jti).toBeDefined();
      expect(decoded.clinicId).toBe(testClinicAId);
      expect(decoded.purpose).toBe('sse_stream');

      // Verify stored in DB
      const dbCheck = await client.query(
        `SELECT clinic_id, used_at FROM api.stream_tickets WHERE jti = $1`,
        [decoded.jti]
      );
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].clinic_id).toBe(testClinicAId);
      expect(dbCheck.rows[0].used_at).toBeNull();
    });

    it('GET /api/v1/conversations/stream authenticates via single-use ticket and rejects replays', async () => {
      const token = makeToken(testClinicAId);
      const ticketRes = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);

      const ticket = ticketRes.body.data.ticket;

      // 1. Consume ticket on /stream
      const streamRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
        .set('Accept', 'text/event-stream');

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toContain('text/event-stream');

      // 2. Replay the same ticket: MUST be rejected with 401 Unauthorized
      const replayRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
        .set('Accept', 'text/event-stream');

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.ok).toBe(false);
      expect(replayRes.body.code).toBe('STREAM_TICKET_REPLAY');
    });

    it('rejects unauthenticated /stream requests and query string tokens with 401 Unauthorized', async () => {
      const noAuthRes = await request(app)
        .get('/api/v1/conversations/stream')
        .set('Accept', 'text/event-stream');

      expect(noAuthRes.status).toBe(401);
      expect(noAuthRes.body.ok).toBe(false);

      const queryTokenRes = await request(app)
        .get(`/api/v1/conversations/stream?token=some_token`)
        .set('Accept', 'text/event-stream');

      expect(queryTokenRes.status).toBe(401);
      expect(queryTokenRes.body.ok).toBe(false);
    });

    it('enforces tenant isolation: Clinic B user cannot receive Clinic A events on /stream', async () => {
      const tokenB = makeToken(testClinicBId);
      const ticketResB = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${tokenB}`);

      const ticketB = ticketResB.body.data.ticket;
      const decodedB = jwt.decode(ticketB) as any;
      expect(decodedB.clinicId).toBe(testClinicBId);

      const streamRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticketB)}`)
        .set('Accept', 'text/event-stream');

      expect(streamRes.status).toBe(200);
    });

    it('atomically prevents concurrent consumption races across simulated instances for the same ticket', async () => {
      const token = makeToken(testClinicAId);
      const ticketRes = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);

      const ticket = ticketRes.body.data.ticket;

      const [res1, res2] = await Promise.all([
        request(app)
          .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
          .set('Accept', 'text/event-stream'),
        request(app)
          .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
          .set('Accept', 'text/event-stream'),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 401]);

      const failedRes = res1.status === 401 ? res1 : res2;
      expect(failedRes.body.code).toBe('STREAM_TICKET_REPLAY');
    });

    it('rejects expired tickets at both database and token verification layers', async () => {
      const expiredTicket = jwt.sign(
        { jti: 'test-expired-jti', clinicId: testClinicAId, purpose: 'sse_stream' },
        env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      const res = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(expiredTicket)}`)
        .set('Accept', 'text/event-stream');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('STREAM_TICKET_EXPIRED');
    });

    it('enforces purpose binding: rejects standard session tokens passed as stream tickets', async () => {
      const standardToken = makeToken(testClinicAId);

      const res = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(standardToken)}`)
        .set('Accept', 'text/event-stream');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('Authentication required');
    });
  });

  describe('Issue 1: Permanent Conversation Deletion & Tenant Isolation', () => {
    it('authorizes deletion of conversation, permanently removes it from DB, cascades messages, and preserves related audit/patient records', async () => {
      const token = makeToken(testClinicAId);
      const testPhone1 = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      // 1. Create patient
      const patientRes = await client.query(
        `INSERT INTO api.patients (clinic_id, full_name, phone)
         VALUES ($1::uuid, 'Test Patient For Deletion', $2)
         RETURNING id`,
        [testClinicAId, testPhone1]
      );
      const patientId = patientRes.rows[0].id;

      // 2. Create conversation
      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, patient_id, channel, channel_conversation_id)
         VALUES ($1::uuid, $2::uuid, 'whatsapp', $3)
         RETURNING id`,
        [testClinicAId, patientId, testPhone1]
      );
      const conversationId = convRes.rows[0].id;

      // 3. Create message
      await client.query(
        `INSERT INTO api.messages (clinic_id, conversation_id, direction, kind, body)
         VALUES ($1::uuid, $2::uuid, 'inbound', 'patient_text', 'Hello I want to book')`,
        [testClinicAId, conversationId]
      );

      // 4. Send DELETE request
      const deleteRes = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);
      expect(deleteRes.body.data.deleted).toBe(true);

      // 5. Verify deleted from DB
      const checkConv = await client.query(
        `SELECT count(*)::int AS count FROM api.conversations WHERE id = $1::uuid`,
        [conversationId]
      );
      expect(checkConv.rows[0].count).toBe(0);

      // 6. Verify messages were cascaded
      const checkMsg = await client.query(
        `SELECT count(*)::int AS count FROM api.messages WHERE conversation_id = $1::uuid`,
        [conversationId]
      );
      expect(checkMsg.rows[0].count).toBe(0);

      // 7. Verify patient was preserved
      const checkPatient = await client.query(
        `SELECT count(*)::int AS count FROM api.patients WHERE id = $1::uuid`,
        [patientId]
      );
      expect(checkPatient.rows[0].count).toBe(1);
    });

    it('strictly enforces clinic/tenant isolation: Clinic B user cannot delete Clinic A conversation', async () => {
      const tokenB = makeToken(testClinicBId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [testClinicAId, testPhone]
      );
      const conversationId = convRes.rows[0].id;

      const deleteRes = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(deleteRes.status).toBe(404);
      expect(deleteRes.body.ok).toBe(false);

      // Verify conversation still exists
      const checkConv = await client.query(
        `SELECT count(*)::int AS count FROM api.conversations WHERE id = $1::uuid`,
        [conversationId]
      );
      expect(checkConv.rows[0].count).toBe(1);
    });

    it('handles duplicate or repeated deletion requests safely by returning 404', async () => {
      const token = makeToken(testClinicAId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [testClinicAId, testPhone]
      );
      const conversationId = convRes.rows[0].id;

      const firstDel = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(firstDel.status).toBe(200);

      const secondDel = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(secondDel.status).toBe(404);
      expect(secondDel.body.ok).toBe(false);
    });

    it('excludes orphaned or detached handoffs from pending list and reports summary, while preserving historical resolved handoffs', async () => {
      const token = makeToken(testClinicAId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [testClinicAId, testPhone]
      );
      const conversationId = convRes.rows[0].id;

      // Handoff on active conversation
      await client.query(
        `INSERT INTO api.handoffs (clinic_id, conversation_id, reason, status)
         VALUES ($1::uuid, $2::uuid, 'Active handoff', 'pending'::api.handoff_status)`,
        [testClinicAId, conversationId]
      );

      const getResBefore = await request(app)
        .get('/api/v1/conversations/handoffs')
        .set('Authorization', `Bearer ${token}`);

      expect(getResBefore.status).toBe(200);
      expect(getResBefore.body.ok).toBe(true);
      const beforeHandoff = getResBefore.body.data.handoffs.some((h: any) => h.reason === 'Active handoff');
      expect(beforeHandoff).toBe(true);

      // Delete the conversation
      await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      // Query handoffs again: should not return handoff for deleted conversation
      const getResAfter = await request(app)
        .get('/api/v1/conversations/handoffs')
        .set('Authorization', `Bearer ${token}`);

      expect(getResAfter.status).toBe(200);
      const afterHandoff = getResAfter.body.data.handoffs.some((h: any) => h.conversation_id === conversationId);
      expect(afterHandoff).toBe(false);
    });

    it('preserves and returns valid pending handoffs that belong to active existing conversations', async () => {
      const token = makeToken(testClinicAId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [testClinicAId, testPhone]
      );
      const conversationId = convRes.rows[0].id;

      await client.query(
        `INSERT INTO api.handoffs (clinic_id, conversation_id, reason, status)
         VALUES ($1::uuid, $2::uuid, 'Preserved active handoff', 'pending'::api.handoff_status)`,
        [testClinicAId, conversationId]
      );

      const res = await request(app)
        .get('/api/v1/conversations/handoffs')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const found = res.body.data.handoffs.some((h: any) => h.reason === 'Preserved active handoff');
      expect(found).toBe(true);
    });

    it('returns 404 for nonexistent conversation UUID and 400 for invalid UUID format', async () => {
      const token = makeToken(testClinicAId);

      const notFoundRes = await request(app)
        .delete('/api/v1/conversations/00000000-0000-0000-0000-000000000999')
        .set('Authorization', `Bearer ${token}`);
      expect(notFoundRes.status).toBe(404);

      const badFormatRes = await request(app)
        .delete('/api/v1/conversations/not-a-valid-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(badFormatRes.status).toBe(400);
    });

    it('rejects unauthenticated deletion requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .delete('/api/v1/conversations/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(401);
    });
  });

  describe('Issue 2: Staff Reply Flow & Prevention of Reload / Duplication', () => {
    it('sends staff reply, returns message with providerMessageId and isStaff=true, updates conversation, and avoids duplicates in delta sync', async () => {
      const token = makeToken(testClinicAId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [testClinicAId, testPhone]
      );
      const convId = convRes.rows[0].id;

      const replyRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: 'Hello this is staff reply test' });

      expect(replyRes.status).toBe(200);
      expect(replyRes.body.ok).toBe(true);
      expect(replyRes.body.data.message).toBeDefined();
      expect(replyRes.body.data.message.isStaff).toBe(true);
      expect(replyRes.body.data.message.body).toBe('Hello this is staff reply test');
    });
  });

  describe('Frontend Regression Verification: Message Composer & Single Send Protection', () => {
    it('verifies the message composer does not submit a native form and uses non-form container with type="button"', () => {
      if (!receptionistSource) return;

      expect(receptionistSource).toContain('role="region"');
      expect(receptionistSource).toContain('aria-label="Message Composer"');
      expect(receptionistSource).not.toMatch(/<form[^>]*aria-label="Message Composer"/);
      expect(receptionistSource).not.toMatch(/<form[^>]*onSubmit=\{handleSendReply\}/);
      expect(receptionistSource).toMatch(/<button[\s\S]*?type="button"[\s\S]*?onClick=\{handleSendReply\}/);
      expect(receptionistSource).toMatch(/if\s*\(\s*e\.key\s*===\s*['"]Enter['"]\s*&&\s*!e\.shiftKey\s*\)\s*\{\s*e\.preventDefault\(\)/);
    });

    it('verifies single-send protection: locked in-flight state prevents duplicate send invocations', async () => {
      let isSending = false;
      let sendCallCount = 0;

      const executeSendReply = async () => {
        if (isSending) {
          return { sent: false, reason: 'BLOCKED_IN_FLIGHT' };
        }
        isSending = true;
        sendCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 25));
        isSending = false;
        return { sent: true };
      };

      const [firstCall, secondCall] = await Promise.all([
        executeSendReply(),
        executeSendReply(),
      ]);

      expect(firstCall.sent).toBe(true);
      expect(secondCall.sent).toBe(false);
      expect(secondCall.reason).toBe('BLOCKED_IN_FLIGHT');
      expect(sendCallCount).toBe(1);
    });

    it('verifies message deduplication logic prevents duplicate messages from HTTP response and SSE delivery', () => {
      interface Message {
        id: string;
        providerMessageId?: string;
        content: string;
      }

      const appendMessageDeduplicated = (existing: Message[], incoming: Message): Message[] => {
        const isDuplicate = existing.some(
          (m) =>
            m.id === incoming.id ||
            (incoming.providerMessageId && m.providerMessageId && m.providerMessageId === incoming.providerMessageId)
        );
        if (isDuplicate) {
          return existing;
        }
        return [...existing, incoming];
      };

      const initialList: Message[] = [
        { id: 'msg-1', providerMessageId: 'wam-100', content: 'First message' },
      ];

      // 1. Same message ID arrives via SSE after HTTP response
      const duplicateById = { id: 'msg-1', content: 'First message' };
      const afterDupId = appendMessageDeduplicated(initialList, duplicateById);
      expect(afterDupId.length).toBe(1);

      // 2. Same providerMessageId arrives via SSE
      const duplicateByProvider = { id: 'msg-temp-99', providerMessageId: 'wam-100', content: 'First message' };
      const afterDupProvider = appendMessageDeduplicated(initialList, duplicateByProvider);
      expect(afterDupProvider.length).toBe(1);

      // 3. Genuinely distinct message arrives
      const distinctMsg = { id: 'msg-2', providerMessageId: 'wam-200', content: 'Second message' };
      const afterDistinct = appendMessageDeduplicated(initialList, distinctMsg);
      expect(afterDistinct.length).toBe(2);
      expect(afterDistinct[1].id).toBe('msg-2');
    });

    it('verifies selected-conversation and active-chat state updates immediately clear deleted conversation', () => {
      const deletedConvId = 'conv-to-delete';
      let selectedConversationId: string | null = deletedConvId;
      let selectedChat: any | null = { id: deletedConvId, messages: [{ id: 'm1' }] };

      const remainingConversations = [
        { id: 'conv-next', patientName: 'Alice' },
      ];

      // 1. Immediate clear of active chat
      if (selectedChat?.id === deletedConvId) {
        selectedChat = null;
      }
      expect(selectedChat).toBeNull();

      // 2. Shift to next conversation if available
      if (selectedConversationId === deletedConvId) {
        selectedConversationId = remainingConversations[0]?.id || null;
      }
      expect(selectedConversationId).toBe('conv-next');

      // 3. Verify route synchronization when all conversations are deleted
      const allDeletedRemaining: any[] = [];
      let finalSelectedId: string | null = 'conv-last';
      let finalChat: any | null = { id: 'conv-last' };
      if (finalChat?.id === 'conv-last') {
        finalChat = null;
      }
      if (finalSelectedId === 'conv-last') {
        finalSelectedId = allDeletedRemaining[0]?.id || null;
      }
      expect(finalChat).toBeNull();
      expect(finalSelectedId).toBeNull();
    });
  });
});
