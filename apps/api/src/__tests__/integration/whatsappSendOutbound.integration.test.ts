/**
 * whatsappSendOutbound.integration.test.ts
 *
 * Database Integration Suite for Outbound WhatsApp Send API.
 * STRICT SAFETY RULE: Only runs when TEST_DATABASE_URL is explicitly configured to an
 * isolated, non-production test database. Never touches production Neon.
 */

import request from 'supertest';
import { createApp } from '../../app';
import { Pool } from 'pg';
import { env } from '../../config/env';
import { whatsAppService } from '../../services/whatsapp.service';
import { encryptSecret } from '../../utils/encryption';
import {
  describeIsolatedDb,
  getSafeTestDatabasePool,
  isIsolatedTestDatabaseAvailable,
} from '../helpers/testDatabaseGuard';

describeIsolatedDb('Machine-to-Machine Outbound WhatsApp Send API (n8n integration) (Isolated DB)', () => {
  let app: any;
  let pool: Pool;

  const testServiceKey = 'test-internal-service-key-32chars!!';
  const testClinicId = '60000000-0000-0000-0000-000000000001';
  const tempClinicId = '60000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    if (!isIsolatedTestDatabaseAvailable()) return;

    process.env.INTERNAL_SERVICE_KEY = testServiceKey;
    (env as any).INTERNAL_SERVICE_KEY = testServiceKey;

    app = createApp();
    pool = getSafeTestDatabasePool();

    await pool.query(`
      INSERT INTO api.clinics (id, name, slug, timezone, locale, active)
      VALUES ($1, 'Outbound Test Clinic', 'outbound-test', 'America/New_York', 'en-US', true)
      ON CONFLICT (id) DO NOTHING;
    `, [testClinicId]);
  });

  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DELETE FROM api.clinics WHERE id IN ($1, $2);`, [testClinicId, tempClinicId]);
      } catch {
        // Best-effort cleanup
      }
      await pool.end();
    }
  });

  describe('1. Authentication via X-Service-Key', () => {
    it('rejects requests without X-Service-Key with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .send({
          clinic_id: testClinicId,
          recipient: '+15551234567',
          message: 'Hello world',
          idempotency_key: 'test_key_1',
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects requests with incorrect X-Service-Key with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', 'wrong-key-1234567890123456')
        .send({
          clinic_id: testClinicId,
          recipient: '+15551234567',
          message: 'Hello world',
          idempotency_key: 'test_key_2',
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('accepts valid X-Service-Key header and proceeds to request processing', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: testClinicId,
          recipient: '+15551234567',
          message: 'Hello world',
          idempotency_key: 'test_key_auth_valid',
        });

      // Service key authentication passes; proceeds to request processing and returns 422 for unconfigured clinic
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INTEGRATION_UNCONFIGURED');
    });
  });

  describe('2. Strict Request Validation & Credential Ingestion Prevention', () => {
    it('rejects missing required parameters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: testClinicId,
          message: 'Hello',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('strictly rejects requests attempting to pass access_token or phone_number_id', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: testClinicId,
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_strict_key',
          access_token: 'EAAG123456789fake',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toMatch(/Unrecognized key|invalid/i);
    });

    it('strictly rejects requests attempting to pass phone_number_id', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: testClinicId,
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_strict_key_2',
          phone_number_id: '999999999999',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Integration Eligibility & Clinic Isolation', () => {
    it('rejects unconfigured clinic with 422 INTEGRATION_UNCONFIGURED', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: testClinicId,
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_unconfigured_key',
        });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('INTEGRATION_UNCONFIGURED');
    });

    it('rejects disabled integration with 409 INTEGRATION_DISABLED (Safe Test Mode)', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Disabled Clinic', 'disabled-clinic', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );
        const enc = encryptSecret('some-test-token-value');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '998877665544', $2, $3, false, 'valid')
           ON CONFLICT (clinic_id) DO UPDATE SET enabled = false, status = 'valid'`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello disabled test',
            idempotency_key: 'idem_disabled_test',
          });

        expect(res.status).toBe(409);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('INTEGRATION_DISABLED');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });

    it('rejects unvalidated integration status with 422 INTEGRATION_NOT_ELIGIBLE', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Unvalidated Clinic', 'unvalidated-clinic', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );
        const enc = encryptSecret('some-unvalidated-token');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '998877665545', $2, $3, true, 'unvalidated')
           ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, status = 'unvalidated'`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello unvalidated',
            idempotency_key: 'idem_unvalidated_test',
          });

        expect(res.status).toBe(422);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('INTEGRATION_NOT_ELIGIBLE');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });

    it('rejects expired integration token with 422 TOKEN_EXPIRED', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Expired Clinic', 'expired-clinic', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );
        const enc = encryptSecret('some-expired-token');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status, token_expires_at)
           VALUES ($1, '998877665546', $2, $3, true, 'valid', NOW() - interval '1 hour')
           ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, status = 'valid', token_expires_at = NOW() - interval '1 hour'`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello expired',
            idempotency_key: 'idem_expired_test',
          });

        expect(res.status).toBe(422);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('TOKEN_EXPIRED');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });
  });

  describe('4. Idempotency Protection', () => {
    it('returns cached result with 200 IDEMPOTENT_HIT without resending', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Idempotency Clinic', 'idem-clinic', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );

        const idempotencyKey = 'idem_key_cached_hit_123';

        await pool.query(
          `INSERT INTO api.notifications (
             clinic_id, recipient, template, kind, channel, status, provider_message_id, idempotency_key, attempts, created_at
           ) VALUES (
             $1, '+15551234567', 'whatsapp_direct_send', 'staff_alert', 'whatsapp', 'delivered', 'wamid.CACHED_WAMID_123', $2, 1, NOW()
           )`,
          [tempClinicId, idempotencyKey]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello cached',
            idempotency_key: idempotencyKey,
          });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.code).toBe('IDEMPOTENT_HIT');
        expect(res.body.data.provider_message_id).toBe('wamid.CACHED_WAMID_123');
        expect(res.body.data.delivery_status).toBe('delivered');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });

    it('rejects concurrent duplicate requests with 409 IN_PROGRESS if dispatch is already in flight', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'In Flight Clinic', 'in-flight-clinic', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );

        const idempotencyKey = 'idem_key_in_flight_123';

        await pool.query(
          `INSERT INTO api.notifications (
             clinic_id, recipient, template, kind, channel, status, idempotency_key, attempts, created_at
           ) VALUES (
             $1, '+15551234567', 'whatsapp_direct_send', 'staff_alert', 'whatsapp', 'processing', $2, 1, NOW()
           )`,
          [tempClinicId, idempotencyKey]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello in flight',
            idempotency_key: idempotencyKey,
          });

        expect(res.status).toBe(409);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('IN_PROGRESS');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });
  });

  describe('5. Safe Dispatch Execution & Zero Token Exposure', () => {
    it('successfully dispatches using mock Meta Cloud API response with 200 SENT', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Valid Clinic', 'temp-valid-clinic', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );
        const enc = encryptSecret('valid-test-system-token-12345');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '7777777777777', $2, $3, true, 'valid')
           ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, status = 'valid'`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        const mockSendMessage = jest.spyOn(whatsAppService, 'sendMessage').mockResolvedValueOnce({
          success: true,
          deliveryStatus: 'sent',
          providerStatus: 'sent',
          providerMessageId: 'wamid.MOCK_SENT_12345',
          message: 'Message dispatched successfully to WhatsApp.',
        });

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15559876543',
            message: 'Your dental appointment is confirmed.',
            idempotency_key: 'idem_key_fresh_send_456',
          });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.code).toBe('SENT');
        expect(res.body.data.delivery_status).toBe('sent');
        expect(res.body.data.provider_message_id).toBe('wamid.MOCK_SENT_12345');
        expect(res.body.data.idempotency_key).toBe('idem_key_fresh_send_456');

        const jsonStr = JSON.stringify(res.body);
        expect(jsonStr).not.toContain('valid-test-system-token');
        expect(jsonStr).not.toContain('ciphertext');

        mockSendMessage.mockRestore();
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });

    it('safely handles Meta provider rate limits with 429 without exposing secrets', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Valid Clinic 2', 'temp-valid-clinic-2', 'America/New_York', 'en-US') ON CONFLICT (id) DO NOTHING`,
          [tempClinicId]
        );
        const enc = encryptSecret('valid-test-system-token-12345');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '7777777777778', $2, $3, true, 'valid')
           ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, status = 'valid'`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        const mockSendMessage = jest.spyOn(whatsAppService, 'sendMessage').mockResolvedValueOnce({
          success: false,
          deliveryStatus: 'failed',
          providerStatus: 'rate_limited',
          message: 'WhatsApp rate limit exceeded. Please retry in a few moments.',
        });

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15559876543',
            message: 'Your dental appointment is confirmed.',
            idempotency_key: 'idem_key_rate_limited_789',
          });

        expect(res.status).toBe(429);
        expect(res.body.ok).toBe(false);
        expect(res.body.code).toBe('PROVIDER_RATE_LIMITED');
        expect(res.body.data.retryable).toBe(true);

        mockSendMessage.mockRestore();
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });
  });
});
