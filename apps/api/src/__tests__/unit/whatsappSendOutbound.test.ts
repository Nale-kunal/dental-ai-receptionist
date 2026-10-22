import request from 'supertest';
import { createApp } from '../../app';
import { Pool } from 'pg';
import fs from 'fs';
import { env } from '../../config/env';
import { whatsAppService } from '../../services/whatsapp.service';
import { encryptSecret } from '../../utils/encryption';

describe('Machine-to-Machine Outbound WhatsApp Send API (n8n integration)', () => {
  let app: any;
  let pool: Pool;

  const testServiceKey = 'test-internal-service-key-32chars!!';
  const demoClinicId = '00000000-0000-0000-0000-000000000001'; // Demo Clinic (enabled=false)
  const tempClinicId = '88888888-8888-8888-8888-888888888888';

  beforeAll(() => {
    // Configure test service key in env
    process.env.INTERNAL_SERVICE_KEY = testServiceKey;
    (env as any).INTERNAL_SERVICE_KEY = testServiceKey;

    app = createApp();
    const envFile = fs.readFileSync('.env', 'utf-8');
    const match = envFile.match(/DATABASE_URL=([^\r\n]+)/);
    const connectionString = match ? match[1].replace(/["']/g, '').trim() : process.env.DATABASE_URL;
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Authentication via X-Service-Key', () => {
    it('rejects requests without X-Service-Key with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .send({
          clinic_id: demoClinicId,
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
          clinic_id: demoClinicId,
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
          clinic_id: demoClinicId,
          recipient: '+15551234567',
          message: 'Hello world',
          idempotency_key: 'test_key_auth_valid',
        });

      // Demo clinic is currently disabled (safe test mode), so auth passes and it returns 409 INTEGRATION_DISABLED
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INTEGRATION_DISABLED');
    });
  });

  describe('2. Strict Request Validation & Credential Ingestion Prevention', () => {
    it('rejects missing required parameters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: demoClinicId,
          // recipient missing
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
          clinic_id: demoClinicId,
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_strict_key',
          access_token: 'EAAG123456789fake', // forbidden property
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
          clinic_id: demoClinicId,
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_strict_key_2',
          phone_number_id: '999999999999', // forbidden property
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Integration Eligibility & Clinic Isolation', () => {
    it('rejects unconfigured clinic with 422 INTEGRATION_UNCONFIGURED', async () => {
      const nonExistentClinic = '99999999-9999-9999-9999-999999999999';
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: nonExistentClinic,
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_unconfigured_key',
        });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('INTEGRATION_UNCONFIGURED');
    });

    it('rejects disabled integration with 409 INTEGRATION_DISABLED (Safe Test Mode)', async () => {
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('X-Service-Key', testServiceKey)
        .send({
          clinic_id: demoClinicId, // demo clinic is enabled=false
          recipient: '+15551234567',
          message: 'Hello',
          idempotency_key: 'test_disabled_key',
        });

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('INTEGRATION_DISABLED');
      expect(res.body.data.delivery_status).toBe('logged_locally');
    });

    it('rejects unvalidated integration status with 422 INTEGRATION_NOT_ELIGIBLE', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Clinic', 'temp-clinic', 'America/New_York', 'en-US')`,
          [tempClinicId]
        );
        const enc = encryptSecret('test-token-value-12345');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '5555555555555', $2, $3, true, 'unvalidated')`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello',
            idempotency_key: 'test_unvalidated_key',
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
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Clinic Expired', 'temp-clinic-expired', 'America/New_York', 'en-US')`,
          [tempClinicId]
        );
        const enc = encryptSecret('test-token-value-12345');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status, token_expires_at)
           VALUES ($1, '5555555555555', $2, $3, true, 'valid', $4)`,
          [tempClinicId, enc.ciphertext, enc.keyVersion, yesterday]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello',
            idempotency_key: 'test_expired_key',
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
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Idem Clinic', 'temp-idem-clinic', 'America/New_York', 'en-US')`,
          [tempClinicId]
        );

        const idempotencyKey = 'idem_key_already_sent_123';
        const existingWamid = 'wamid.HBgLMTA5MjgzNzQ2NQ==';

        // Insert completed notification record
        await pool.query(
          `INSERT INTO api.notifications (
             clinic_id, recipient, template, kind, channel, status, idempotency_key, provider_message_id, sent_at
           ) VALUES (
             $1, '+15551234567', 'whatsapp_direct_send', 'staff_alert', 'whatsapp', 'sent', $2, $3, NOW()
           )`,
          [tempClinicId, idempotencyKey, existingWamid]
        );

        const res = await request(app)
          .post('/api/v1/integrations/whatsapp/send')
          .set('X-Service-Key', testServiceKey)
          .send({
            clinic_id: tempClinicId,
            recipient: '+15551234567',
            message: 'Hello again',
            idempotency_key: idempotencyKey,
          });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.code).toBe('IDEMPOTENT_HIT');
        expect(res.body.data.provider_message_id).toBe(existingWamid);
        expect(res.body.data.idempotency_key).toBe(idempotencyKey);
        // Ensure no token is exposed in idempotent hit
        expect(res.body.data.accessToken).toBeUndefined();
        expect(res.body.data.token).toBeUndefined();
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });

    it('rejects concurrent duplicate requests with 409 IN_PROGRESS if dispatch is already in flight', async () => {
      try {
        await pool.query(
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp InFlight Clinic', 'temp-inflight-clinic', 'America/New_York', 'en-US')`,
          [tempClinicId]
        );

        const idempotencyKey = 'idem_key_concurrent_in_progress_456';

        // Insert notification record in 'processing' status
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
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Valid Clinic', 'temp-valid-clinic', 'America/New_York', 'en-US')`,
          [tempClinicId]
        );
        const enc = encryptSecret('valid-test-system-token-12345');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '7777777777777', $2, $3, true, 'valid')`,
          [tempClinicId, enc.ciphertext, enc.keyVersion]
        );

        // Spy on whatsAppService.sendMessage with custom fetch mock
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

        // Confirm zero credential leakage in JSON response
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
          `INSERT INTO api.clinics (id, name, slug, timezone, locale) VALUES ($1, 'Temp Valid Clinic 2', 'temp-valid-clinic-2', 'America/New_York', 'en-US')`,
          [tempClinicId]
        );
        const enc = encryptSecret('valid-test-system-token-12345');
        await pool.query(
          `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
           VALUES ($1, '7777777777778', $2, $3, true, 'valid')`,
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
