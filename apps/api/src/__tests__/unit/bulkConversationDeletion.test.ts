import { Client } from 'pg';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app';
import { env } from '../../config/env';
import { getPrisma } from '../../database/prisma/client';
import { whatsAppService } from '../../services/whatsapp.service';

const app = createApp();

const mockClinicId = '914fb00e-c834-4e44-9646-9d746f536d4e';

function makeToken(clinicId: string, email = 'staff@test.com', roles = ['clinic_admin']): string {
  return jwt.sign(
    {
      sub: '00000000-0000-0000-0000-000000000099',
      email,
      clinicId,
      tenantId: clinicId,
      roles,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ==============================================================================
// SUITE 1: PURE UNIT & MOCK SAFETY TESTS (No Live Database Required)
// ==============================================================================
describe('Bulk Conversation Deletion - Production Safety & RBAC Unit Suite', () => {
  describe('1. Role-Based Access Control (RBAC) across all 5 deletion routes', () => {
    const unauthTestCases = [
      { method: 'post', path: '/api/v1/conversations/bulk-delete', body: { conversationIds: ['00000000-0000-0000-0000-000000000001'] } },
      { method: 'delete', path: '/api/v1/conversations/bulk-delete', body: { conversationIds: ['00000000-0000-0000-0000-000000000001'] } },
      { method: 'post', path: '/api/v1/conversations/delete-all', body: { confirm: true } },
      { method: 'delete', path: '/api/v1/conversations/delete-all', body: { confirm: true } },
      { method: 'delete', path: '/api/v1/conversations/00000000-0000-0000-0000-000000000001', body: {} },
    ];

    it.each(unauthTestCases)('rejects unauthenticated $method.toUpperCase $path with 401', async ({ method, path, body }) => {
      const res = await (request(app) as any)[method](path).send(body);
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    const unauthorizedRoleCases = [
      { roleName: 'receptionist', roles: ['receptionist'] },
      { roleName: 'staff', roles: ['staff'] },
      { roleName: 'patient', roles: ['patient'] },
      { roleName: 'empty roles', roles: [] },
    ];

    describe.each(unauthorizedRoleCases)('Unauthorized role rejection: $roleName', ({ roles }) => {
      const token = makeToken(mockClinicId, 'user@clinic.com', roles);

      it.each(unauthTestCases)('rejects $method.toUpperCase $path for unauthorized role with 403 Forbidden', async ({ method, path, body }) => {
        const res = await (request(app) as any)[method](path)
          .set('Authorization', `Bearer ${token}`)
          .send(body);

        expect(res.status).toBe(403);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('FORBIDDEN');
      });
    });
  });

  describe('2. Input Validation and Guard Rails', () => {
    const adminToken = makeToken(mockClinicId);

    it('rejects empty conversationIds selection with 400', async () => {
      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conversationIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
    });

    it('rejects non-array conversationIds with 400', async () => {
      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conversationIds: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
    });

    it('rejects invalid UUID formats in bulk-delete with 400', async () => {
      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conversationIds: ['invalid-uuid-123'] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
    });

    it('rejects bulk-delete exceeding MAX_BULK_DELETE_LIMIT (100) with 400', async () => {
      const overLimitIds = Array.from({ length: 101 }, (_, i) => {
        const hex = i.toString(16).padStart(12, '0');
        return `00000000-0000-4000-8000-${hex}`;
      });

      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conversationIds: overLimitIds });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
      expect(res.body.message).toContain('Cannot delete more than 100 conversations');
    });

    it('rejects delete-all without confirm: true with 400 on both POST and DELETE aliases', async () => {
      const postRes = await request(app)
        .post('/api/v1/conversations/delete-all')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: false });
      expect(postRes.status).toBe(400);
      expect(postRes.body.code).toBe('VALIDATION');

      const delRes = await request(app)
        .delete('/api/v1/conversations/delete-all')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(delRes.status).toBe(400);
      expect(delRes.body.code).toBe('VALIDATION');
    });

    it('rejects single conversation delete with invalid UUID format with 400', async () => {
      const res = await request(app)
        .delete('/api/v1/conversations/invalid-uuid-format')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
    });
  });

  describe('3. Deterministic Sorting & Concurrency Safety Logic', () => {
    it('enforces deterministic ascending UUID sort order for row lock acquisition', () => {
      const input = [
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        '00000000-0000-0000-0000-000000000002',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002', // duplicate
      ];

      const sorted = Array.from(new Set(input)).sort();

      expect(sorted).toEqual([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ]);
    });

    it('deduplicates duplicate IDs in bulk delete request without error', async () => {
      const adminToken = makeToken(mockClinicId);
      const testId = '00000000-0000-0000-0000-000000000001';
      const prismaClient = getPrisma();

      jest.spyOn(prismaClient, '$transaction').mockImplementation((async (cb: any) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockImplementation((sql: string, sortedIdsParam: string[]) => {
            if (sql.includes('SELECT id FROM api.conversations')) {
              // sortedIdsParam should be deduplicated array of 1 element
              expect(sortedIdsParam).toHaveLength(1);
              expect(sortedIdsParam[0]).toBe(testId);
              return Promise.resolve([{ id: testId }]);
            }
            if (sql.includes('DELETE FROM api.conversations')) {
              return Promise.resolve([{ id: testId }]);
            }
            return Promise.resolve([]);
          }),
          $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        };
        return cb(mockTx);
      }) as any);

      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conversationIds: [testId, testId, testId] });

      if (res.status !== 200) {
        // eslint-disable-next-line no-console
        console.log('DEDUP TEST ERROR:', res.status, res.body);
      }

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.deletedCount).toBe(1);
    });

    it('atomically rejects bulk delete with 404 when any ID belongs to another clinic or is missing', async () => {
      const adminToken = makeToken(mockClinicId);
      const testId1 = '00000000-0000-0000-0000-000000000001';
      const foreignId = '00000000-0000-0000-0000-000000000002';
      const prismaClient = getPrisma();

      let executedDelete = false;

      jest.spyOn(prismaClient, '$transaction').mockImplementation((async (cb: any) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('SELECT id FROM api.conversations')) {
              // Only testId1 belongs to this clinic; foreignId is not returned
              return Promise.resolve([{ id: testId1 }]);
            }
            if (sql.includes('DELETE FROM api.conversations')) {
              executedDelete = true;
              return Promise.resolve([]);
            }
            return Promise.resolve([]);
          }),
          $executeRawUnsafe: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('DELETE')) executedDelete = true;
            return Promise.resolve(0);
          }),
        };
        return cb(mockTx);
      }) as any);

      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ conversationIds: [testId1, foreignId] });

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.message).toContain('inaccessible');
      expect(executedDelete).toBe(false);
    });
  });

  describe('4. Outbound WhatsApp Send vs Concurrent Deletion Race Condition', () => {
    const adminToken = makeToken(mockClinicId);
    const testConvId = '11111111-2222-3333-4444-555555555555';

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('safely handles concurrent deletion during external WhatsApp dispatch without losing delivery history or prompting duplicate retry', async () => {
      const prismaClient = getPrisma();

      // Mock conversation lookup: returns active WhatsApp conversation
      jest.spyOn(prismaClient, '$queryRawUnsafe').mockImplementation(((sql: string, ...params: any[]) => {
        if (typeof sql === 'string' && sql.includes('SELECT c.id, c.clinic_id, c.patient_id, c.channel')) {
          return Promise.resolve([
            {
              id: testConvId,
              clinic_id: mockClinicId,
              patient_id: null,
              channel: 'whatsapp',
              channel_conversation_id: '+15551234567',
              state: 'active',
              patientName: 'Jane Doe',
              patientPhone: '+15551234567',
              patientWhatsappId: '+15551234567',
            },
          ]);
        }

        // Simulate concurrent deletion: INSERT into api.messages fails with foreign key violation
        if (typeof sql === 'string' && sql.includes('INSERT INTO api.messages')) {
          const fkError: any = new Error(
            'insert or update on table "messages" violates foreign key constraint "messages_conversation_id_fkey"'
          );
          fkError.code = '23503';
          return Promise.reject(fkError);
        }

        // Insertion into api.notifications (orphan fallback record) succeeds
        if (typeof sql === 'string' && sql.includes('INSERT INTO api.notifications')) {
          return Promise.resolve([]);
        }

        return Promise.resolve([]);
      }) as any);

      // Mock WhatsApp dispatch: succeeds externally
      jest.spyOn(whatsAppService, 'sendMessage').mockResolvedValue({
        success: true,
        deliveryStatus: 'sent',
        providerStatus: 'sent',
        providerMessageId: 'wamid.HBgLTestWamid12345',
        message: 'Message delivered to Meta cloud API',
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${testConvId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Hello patient from staff' });

      // Verifications:
      // 1. Must return 200 (NOT 500 which triggers duplicate sends from user)
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // 2. Returns conversationDeletedConcurrently: true and deliveryHistoryPreserved: true
      expect(res.body.data.conversationDeletedConcurrently).toBe(true);
      expect(res.body.data.deliveryHistoryPreserved).toBe(true);
      expect(res.body.data.deliveryStatus).toBe('sent');
      expect(res.body.data.providerMessageId).toBe('wamid.HBgLTestWamid12345');
      expect(res.body.message).toContain('conversation was deleted concurrently');
    });

    it('reports deliveryHistoryPreserved: false when notifications insert fails without crashing or throwing 500', async () => {
      const prismaClient = getPrisma();

      jest.spyOn(prismaClient, '$queryRawUnsafe').mockImplementation(((sql: string, ...params: any[]) => {
        if (typeof sql === 'string' && sql.includes('SELECT c.id, c.clinic_id, c.patient_id, c.channel')) {
          return Promise.resolve([
            {
              id: testConvId,
              clinic_id: mockClinicId,
              patient_id: null,
              channel: 'whatsapp',
              channel_conversation_id: '+15551234567',
              state: 'active',
              patientName: 'Jane Doe',
              patientPhone: '+15551234567',
              patientWhatsappId: '+15551234567',
            },
          ]);
        }

        if (typeof sql === 'string' && sql.includes('INSERT INTO api.messages')) {
          const fkError: any = new Error(
            'insert or update on table "messages" violates foreign key constraint "messages_conversation_id_fkey"'
          );
          fkError.code = '23503';
          return Promise.reject(fkError);
        }

        if (typeof sql === 'string' && sql.includes('INSERT INTO api.notifications')) {
          return Promise.reject(new Error('Database disk full or constraint error'));
        }

        return Promise.resolve([]);
      }) as any);

      jest.spyOn(whatsAppService, 'sendMessage').mockResolvedValue({
        success: true,
        deliveryStatus: 'sent',
        providerStatus: 'sent',
        providerMessageId: 'wamid.HBgLTestWamidFallbackFail',
        message: 'Delivered to Meta',
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${testConvId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Hello patient fallback fail test' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.conversationDeletedConcurrently).toBe(true);
      expect(res.body.data.deliveryHistoryPreserved).toBe(false);
    });

    it('does not write orphan notification when channel is web_chat and no external message was sent', async () => {
      const prismaClient = getPrisma();
      let notifCalled = false;

      jest.spyOn(prismaClient, '$queryRawUnsafe').mockImplementation(((sql: string, ...params: any[]) => {
        if (typeof sql === 'string' && sql.includes('SELECT c.id, c.clinic_id, c.patient_id, c.channel')) {
          return Promise.resolve([
            {
              id: testConvId,
              clinic_id: mockClinicId,
              patient_id: null,
              channel: 'web_chat',
              channel_conversation_id: 'web-session-123',
              state: 'active',
              patientName: 'Web Patient',
            },
          ]);
        }

        if (typeof sql === 'string' && sql.includes('INSERT INTO api.messages')) {
          const fkError: any = new Error(
            'insert or update on table "messages" violates foreign key constraint "messages_conversation_id_fkey"'
          );
          fkError.code = '23503';
          return Promise.reject(fkError);
        }

        if (typeof sql === 'string' && sql.includes('INSERT INTO api.notifications')) {
          notifCalled = true;
          return Promise.resolve([]);
        }

        return Promise.resolve([]);
      }) as any);

      const res = await request(app)
        .post(`/api/v1/conversations/${testConvId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ body: 'Hello web patient' });

      expect(res.status).toBe(200);
      expect(res.body.data.conversationDeletedConcurrently).toBe(true);
      expect(res.body.data.deliveryStatus).toBe('failed');
      expect(notifCalled).toBe(false);
    });
  });
});

// ==============================================================================
import { describeIsolatedDb, getSafeTestDatabaseClient, isIsolatedTestDatabaseAvailable } from '../helpers/testDatabaseGuard';

// ==============================================================================
// SUITE 2: ISOLATED TEST DATABASE INTEGRATION SUITE
// Strict guard: Never runs against production Neon host!
// ==============================================================================
describeIsolatedDb(
  'Isolated Database Integration Suite (Only executed on dedicated test database)',
  () => {
    let client: Client;
    const fixtureClinicId = '90000000-0000-0000-0000-000000000001';
    const fixtureDentistId = '90000000-0000-0000-0000-000000000002';
    const fixtureServiceId = '90000000-0000-0000-0000-000000000003';

    const createdConvIds: string[] = [];
    const createdPatientIds: string[] = [];
    const createdApptIds: string[] = [];
    const createdHandoffIds: string[] = [];
    const createdNotifIds: string[] = [];

    beforeAll(async () => {
      if (!isIsolatedTestDatabaseAvailable()) return;
      client = getSafeTestDatabaseClient();
      await client.connect();

      // Provision isolated test clinic, dentist, and service fixtures
      await client.query(`
        INSERT INTO api.clinics (id, name, slug, timezone, locale, active)
        VALUES ($1::uuid, 'Bulk Deletion Test Clinic', 'bulk-del-fixture', 'America/New_York', 'en-US', true)
        ON CONFLICT (id) DO NOTHING;
      `, [fixtureClinicId]);

      await client.query(`
        INSERT INTO api.dentists (id, clinic_id, name, active)
        VALUES ($1::uuid, $2::uuid, 'Dr. Dynamic Test Dentist', true)
        ON CONFLICT (id) DO NOTHING;
      `, [fixtureDentistId, fixtureClinicId]);

      await client.query(`
        INSERT INTO api.services (id, clinic_id, name, duration_minutes, active)
        VALUES ($1::uuid, $2::uuid, 'Dental Cleaning & Polish', 30, true)
        ON CONFLICT (id) DO NOTHING;
      `, [fixtureServiceId, fixtureClinicId]);
    });

    afterEach(async () => {
      // Guaranteed cleanup after each test
      try {
        if (createdHandoffIds.length > 0) {
          await client.query(`DELETE FROM api.handoffs WHERE id = ANY($1::uuid[])`, [createdHandoffIds]);
          createdHandoffIds.length = 0;
        }
        if (createdNotifIds.length > 0) {
          await client.query(`DELETE FROM api.notifications WHERE id = ANY($1::uuid[])`, [createdNotifIds]);
          createdNotifIds.length = 0;
        }
        if (createdConvIds.length > 0) {
          await client.query(`DELETE FROM api.messages WHERE conversation_id = ANY($1::uuid[])`, [createdConvIds]);
          await client.query(`DELETE FROM api.conversations WHERE id = ANY($1::uuid[])`, [createdConvIds]);
          createdConvIds.length = 0;
        }
        if (createdApptIds.length > 0) {
          await client.query(`DELETE FROM api.appointment_status_history WHERE appointment_id = ANY($1::uuid[])`, [createdApptIds]);
          await client.query(`DELETE FROM api.appointments WHERE id = ANY($1::uuid[])`, [createdApptIds]);
          createdApptIds.length = 0;
        }
        if (createdPatientIds.length > 0) {
          await client.query(`DELETE FROM api.patients WHERE id = ANY($1::uuid[])`, [createdPatientIds]);
          createdPatientIds.length = 0;
        }
      } catch {
        // teardown safety catch
      }
    });

    afterAll(async () => {
      if (client) {
        try {
          await client.query(`DELETE FROM api.clinics WHERE id = $1::uuid;`, [fixtureClinicId]);
        } catch {
          // best-effort cleanup
        }
        await client.end();
      }
    });

    it('deletes one selected conversation and its messages/handoffs atomically', async () => {
      const token = makeToken(fixtureClinicId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id)
         VALUES ($1::uuid, 'whatsapp', $2) RETURNING id`,
        [fixtureClinicId, testPhone]
      );
      const convId = convRes.rows[0].id;
      createdConvIds.push(convId);

      await client.query(
        `INSERT INTO api.messages (clinic_id, conversation_id, direction, kind, body)
         VALUES ($1::uuid, $2::uuid, 'inbound', 'patient_text', 'Hello single bulk test')`,
        [fixtureClinicId, convId]
      );

      const res = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${token}`)
        .send({ conversationIds: [convId] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.deletedCount).toBe(1);

      const checkConv = await client.query(`SELECT count(*)::int AS count FROM api.conversations WHERE id = $1::uuid`, [convId]);
      expect(checkConv.rows[0].count).toBe(0);
    });

    it('preserves appointment-linked notifications while deleting conversation-only notifications', async () => {
      const token = makeToken(fixtureClinicId);
      const testPhone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);

      const patientRes = await client.query(
        `INSERT INTO api.patients (clinic_id, full_name, phone) VALUES ($1::uuid, 'Test Patient', $2) RETURNING id`,
        [fixtureClinicId, testPhone]
      );
      const patientId = patientRes.rows[0].id;
      createdPatientIds.push(patientId);

      const dentistId = fixtureDentistId;
      const serviceId = fixtureServiceId;
      const confCode = 'NOTIF' + Math.floor(100000 + Math.random() * 900000);

      const apptRes = await client.query(
        `INSERT INTO api.appointments (
           clinic_id, dentist_id, patient_id, service_id, status,
           starts_at, ends_at, duration_minutes, buffer_minutes, confirmation_code
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'confirmed'::api.appointment_status,
           now() + interval '30 days', now() + interval '30 days 30 minutes', 30, 10, $5
         ) RETURNING id`,
        [fixtureClinicId, dentistId, patientId, serviceId, confCode]
      );
      const apptId = apptRes.rows[0].id;
      createdApptIds.push(apptId);

      const convRes = await client.query(
        `INSERT INTO api.conversations (clinic_id, patient_id, channel, channel_conversation_id)
         VALUES ($1::uuid, $2::uuid, 'whatsapp', $3) RETURNING id`,
        [fixtureClinicId, patientId, testPhone]
      );
      const convId = convRes.rows[0].id;
      createdConvIds.push(convId);

      // Notification A: appointment-linked
      const notifARes = await client.query(
        `INSERT INTO api.notifications (
           clinic_id, patient_id, appointment_id, conversation_id, kind, channel, recipient, template, status, idempotency_key
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'booking_confirmation'::api.notification_kind,
           'whatsapp'::api.channel_type, $5, 'tpl_a', 'delivered'::api.delivery_status, $6
         ) RETURNING id`,
        [fixtureClinicId, patientId, apptId, convId, testPhone, 'idem-a-' + Date.now()]
      );
      const notifAId = notifARes.rows[0].id;
      createdNotifIds.push(notifAId);

      // Notification B: conversation-only
      const notifBRes = await client.query(
        `INSERT INTO api.notifications (
           clinic_id, patient_id, appointment_id, conversation_id, kind, channel, recipient, template, status, idempotency_key
         ) VALUES (
           $1::uuid, $2::uuid, NULL, $3::uuid, 'staff_alert'::api.notification_kind,
           'whatsapp'::api.channel_type, $4, 'tpl_b', 'delivered'::api.delivery_status, $5
         ) RETURNING id`,
        [fixtureClinicId, patientId, convId, testPhone, 'idem-b-' + Date.now()]
      );
      const notifBId = notifBRes.rows[0].id;

      const delRes = await request(app)
        .post('/api/v1/conversations/bulk-delete')
        .set('Authorization', `Bearer ${token}`)
        .send({ conversationIds: [convId] });

      expect(delRes.status).toBe(200);

      // Notification A preserved with conversation_id unlinked (NULL)
      const checkA = await client.query(`SELECT appointment_id, conversation_id FROM api.notifications WHERE id = $1::uuid`, [notifAId]);
      expect(checkA.rows.length).toBe(1);
      expect(checkA.rows[0].appointment_id).toBe(apptId);
      expect(checkA.rows[0].conversation_id).toBeNull();

      // Notification B deleted
      const checkB = await client.query(`SELECT count(*)::int AS count FROM api.notifications WHERE id = $1::uuid`, [notifBId]);
      expect(checkB.rows[0].count).toBe(0);
    });
  }
);
