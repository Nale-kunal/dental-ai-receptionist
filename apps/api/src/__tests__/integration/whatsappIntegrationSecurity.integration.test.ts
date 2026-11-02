/**
 * whatsappIntegrationSecurity.integration.test.ts
 *
 * Database Integration Suite for WhatsApp Multi-Tenant Integration & Security.
 * STRICT SAFETY RULE: Only runs when TEST_DATABASE_URL is explicitly configured to an
 * isolated, non-production test database. Never touches production Neon.
 */

import { Pool } from 'pg';
import { WhatsAppService } from '../../services/whatsapp.service';
import { encryptSecret } from '../../utils/encryption';
import {
  describeIsolatedDb,
  getSafeTestDatabasePool,
  isIsolatedTestDatabaseAvailable,
} from '../helpers/testDatabaseGuard';

describeIsolatedDb('WhatsApp Multi-Tenant Integration & Security Suite (Isolated DB)', () => {
  let pool: Pool;
  const configuredClinicId = '50000000-0000-0000-0000-000000000001';
  const canonicalPhoneId = '1330570960147204';
  const unconfiguredClinicId = '50000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    if (!isIsolatedTestDatabaseAvailable()) return;

    pool = getSafeTestDatabasePool();

    // Provision test clinics in isolated test database
    await pool.query(`
      INSERT INTO api.clinics (id, name, slug, timezone, active)
      VALUES 
        ($1, 'Configured Test Clinic', 'cfg-test-clinic', 'America/New_York', true),
        ($2, 'Unconfigured Test Clinic', 'uncfg-test-clinic', 'America/New_York', true)
      ON CONFLICT (id) DO NOTHING;
    `, [configuredClinicId, unconfiguredClinicId]);

    await pool.query(`
      INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, enabled, status)
      VALUES ($1, $2, true, 'valid')
      ON CONFLICT (clinic_id) DO UPDATE SET phone_number_id = $2, enabled = true;
    `, [configuredClinicId, canonicalPhoneId]);
  });

  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DELETE FROM api.clinics WHERE id IN ($1, $2);`, [configuredClinicId, unconfiguredClinicId]);
      } catch {
        // Best-effort cleanup
      }
      await pool.end();
    }
  });

  describe('1. Phone Number ID Mapping & Resolution', () => {
    it('resolves configured clinic from its canonical WhatsApp Phone Number ID when enabled', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE api.clinic_whatsapp_integrations SET enabled = true WHERE clinic_id = $1`,
          [configuredClinicId]
        );
        const res = await client.query(
          `SELECT api.get_clinic_by_phone_number_id($1) as resolution`,
          [canonicalPhoneId]
        );
        const data = res.rows[0].resolution;

        expect(data.ok).toBe(true);
        expect(data.code).toBe('OK');
        expect(data.data.clinic_id).toBe(configuredClinicId);
        expect(data.data.name).toBe('Configured Test Clinic');
        expect(data.data.phone_number_id).toBe(canonicalPhoneId);
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
        await client.query(`UPDATE api.clinics SET active = false WHERE id = $1`, [configuredClinicId]);
        const res = await client.query(
          `SELECT api.get_clinic_by_phone_number_id($1) as resolution`,
          [canonicalPhoneId]
        );
        const data = res.rows[0].resolution;
        expect(data.ok).toBe(false);
        expect(data.code).toBe('INACTIVE');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('rejects a suspended clinic mapping safely with SUSPENDED', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE api.clinics SET suspended_at = NOW() WHERE id = $1`,
          [configuredClinicId]
        );
        const res = await client.query(
          `SELECT api.get_clinic_by_phone_number_id($1) as resolution`,
          [canonicalPhoneId]
        );
        const data = res.rows[0].resolution;
        expect(data.ok).toBe(false);
        expect(data.code).toBe('SUSPENDED');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('2. Uniqueness Enforcement on Phone Number ID', () => {
    it('blocks assigning an existing Phone Number ID to a second clinic', async () => {
      const service = new WhatsAppService();
      await expect(
        service.updateClinicIntegration(unconfiguredClinicId, {
          phoneNumberId: canonicalPhoneId,
        })
      ).rejects.toThrow('already assigned to another clinic');
    });
  });

  describe('3. Token Sanitization & Leaking Prevention', () => {
    it('strictly sanitizes get_clinic_context so access tokens never leak into AI or client context', async () => {
      const client = await pool.connect();
      try {
        const res = await client.query(`SELECT api.get_clinic_context($1::uuid) as ctx`, [configuredClinicId]);
        const ctx = res.rows[0].ctx;

        expect(ctx.ok).toBe(true);
        const settings = ctx.data.settings;

        expect(settings.accessToken).toBeUndefined();
        expect(settings.encryptedAccessToken).toBeUndefined();
        expect(settings.meta_access_token).toBeUndefined();
      } finally {
        client.release();
      }
    });
  });

  describe('4. Outbound WhatsApp Provider Dispatch Service', () => {
    it('returns logged_locally and not_configured when clinic has no WhatsApp integration', async () => {
      const service = new WhatsAppService();
      const result = await service.sendMessage({
        clinicId: unconfiguredClinicId,
        toPhone: '+15551234567',
        body: 'Hello from receptionist',
      });

      expect(result.deliveryStatus).toBe('logged_locally');
      expect(result.providerStatus).toBe('not_configured');
    });

    it('calls Meta Graph API with clinic credentials and returns sent on 200 OK', async () => {
      const testClinicId = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
      const testPhoneId = '123456789012345';
      const rawToken = 'EAAG_TEST_ACCESS_TOKEN_FOR_MOCK_CALL_123';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Mock Dispatch Clinic', 'mock-dispatch', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'valid')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        const mockFetch: any = jest.fn().mockImplementation(async (_url: string, opts: any) => {
          expect(opts.headers['Authorization']).toBe(`Bearer ${rawToken}`);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              messages: [{ id: 'wamid.HBgLMockWamid12345' }],
            }),
          };
        });

        const service = new WhatsAppService();
        const result = await service.sendMessage({
          clinicId: testClinicId,
          toPhone: '+15559876543',
          body: 'Automated appointment reminder',
          customFetch: mockFetch,
        });

        expect(result.deliveryStatus).toBe('sent');
        expect(result.providerStatus).toBe('sent');
        expect(result.providerMessageId).toBe('wamid.HBgLMockWamid12345');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [testClinicId]);
      }
    });

    it('handles Meta 401 Unauthorized safely without leaking token and marks status invalid', async () => {
      const testClinicId = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
      const testPhoneId = '123456789012346';
      const rawToken = 'EAAG_UNAUTHORIZED_TOKEN_SECRET_999';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Mock 401 Clinic', 'mock-401', 'America/New_York')
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
                message: 'Invalid OAuth access token - Session has expired',
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
          body: 'Appointment confirmation',
          customFetch: mockFetch,
        });

        expect(result.deliveryStatus).toBe('failed');
        expect(result.providerStatus).toBe('auth_error');
        expect(result.message).not.toContain(rawToken);

        // Confirm database status was updated to invalid
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
  });

  describe('5. Safe Token Validation Operation (Meta Graph API Phone Verification)', () => {
    it('validates credentials successfully via GET /v20.0/{phone_number_id} without sending messages and marks status valid', async () => {
      const testClinicId = 'aaaaaaaa-bbbb-cccc-dddd-000000000003';
      const testPhoneId = '123456789012347';
      const rawToken = 'EAAG_TOKEN_TO_VALIDATE_SAFELY_123';
      const encrypted = encryptSecret(rawToken);

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Validation Test Clinic', 'val-clinic', 'America/New_York')
        `, [testClinicId]);

        await pool.query(`
          INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, encrypted_access_token, key_version, enabled, status)
          VALUES ($1, $2, $3, $4, true, 'unvalidated')
        `, [testClinicId, testPhoneId, encrypted.ciphertext, encrypted.keyVersion]);

        let interceptedUrl = '';
        let interceptedMethod = '';
        let interceptedHeaders: any = {};

        const mockFetch: any = jest.fn().mockImplementation(async (url: string, opts: any) => {
          interceptedUrl = url;
          interceptedMethod = opts.method || 'GET';
          interceptedHeaders = opts.headers || {};
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: testPhoneId,
              verified_name: 'Bright Smiles Dental Care',
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
        expect(result.verifiedName).toBe('Bright Smiles Dental Care');
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
      const testClinicId = 'aaaaaaaa-bbbb-cccc-dddd-000000000004';
      const testPhoneId = '123456789012348';
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
      const testClinicId = 'aaaaaaaa-bbbb-cccc-dddd-000000000005';
      const testPhoneId = '123456789012349';
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
