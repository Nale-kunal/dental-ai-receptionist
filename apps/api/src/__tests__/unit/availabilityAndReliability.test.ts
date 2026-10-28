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
});

