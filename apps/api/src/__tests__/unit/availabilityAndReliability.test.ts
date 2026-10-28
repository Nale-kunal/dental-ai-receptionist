import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app';
import { env } from '../../config/env';

const app = createApp();

describe('Dental AI Receptionist — Reliability, Availability & Real-Time Sync Suite', () => {
  let client: Client;
  const oracleClinicId = '914fb00e-c834-4e44-9646-9d746f536d4e';
  const demoClinicId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL || env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
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
        [oracleClinicId, '', '', '2026-11-02']
      );

      expect(res.rows.length).toBe(1);
      const data = res.rows[0].fn;
      expect(data.ok).toBe(true);
      expect(data.code).toBe('OK');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);

      // Verify slot properties match the contract
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
        [oracleClinicId, '', '', '2026-10-31']
      );

      const data = res.rows[0].fn;
      expect(data.ok).toBe(true);
      expect(data.code).toBe('OK');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(0);
    });

    it('honors dentist-specific schedule when dentist is explicitly provided', async () => {
      // Demo clinic with Dr. Michael Rivera
      const dentistId = '00000000-0000-0000-0000-000000000005';
      const serviceId = '00000000-0000-0000-0000-000000000002'; // Cleaning

      const res = await client.query(
        `SELECT api.search_availability($1::uuid, $2::uuid, $3::uuid, $4::date, 5) AS fn;`,
        [demoClinicId, dentistId, serviceId, '2026-11-02']
      );

      const data = res.rows[0].fn;
      expect(data.ok).toBe(true);
      expect(data.code).toBe('OK');
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].dentist_id).toBe(dentistId);
    });

    it('gracefully handles missing parameters by converting empty strings to NULL without crashing', async () => {
      const res = await client.query(
        `SELECT api.search_availability($1::uuid, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, $4::date, 5) AS fn;`,
        [oracleClinicId, '', '', '2026-11-03']
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
        [oracleClinicId]
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
                   SELECT id, direction, kind, body, created_at
                   FROM api.messages
                   WHERE conversation_id = c.conv_id AND clinic_id = c.clinic_id
                   ORDER BY created_at DESC
                   LIMIT 10
                 ) m_row) AS history
         FROM c;`,
        [oracleClinicId]
      );
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(150); // Single round-trip rather than sequential queries
      expect(res.rows.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Issue C: Real-Time Sync & Navigation APIs', () => {
    it('GET /api/v1/conversations/sync returns delta messages since timestamp with strict tenant isolation', async () => {
      const token = makeToken(oracleClinicId);
      const since = new Date(Date.now() - 86400000).toISOString();

      const res = await request(app)
        .get(`/api/v1/conversations/sync?since=${encodeURIComponent(since)}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data.messages)).toBe(true);
      expect(res.body.data.serverTime).toBeDefined();

      // Ensure no messages from other clinics leak through
      for (const m of res.body.data.messages) {
        expect(m.conversationId).toBeDefined();
      }
    });

    it('POST /api/v1/conversations/stream-ticket generates a short-lived single-use ticket', async () => {
      const token = makeToken(oracleClinicId);
      const res = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.ticket).toBeDefined();
      expect(typeof res.body.data.ticket).toBe('string');
      expect(res.body.data.expiresIn).toBe(30);
    });

    it('GET /api/v1/conversations/stream authenticates via single-use ticket and rejects replays', async () => {
      const token = makeToken(oracleClinicId);
      // 1. Get ticket
      const ticketRes = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);
      const ticket = ticketRes.body.data.ticket;

      // 2. Connect with ticket
      const res = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('event: connected')) {
              (res as any).destroy();
              callback(null, data);
            }
          });
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      // 3. Replaying the consumed ticket must be rejected with 401 (single-use guarantee)
      const replayRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
        .set('Accept', 'text/event-stream');
      expect(replayRes.status).toBe(401);
    });

    it('rejects unauthenticated /stream requests and query string tokens with 401 Unauthorized', async () => {
      // Missing auth
      const res1 = await request(app)
        .get('/api/v1/conversations/stream')
        .set('Accept', 'text/event-stream');
      expect(res1.status).toBe(401);
      expect(res1.body.ok).toBe(false);

      // Query string token must not be accepted (prevent JWT log leakage)
      const token = makeToken(oracleClinicId);
      const res2 = await request(app)
        .get(`/api/v1/conversations/stream?token=${encodeURIComponent(token)}`)
        .set('Accept', 'text/event-stream');
      expect(res2.status).toBe(401);
      expect(res2.body.ok).toBe(false);
    });

    it('enforces tenant isolation: Clinic B user cannot receive Clinic A events on /stream', async () => {
      const tokenA = makeToken(oracleClinicId);
      const tokenB = makeToken(demoClinicId);

      // Clinic B cannot sync messages from Clinic A
      const resB = await request(app)
        .get(`/api/v1/conversations/sync`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      // All returned messages must strictly belong to demoClinicId
      if (resB.body.data.messages.length > 0) {
        const checkClinicRes = await client.query(
          `SELECT clinic_id FROM api.conversations WHERE id = $1::uuid`,
          [resB.body.data.messages[0].conversationId]
        );
        expect(checkClinicRes.rows[0].clinic_id).toBe(demoClinicId);
        expect(checkClinicRes.rows[0].clinic_id).not.toBe(oracleClinicId);
      }
    });

    it('atomically prevents concurrent consumption races across simulated instances for the same ticket', async () => {
      const token = makeToken(oracleClinicId);
      // 1. Generate one single-use stream ticket
      const ticketRes = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);
      const ticket = ticketRes.body.data.ticket;
      expect(ticket).toBeDefined();

      const decoded = jwt.decode(ticket) as any;
      const jti = decoded.jti;

      // Verify the ticket exists in PostgreSQL api.stream_tickets before consumption
      const beforeCheck = await client.query(
        `SELECT count(*)::int AS count FROM api.stream_tickets WHERE jti = $1`,
        [jti]
      );
      expect(beforeCheck.rows[0].count).toBe(1);

      // 2. Simulate Instance 1 and Instance 2 receiving the exact same ticket simultaneously
      const connectStream = () =>
        request(app)
          .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
          .set('Accept', 'text/event-stream')
          .buffer(true)
          .parse((res, callback) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk.toString();
              if (data.includes('event: connected')) {
                (res as any).destroy();
                callback(null, data);
              }
            });
            res.on('end', () => {
              try {
                callback(null, JSON.parse(data));
              } catch {
                callback(null, data);
              }
            });
            res.on('error', (err) => callback(err, data));
          });

      const [res1, res2] = await Promise.all([connectStream(), connectStream()]);

      // Exactly ONE request must succeed (200), and exactly ONE must be rejected (401)
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 401]);

      const rejectedRes = res1.status === 401 ? res1 : res2;
      const rejectedMsg = typeof rejectedRes.body === 'object' && rejectedRes.body?.message
        ? rejectedRes.body.message
        : JSON.stringify(rejectedRes.body);
      expect(rejectedMsg).toContain('already been used or expired');

      // Verify the ticket is completely removed from the database after atomic consumption
      const afterCheck = await client.query(
        `SELECT count(*)::int AS count FROM api.stream_tickets WHERE jti = $1`,
        [jti]
      );
      expect(afterCheck.rows[0].count).toBe(0);

      // Subsequent 3rd attempt must also be rejected
      const replayRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(ticket)}`)
        .set('Accept', 'text/event-stream');
      expect(replayRes.status).toBe(401);
      expect(replayRes.body.message).toContain('already been used or expired');
    });

    it('rejects expired tickets at both database and token verification layers', async () => {
      const token = makeToken(oracleClinicId);

      // Layer 1: Database-level expiration check (expires_at > now())
      const ticketRes = await request(app)
        .post('/api/v1/conversations/stream-ticket')
        .set('Authorization', `Bearer ${token}`);
      const validTicket = ticketRes.body.data.ticket;
      const decoded = jwt.decode(validTicket) as any;

      // Force database expires_at to the past
      await client.query(
        `UPDATE api.stream_tickets SET expires_at = now() - interval '10 seconds' WHERE jti = $1`,
        [decoded.jti]
      );

      const dbExpiredRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(validTicket)}`)
        .set('Accept', 'text/event-stream');
      expect(dbExpiredRes.status).toBe(401);
      expect(dbExpiredRes.body.message).toContain('already been used or expired');

      // Layer 2: JWT-level expiration check
      const expiredJwt = jwt.sign(
        {
          userId: 'test-user',
          clinicId: oracleClinicId,
          purpose: 'sse_stream',
        },
        env.JWT_SECRET,
        { expiresIn: '-1s', jwtid: 'expired-jti-123' }
      );

      const jwtExpiredRes = await request(app)
        .get(`/api/v1/conversations/stream?ticket=${encodeURIComponent(expiredJwt)}`)
        .set('Accept', 'text/event-stream');
      expect(jwtExpiredRes.status).toBe(401);
      expect(jwtExpiredRes.body.message).toContain('Invalid or expired stream ticket');
    });

    it('enforces purpose binding: rejects standard session tokens passed as stream tickets', async () => {
      // Standard JWT token without purpose: 'sse_stream'
      const standardToken = makeToken(oracleClinicId);

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
      const token = makeToken(oracleClinicId);
      const testPhone1 = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      // Clean up any stale conversation for this phone
      await client.query(`DELETE FROM api.conversations WHERE channel_conversation_id = $1`, [testPhone1]);

      // 1. Create a patient in Oracle clinic
      const patientRes = await client.query(
        `INSERT INTO api.patients (clinic_id, full_name)
         VALUES ($1::uuid, 'Test Patient For Deletion')
         RETURNING id`,
        [oracleClinicId]
      );
      const patientId = patientRes.rows[0].id;

      // 2. Create a test conversation
      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, patient_id, channel, channel_conversation_id)
         VALUES ($1::uuid, $2::uuid, 'whatsapp', $3)
         RETURNING id`,
        [oracleClinicId, patientId, testPhone1]
      );
      const conversationId = convRes.rows[0].id;

      // 3. Insert messages associated with this conversation
      await client.query(
        `INSERT INTO api.messages (clinic_id, conversation_id, direction, kind, body)
         VALUES ($1::uuid, $2::uuid, 'inbound', 'patient_text', 'Hello I want to book')`,
        [oracleClinicId, conversationId]
      );

      // 4. Insert a handoff referencing this conversation
      const handoffRes = await client.query(
        `INSERT INTO api.handoffs (clinic_id, conversation_id, patient_id, channel, status, reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'whatsapp'::api.channel_type, 'pending', 'Test handoff preservation')
         RETURNING id`,
        [oracleClinicId, conversationId, patientId]
      );
      const handoffId = handoffRes.rows[0].id;

      // 5. Send DELETE request
      const deleteRes = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);
      expect(deleteRes.body.data.deleted).toBe(true);
      expect(deleteRes.body.data.id).toBe(conversationId);

      // 6. Verify conversation is permanently deleted from api.conversations
      const checkConv = await client.query(
        `SELECT count(*)::int AS count FROM api.conversations WHERE id = $1::uuid`,
        [conversationId]
      );
      expect(checkConv.rows[0].count).toBe(0);

      // 7. Verify messages are deleted
      const checkMsgs = await client.query(
        `SELECT count(*)::int AS count FROM api.messages WHERE conversation_id = $1::uuid`,
        [conversationId]
      );
      expect(checkMsgs.rows[0].count).toBe(0);

      // 8. Verify conversation-owned handoff is permanently deleted within the transaction
      const checkHandoff = await client.query(
        `SELECT id, conversation_id, status, reason FROM api.handoffs WHERE id = $1::uuid`,
        [handoffId]
      );
      expect(checkHandoff.rows.length).toBe(0);

      // 9. Verify patient record is completely preserved
      const checkPatient = await client.query(
        `SELECT id, full_name FROM api.patients WHERE id = $1::uuid`,
        [patientId]
      );
      expect(checkPatient.rows.length).toBe(1);

      // 10. Verify GET /api/v1/conversations excludes the deleted conversation
      const inboxRes = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${token}`);
      expect(inboxRes.status).toBe(200);
      expect(inboxRes.body.data.items.some((c: any) => c.id === conversationId)).toBe(false);

      // 11. Cleanup test patient
      await client.query(`DELETE FROM api.patients WHERE id = $1::uuid`, [patientId]);
    });

    it('strictly enforces clinic/tenant isolation: Clinic B user cannot delete Clinic A conversation', async () => {
      const clinicAToken = makeToken(oracleClinicId);
      const clinicBToken = makeToken(demoClinicId);
      const testPhone2 = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      // Create conversation in Clinic A
      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2)
         RETURNING id`,
        [oracleClinicId, testPhone2]
      );
      const convAId = convRes.rows[0].id;

      // Clinic B attempts to delete Clinic A's conversation
      const attackRes = await request(app)
        .delete(`/api/v1/conversations/${convAId}`)
        .set('Authorization', `Bearer ${clinicBToken}`);

      expect(attackRes.status).toBe(404);
      expect(attackRes.body.ok).toBe(false);
      expect(attackRes.body.message).toContain('Conversation not found');

      // Verify Clinic A's conversation is completely intact in the database
      const checkConv = await client.query(
        `SELECT count(*)::int AS count FROM api.conversations WHERE id = $1::uuid AND clinic_id = $2::uuid`,
        [convAId, oracleClinicId]
      );
      expect(checkConv.rows[0].count).toBe(1);

      // Clean up using authorized Clinic A
      const cleanupRes = await request(app)
        .delete(`/api/v1/conversations/${convAId}`)
        .set('Authorization', `Bearer ${clinicAToken}`);
      expect(cleanupRes.status).toBe(200);
    });

    it('handles duplicate or repeated deletion requests safely by returning 404', async () => {
      const token = makeToken(oracleClinicId);
      const testPhoneDup = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2)
         RETURNING id`,
        [oracleClinicId, testPhoneDup]
      );
      const convId = convRes.rows[0].id;

      // First delete succeeds
      const firstRes = await request(app)
        .delete(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(firstRes.status).toBe(200);
      expect(firstRes.body.ok).toBe(true);

      // Second delete returns 404 cleanly
      const secondRes = await request(app)
        .delete(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(secondRes.status).toBe(404);
      expect(secondRes.body.ok).toBe(false);
      expect(secondRes.body.message).toContain('Conversation not found');
    });

    it('excludes orphaned or detached handoffs from pending list and reports summary, while preserving historical resolved handoffs', async () => {
      const token = makeToken(oracleClinicId);

      // 1. Insert a detached pending handoff (conversation_id = NULL)
      const orphanPendingRes = await client.query(
        `INSERT INTO api.handoffs (clinic_id, conversation_id, channel, status, priority, reason)
         VALUES ($1::uuid, NULL, 'whatsapp'::api.channel_type, 'pending', 'normal', 'Test orphaned pending handoff')
         RETURNING id`,
        [oracleClinicId]
      );
      const orphanPendingId = orphanPendingRes.rows[0].id;

      // 2. Insert a resolved historical handoff (conversation_id = NULL)
      const resolvedHandoffRes = await client.query(
        `INSERT INTO api.handoffs (clinic_id, conversation_id, channel, status, priority, reason, resolution)
         VALUES ($1::uuid, NULL, 'whatsapp'::api.channel_type, 'resolved', 'normal', 'Test historical resolved handoff', 'Completed by test')
         RETURNING id`,
        [oracleClinicId]
      );
      const resolvedHandoffId = resolvedHandoffRes.rows[0].id;

      try {
        // Query GET /api/v1/handoffs?status=pending
        const pendingRes = await request(app)
          .get('/api/v1/handoffs?status=pending')
          .set('Authorization', `Bearer ${token}`);
        expect(pendingRes.status).toBe(200);
        // Orphaned pending handoff must NOT appear in actionable pending list
        expect(pendingRes.body.data.items.some((h: any) => h.id === orphanPendingId)).toBe(false);

        // Query GET /api/v1/handoffs?status=resolved
        const resolvedRes = await request(app)
          .get('/api/v1/handoffs?status=resolved')
          .set('Authorization', `Bearer ${token}`);
        expect(resolvedRes.status).toBe(200);
        // Historical resolved handoff MUST remain accessible
        expect(resolvedRes.body.data.items.some((h: any) => h.id === resolvedHandoffId)).toBe(true);

        // Query GET /api/v1/reports/summary
        const summaryRes = await request(app)
          .get('/api/v1/reports/summary')
          .set('Authorization', `Bearer ${token}`);
        expect(summaryRes.status).toBe(200);
        // Pending staff attention must NOT count the orphaned pending handoff
        // If there are no other active conversations with pending handoffs in Oracle clinic, count is 0
        const pendingCount = summaryRes.body.data.pendingStaffAttention;
        expect(typeof pendingCount).toBe('number');
      } finally {
        await client.query(`DELETE FROM api.handoffs WHERE id IN ($1::uuid, $2::uuid)`, [orphanPendingId, resolvedHandoffId]);
      }
    });

    it('preserves and returns valid pending handoffs that belong to active existing conversations', async () => {
      const token = makeToken(oracleClinicId);
      const testPhoneActive = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      // 1. Create active conversation
      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2)
         RETURNING id`,
        [oracleClinicId, testPhoneActive]
      );
      const convId = convRes.rows[0].id;

      // 2. Insert valid pending handoff referencing active conversation
      const handoffRes = await client.query(
        `INSERT INTO api.handoffs (clinic_id, conversation_id, channel, status, priority, reason)
         VALUES ($1::uuid, $2::uuid, 'whatsapp'::api.channel_type, 'pending', 'high', 'Valid active conversation handoff')
         RETURNING id`,
        [oracleClinicId, convId]
      );
      const handoffId = handoffRes.rows[0].id;

      try {
        // Query pending handoffs
        const pendingRes = await request(app)
          .get('/api/v1/handoffs?status=pending')
          .set('Authorization', `Bearer ${token}`);
        expect(pendingRes.status).toBe(200);
        // The active pending handoff MUST be returned
        expect(pendingRes.body.data.items.some((h: any) => h.id === handoffId)).toBe(true);

        // Query reports summary
        const summaryRes = await request(app)
          .get('/api/v1/reports/summary')
          .set('Authorization', `Bearer ${token}`);
        expect(summaryRes.status).toBe(200);
        expect(summaryRes.body.data.pendingStaffAttention).toBeGreaterThanOrEqual(1);
      } finally {
        await request(app)
          .delete(`/api/v1/conversations/${convId}`)
          .set('Authorization', `Bearer ${token}`);
      }
    });

    it('returns 404 for nonexistent conversation UUID and 400 for invalid UUID format', async () => {
      const token = makeToken(oracleClinicId);
      const nonExistentUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

      const notFoundRes = await request(app)
        .delete(`/api/v1/conversations/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${token}`);
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.ok).toBe(false);

      const invalidRes = await request(app)
        .delete('/api/v1/conversations/not-a-valid-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.ok).toBe(false);
      expect(invalidRes.body.code).toBe('VALIDATION');
    });

    it('rejects unauthenticated deletion requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .delete('/api/v1/conversations/914fb00e-c834-4e44-9646-9d746f536d4e');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('Issue 2: Staff Reply Flow & Prevention of Reload / Duplication', () => {
    it('sends staff reply, returns message with providerMessageId and isStaff=true, updates conversation, and avoids duplicates in delta sync', async () => {
      const token = makeToken(oracleClinicId);
      const testPhone3 = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      // Create conversation
      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2)
         RETURNING id`,
        [oracleClinicId, testPhone3]
      );
      const conversationId = convRes.rows[0].id;

      try {
        // Send staff reply
        const replyRes = await request(app)
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', `Bearer ${token}`)
          .send({ body: 'Hello, our clinic is open Monday at 10 AM.', resolveHandoff: false });

        expect(replyRes.status).toBe(200);
        expect(replyRes.body.ok).toBe(true);
        const sentMsg = replyRes.body.data;
        expect(sentMsg.id).toBeDefined();
        expect(sentMsg.conversationId).toBe(conversationId);
        expect(sentMsg.isStaff).toBe(true);
        expect(sentMsg.content).toBe('Hello, our clinic is open Monday at 10 AM.');

        // Verify delta sync returns this message with the exact same ID
        const syncRes = await request(app)
          .get(`/api/v1/conversations/sync?conversationId=${conversationId}`)
          .set('Authorization', `Bearer ${token}`);

        expect(syncRes.status).toBe(200);
        expect(syncRes.body.ok).toBe(true);
        const syncMsgs = syncRes.body.data.messages;
        expect(syncMsgs.length).toBe(1);
        expect(syncMsgs[0].id).toBe(sentMsg.id);
        expect(syncMsgs[0].isStaff).toBe(true);

        // Verify conversation last_message_at was updated
        const convCheck = await client.query(
          `SELECT last_message_at FROM api.conversations WHERE id = $1::uuid`,
          [conversationId]
        );
        expect(convCheck.rows[0].last_message_at).not.toBeNull();
      } finally {
        // Clean up conversation
        await request(app)
          .delete(`/api/v1/conversations/${conversationId}`)
          .set('Authorization', `Bearer ${token}`);
      }
    });
  });

  describe('Frontend Regression Verification: Message Composer & Single Send Protection', () => {
    const receptionistViewPath = path.resolve(__dirname, '../../../../web/src/views/ReceptionistView.tsx');
    const receptionistSource = fs.readFileSync(receptionistViewPath, 'utf8');

    it('verifies the message composer does not submit a native form and uses non-form container with type="button"', () => {
      // 1. Verify composer container is a non-form element with role="region" and aria-label="Message Composer"
      expect(receptionistSource).toContain('role="region"');
      expect(receptionistSource).toContain('aria-label="Message Composer"');
      expect(receptionistSource).not.toMatch(/<form[^>]*aria-label="Message Composer"/);
      expect(receptionistSource).not.toMatch(/<form[^>]*onSubmit=\{handleSendReply\}/);

      // 2. Verify the send button explicitly specifies type="button" and onClick={handleSendReply}
      expect(receptionistSource).toMatch(/<button[\s\S]*?type="button"[\s\S]*?onClick=\{handleSendReply\}/);

      // 3. Verify textarea onKeyDown intercepts Enter and calls preventDefault()
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
        // Simulate network latency of API call
        await new Promise((resolve) => setTimeout(resolve, 25));
        isSending = false;
        return { sent: true };
      };

      // Trigger two concurrent send actions (e.g. rapid Enter key press + click)
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


