import { Pool } from 'pg';
import fs from 'fs';
import { WhatsAppService } from '../../services/whatsapp.service';
import { encryptSecret } from '../../utils/encryption';

describe('WhatsApp Multi-Tenant Integration & Security Suite', () => {
  let pool: Pool;
  const demoClinicId = '00000000-0000-0000-0000-000000000001';
  const demoPhoneId = '1330570960147204';

  beforeAll(() => {
    const env = fs.readFileSync('.env', 'utf-8');
    const match = env.match(/DATABASE_URL=([^\r\n]+)/);
    const connectionString = match ? match[1].replace(/["']/g, '').trim() : process.env.DATABASE_URL;
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Phone Number ID Mapping & Resolution', () => {
    it('resolves Demo Clinic from its canonical WhatsApp Phone Number ID when enabled', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE api.clinic_whatsapp_integrations SET enabled = true WHERE clinic_id = $1`,
          [demoClinicId]
        );
        const res = await client.query(
          `SELECT api.get_clinic_by_phone_number_id($1) as resolution`,
          [demoPhoneId]
        );
        const data = res.rows[0].resolution;

        expect(data.ok).toBe(true);
        expect(data.code).toBe('OK');
        expect(data.data.clinic_id).toBe(demoClinicId);
        expect(data.data.name).toBe('Demo Dental Clinic');
        expect(data.data.phone_number_id).toBe(demoPhoneId);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('rejects an unknown Phone Number ID with NOT_FOUND', async () => {
      const res = await pool.query(
        `SELECT api.get_clinic_by_phone_number_id('9999999999999999') as resolution`
      );
      const data = res.rows[0].resolution;

      expect(data.ok).toBe(false);
      expect(data.code).toBe('NOT_FOUND');
    });

    it('rejects an inactive clinic mapping safely with INACTIVE', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const testClinicId = '11111111-2222-3333-4444-555555555555';
        const testPhoneId = '8888777766665555';

        await client.query(`
          INSERT INTO api.clinics (id, name, slug, timezone, active)
          VALUES ($1, 'Inactive Clinic', 'inactive-clinic', 'America/New_York', false)
        `, [testClinicId]);

        await client.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, enabled, status)
          VALUES ($1, $2, true, 'unconfigured')
        `, [testClinicId, testPhoneId]);

        const res = await client.query(
          `SELECT api.get_clinic_by_phone_number_id($1) as resolution`,
          [testPhoneId]
        );
        expect(res.rows[0].resolution.ok).toBe(false);
        expect(res.rows[0].resolution.code).toBe('INACTIVE');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('rejects a suspended clinic mapping safely with SUSPENDED', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const testClinicId = '22222222-3333-4444-5555-666666666666';
        const testPhoneId = '7777666655554444';

        await client.query(`
          INSERT INTO api.clinics (id, name, slug, timezone, active, suspended_at)
          VALUES ($1, 'Suspended Clinic', 'suspended-clinic', 'America/New_York', true, NOW())
        `, [testClinicId]);

        await client.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, enabled, status)
          VALUES ($1, $2, true, 'unconfigured')
        `, [testClinicId, testPhoneId]);

        const res = await client.query(
          `SELECT api.get_clinic_by_phone_number_id($1) as resolution`,
          [testPhoneId]
        );
        expect(res.rows[0].resolution.ok).toBe(false);
        expect(res.rows[0].resolution.code).toBe('SUSPENDED');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('2. Uniqueness Enforcement on Phone Number ID', () => {
    it('blocks assigning an existing Phone Number ID to a second clinic', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const secondClinicId = '33333333-4444-5555-6666-777777777777';

        await client.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Second Clinic', 'second-clinic', 'America/New_York')
        `, [secondClinicId]);

        // Attempt to insert duplicate demoPhoneId for secondClinicId
        await expect(
          client.query(`
            INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id)
            VALUES ($1, $2)
          `, [secondClinicId, demoPhoneId])
        ).rejects.toThrow(/unique constraint|clinic_whatsapp_integrations_phone_number_id_uidx/i);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('3. Token Sanitization & Leaking Prevention', () => {
    it('strictly sanitizes get_clinic_context so access tokens never leak into AI or client context', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const testClinicId = '44444444-5555-6666-7777-888888888888';

        // Intentionally inject secret keys into settings to verify sanitization
        await client.query(`
          INSERT INTO api.clinics (id, name, slug, timezone, settings)
          VALUES ($1, 'Security Test Clinic', 'sec-test', 'America/New_York', $2::jsonb)
        `, [
          testClinicId,
          JSON.stringify({
            booking_rules: { slotDurationMinutes: 30 },
            emergency_phone: '+15551234567',
            meta_access_token: 'LEAKED_META_ACCESS_TOKEN_123',
            access_token: 'LEAKED_RAW_ACCESS_TOKEN_456',
            whatsapp_token: 'LEAKED_WHATSAPP_TOKEN_789',
            secret: 'LEAKED_SECRET_ABC',
          })
        ]);

        const res = await client.query(
          `SELECT api.get_clinic_context($1::uuid) as ctx`,
          [testClinicId]
        );
        const ctx = res.rows[0].ctx;

        expect(ctx.ok).toBe(true);
        const settings = ctx.data.settings;

        // Verify legitimate settings remain
        expect(settings.booking_rules).toBeDefined();
        expect(settings.emergency_phone).toBe('+15551234567');

        // Verify sensitive keys are completely stripped
        expect(settings.meta_access_token).toBeUndefined();
        expect(settings.access_token).toBeUndefined();
        expect(settings.whatsapp_token).toBeUndefined();
        expect(settings.secret).toBeUndefined();
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('4. Outbound WhatsApp Provider Dispatch Service', () => {
    it('returns logged_locally and not_configured when clinic has no WhatsApp integration', async () => {
      const service = new WhatsAppService();
      // Oracle clinic has no integration configured
      const oracleClinicId = '914fb00e-c834-4e44-9646-9d746f536d4e';

      const result = await service.sendMessage({
        clinicId: oracleClinicId,
        toPhone: '+15550001111',
        body: 'Hello from dental clinic',
      });

      expect(result.success).toBe(false);
      expect(result.deliveryStatus).toBe('logged_locally');
      expect(result.providerStatus).toBe('not_configured');
    });

    it('calls Meta Graph API with clinic credentials and returns sent on 200 OK', async () => {
      const testClinicId = '55555555-6666-7777-8888-999999999999';
      const testPhoneId = '987654321098765';
      const rawToken = 'EAAG_MOCK_VALID_TOKEN_SECRET';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Mock Outbound Clinic', 'mock-outbound', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'valid')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        let interceptedUrl = '';
        let interceptedHeaders: any = {};
        let interceptedBody: any = {};

        const mockFetch: any = jest.fn().mockImplementation(async (url: string, init: any) => {
          interceptedUrl = url;
          interceptedHeaders = init.headers;
          interceptedBody = JSON.parse(init.body);

          return {
            ok: true,
            status: 200,
            json: async () => ({
              messaging_product: 'whatsapp',
              contacts: [{ input: '15550192837', wa_id: '15550192837' }],
              messages: [{ id: 'wamid.HBgLMTEyMjMzNDQ1NQ==' }],
            }),
          };
        });

        const service = new WhatsAppService();
        const result = await service.sendMessage({
          clinicId: testClinicId,
          toPhone: '+1 (555) 019-2837',
          body: 'Your appointment is confirmed for Tuesday at 2:00 PM.',
          customFetch: mockFetch,
        });

        expect(result.success).toBe(true);
        expect(result.deliveryStatus).toBe('sent');
        expect(result.providerStatus).toBe('sent');
        expect(result.providerMessageId).toBe('wamid.HBgLMTEyMjMzNDQ1NQ==');

        // Verify correct endpoint and Bearer authorization used
        expect(interceptedUrl).toBe(`https://graph.facebook.com/v20.0/${testPhoneId}/messages`);
        expect(interceptedHeaders['Authorization']).toBe(`Bearer ${rawToken}`);
        expect(interceptedBody.to).toBe('15550192837');
        expect(interceptedBody.text.body).toBe('Your appointment is confirmed for Tuesday at 2:00 PM.');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [testClinicId]);
      }
    });

    it('handles Meta 401 Unauthorized safely without leaking token and marks status invalid', async () => {
      const testClinicId = '66666666-7777-8888-9999-000000000000';
      const testPhoneId = '112233445566778';
      const rawToken = 'EXPIRED_TOKEN_XYZ';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Auth Failure Clinic', 'auth-fail', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'valid')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        const mockFetch: any = jest.fn().mockImplementation(async () => {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              error: {
                message: 'Invalid OAuth access token - Cannot parse access token',
                type: 'OAuthException',
                code: 190,
              },
            }),
          };
        });

        const service = new WhatsAppService();
        const result = await service.sendMessage({
          clinicId: testClinicId,
          toPhone: '+15559876543',
          body: 'Test message',
          customFetch: mockFetch,
        });

        expect(result.success).toBe(false);
        expect(result.deliveryStatus).toBe('failed');
        expect(result.providerStatus).toBe('auth_error');
        // Must not leak the raw token in error message
        expect(result.message).not.toContain(rawToken);

        // Verify status was updated to invalid in database
        const updated = await pool.query(
          `SELECT status, last_error FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1::uuid`,
          [testClinicId]
        );
        expect(updated.rows[0].status).toBe('invalid');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [testClinicId]);
      }
    });
  });

  describe('5. Safe Token Validation Operation (Meta Graph API Phone Verification)', () => {
    it('validates credentials successfully via GET /v20.0/{phone_number_id} without sending messages and marks status valid', async () => {
      const testClinicId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const testPhoneId = '123456789012345';
      const rawToken = 'EAAG_MOCK_VALIDATION_TOKEN';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Validation Success Clinic', 'val-success', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'unvalidated')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        let interceptedUrl = '';
        let interceptedMethod = '';
        let interceptedHeaders: any = {};

        const mockFetch: any = jest.fn().mockImplementation(async (url: string, init: any) => {
          interceptedUrl = url;
          interceptedMethod = init?.method || 'GET';
          interceptedHeaders = init?.headers || {};

          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: testPhoneId,
              verified_name: 'Validated Dental Clinic',
              display_phone_number: '+1 (555) 000-1122',
              quality_rating: 'GREEN',
              code_verification_status: 'VERIFIED',
            }),
          };
        });

        const service = new WhatsAppService();
        const result = await service.validateIntegration(testClinicId, mockFetch);

        expect(result.valid).toBe(true);
        expect(result.status).toBe('valid');
        expect(result.verifiedName).toBe('Validated Dental Clinic');
        expect(result.displayPhoneNumber).toBe('+1 (555) 000-1122');
        expect(result.qualityRating).toBe('GREEN');

        // Confirm Meta API request was GET phone_number_id, NOT messages
        expect(interceptedMethod).toBe('GET');
        expect(interceptedUrl).toContain(`https://graph.facebook.com/v20.0/${testPhoneId}`);
        expect(interceptedUrl).not.toContain('/messages');
        expect(interceptedHeaders['Authorization']).toBe(`Bearer ${rawToken}`);

        // Confirm DB status updated to valid with timestamp and no error
        const dbRes = await pool.query(
          `SELECT status, last_validated_at, last_error FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1::uuid`,
          [testClinicId]
        );
        expect(dbRes.rows[0].status).toBe('valid');
        expect(dbRes.rows[0].last_validated_at).not.toBeNull();
        expect(dbRes.rows[0].last_error).toBeNull();
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [testClinicId]);
      }
    });

    it('handles Meta 401/190 Invalid Token safely, marks status invalid, and never leaks secret in DB or error', async () => {
      const testClinicId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
      const testPhoneId = '234567890123456';
      const rawToken = 'EAAG_EXPIRED_OR_INVALID_TOKEN_SECRET';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Validation 401 Clinic', 'val-401', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'unvalidated')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        const mockFetch: any = jest.fn().mockImplementation(async () => {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              error: {
                message: 'Invalid OAuth access token - Session has expired',
                type: 'OAuthException',
                code: 190,
              },
            }),
          };
        });

        const service = new WhatsAppService();
        const result = await service.validateIntegration(testClinicId, mockFetch);

        expect(result.valid).toBe(false);
        expect(result.status).toBe('invalid');
        // Token must never leak into message
        expect(result.message).not.toContain(rawToken);

        // Confirm DB status updated to invalid with sanitized last_error
        const dbRes = await pool.query(
          `SELECT status, last_error FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1::uuid`,
          [testClinicId]
        );
        expect(dbRes.rows[0].status).toBe('invalid');
        expect(dbRes.rows[0].last_error).not.toContain(rawToken);
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [testClinicId]);
      }
    });

    it('handles network failure safely by preserving unvalidated status and not leaking secrets', async () => {
      const testClinicId = 'cccccccc-dddd-eeee-ffff-000000000000';
      const testPhoneId = '345678901234567';
      const rawToken = 'EAAG_NETWORK_ERROR_TOKEN_XYZ';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Network Error Clinic', 'net-err', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'unvalidated')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        const mockFetch: any = jest.fn().mockImplementation(async () => {
          throw new Error('connect ETIMEDOUT 157.240.22.54:443');
        });

        const service = new WhatsAppService();
        const result = await service.validateIntegration(testClinicId, mockFetch);

        expect(result.valid).toBe(false);
        // Status must NOT be marked invalid upon network disruption; it preserves unvalidated
        expect(result.status).toBe('unvalidated');
        expect(result.message).toContain('Network error contacting Meta API');
        expect(result.message).not.toContain(rawToken);

        // DB status remains unvalidated
        const dbRes = await pool.query(
          `SELECT status FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1::uuid`,
          [testClinicId]
        );
        expect(dbRes.rows[0].status).toBe('unvalidated');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [testClinicId]);
      }
    });
  });
});
