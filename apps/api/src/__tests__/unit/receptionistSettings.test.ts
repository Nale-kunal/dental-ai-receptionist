import request from 'supertest';
import { createApp } from '../../app';
import { Pool } from 'pg';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

describe('Receptionist Settings & WhatsApp Integration API Suite', () => {
  let app: any;
  let pool: Pool;

  const clinicA_Id = '00000000-0000-0000-0000-000000000001'; // Demo Clinic
  const clinicB_Id = '914fb00e-c834-4e44-9646-9d746f536d4e'; // Oracle Clinic

  const tokenClinicA = jwt.sign(
    { userId: 'user-a-1', email: 'admin@democlinic.com', clinicId: clinicA_Id, tenantId: clinicA_Id, roles: ['clinic_admin'] },
    (env as any).JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  const tokenClinicB = jwt.sign(
    { userId: 'user-b-1', email: 'admin@oracleclinic.com', clinicId: clinicB_Id, tenantId: clinicB_Id, roles: ['clinic_admin'] },
    (env as any).JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  beforeAll(() => {
    app = createApp();
    const envFile = fs.readFileSync('.env', 'utf-8');
    const match = envFile.match(/DATABASE_URL=([^\r\n]+)/);
    const connectionString = match ? match[1].replace(/["']/g, '').trim() : process.env.DATABASE_URL;
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('GET /api/v1/receptionist/settings', () => {
    it('returns canonical phoneNumberId for Demo Clinic without hardcoded defaults', async () => {
      const res = await request(app)
        .get('/api/v1/receptionist/settings')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.phoneNumberId).toBe('1330570960147204');
      expect(res.body.data.whatsappPhoneNumberId).toBe('1330570960147204');
      expect(res.body.data.greetingMessage).toContain('Demo Dental Clinic');
      // Must not expose any access token
      expect(res.body.data.accessToken).toBeUndefined();
      expect(res.body.data.meta_access_token).toBeUndefined();
    });

    it('returns empty phone number for unconfigured clinic without demo fallback', async () => {
      const res = await request(app)
        .get('/api/v1/receptionist/settings')
        .set('Authorization', `Bearer ${tokenClinicB}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.phoneNumberId).toBe('');
      expect(res.body.data.greetingMessage).toContain('Oracle Clinic');
      expect(res.body.data.emergencyPhone).toBe('');
    });
  });

  describe('PUT /api/v1/receptionist/settings', () => {
    it('rejects assigning an existing Phone Number ID with 409 Conflict', async () => {
      // Clinic B attempts to claim Demo Clinic's phone number ID
      const res = await request(app)
        .put('/api/v1/receptionist/settings')
        .set('Authorization', `Bearer ${tokenClinicB}`)
        .send({
          phoneNumberId: '1330570960147204',
        });

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toContain('already assigned');
    });

    it('rejects invalid non-digit phone number format with 400 Validation Error', async () => {
      const res = await request(app)
        .put('/api/v1/receptionist/settings')
        .set('Authorization', `Bearer ${tokenClinicB}`)
        .send({
          phoneNumberId: 'invalid-phone-id-xyz',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET & PUT /api/v1/receptionist/integration', () => {
    it('returns masked integration status without revealing raw secrets', async () => {
      const res = await request(app)
        .get('/api/v1/receptionist/integration')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.clinicId).toBe(clinicA_Id);
      expect(res.body.data.phoneNumberId).toBe('1330570960147204');
      expect(res.body.data.accessToken).toBeUndefined();
      expect(res.body.data.encryptedAccessToken).toBeUndefined();
    });

    it('allows a clinic to securely store integration credentials and returns masked status', async () => {
      const tempClinicId = '77777777-8888-9999-0000-111111111111';
      const tempToken = jwt.sign(
        { userId: 'user-temp', email: 'admin@tempclinic.com', clinicId: tempClinicId, tenantId: tempClinicId, roles: ['clinic_admin'] },
        (env as any).JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Temp Integration Clinic', 'temp-integration', 'America/New_York');
        `, [tempClinicId]);

        const putRes = await request(app)
          .put('/api/v1/receptionist/integration')
          .set('Authorization', `Bearer ${tempToken}`)
          .send({
            phoneNumberId: '223344556677889',
            wabaId: '998877665544332',
            accessToken: 'EAAG_SECRET_TOKEN_VALUE_4321',
            enabled: true,
          });

        expect(putRes.status).toBe(200);
        expect(putRes.body.ok).toBe(true);
        expect(putRes.body.data.phoneNumberId).toBe('223344556677889');
        expect(putRes.body.data.hasToken).toBe(true);
        expect(putRes.body.data.maskedToken).toBe('••••••••4321');
        // Raw token must never be in response
        expect(putRes.body.data.accessToken).toBeUndefined();

        expect(putRes.body.data.status).toBe('unvalidated');

        // Verify in database that it is encrypted at rest and not plaintext
        const dbCheck = await pool.query(
          `SELECT encrypted_access_token, status FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1`,
          [tempClinicId]
        );
        expect(dbCheck.rows[0].encrypted_access_token).not.toBe('EAAG_SECRET_TOKEN_VALUE_4321');
        expect(dbCheck.rows[0].encrypted_access_token).toContain(':');
        // Must be unvalidated on initial save without live Meta verification
        expect(dbCheck.rows[0].status).toBe('unvalidated');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [tempClinicId]);
      }
    });

    it('enforces tenant isolation: Clinic B cannot access Clinic A integration', async () => {
      const res = await request(app)
        .get('/api/v1/receptionist/integration')
        .set('Authorization', `Bearer ${tokenClinicB}`);

      expect(res.status).toBe(200);
      expect(res.body.data.clinicId).toBe(clinicB_Id);
      expect(res.body.data.clinicId).not.toBe(clinicA_Id);
      expect(res.body.data.phoneNumberId).toBeNull();
    });

    it('returns 400 UNCONFIGURED when validating an unconfigured clinic integration', async () => {
      const res = await request(app)
        .post('/api/v1/receptionist/integration/validate')
        .set('Authorization', `Bearer ${tokenClinicB}`);

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('UNCONFIGURED');
    });

    it('preserves existing ciphertext when updating metadata without providing a new token', async () => {
      const clinicC_Id = '88888888-9999-0000-1111-222222222222';
      const tokenClinicC = jwt.sign(
        { userId: 'user-c', email: 'admin@clinicc.com', clinicId: clinicC_Id, tenantId: clinicC_Id, roles: ['clinic_admin'] },
        (env as any).JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Preserve Token Clinic', 'preserve-clinic', 'America/New_York');
        `, [clinicC_Id]);

        // 1. Initial save with token
        await request(app)
          .put('/api/v1/receptionist/integration')
          .set('Authorization', `Bearer ${tokenClinicC}`)
          .send({
            phoneNumberId: '556677889900112',
            accessToken: 'EAAG_ORIGINAL_SECRET_TOKEN',
            enabled: true,
          });

        const initialDb = await pool.query(
          `SELECT encrypted_access_token FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1`,
          [clinicC_Id]
        );
        const originalCiphertext = initialDb.rows[0].encrypted_access_token;
        expect(originalCiphertext).toBeDefined();

        // 2. Update without accessToken field
        const updateRes = await request(app)
          .put('/api/v1/receptionist/integration')
          .set('Authorization', `Bearer ${tokenClinicC}`)
          .send({
            wabaId: '123456789012345',
            enabled: false,
          });

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.data.hasToken).toBe(true);
        expect(updateRes.body.data.enabled).toBe(false);
        expect(updateRes.body.data.wabaId).toBe('123456789012345');

        // Check that ciphertext is intact
        const afterDb = await pool.query(
          `SELECT encrypted_access_token, enabled FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1`,
          [clinicC_Id]
        );
        expect(afterDb.rows[0].encrypted_access_token).toBe(originalCiphertext);
        expect(afterDb.rows[0].enabled).toBe(false);
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [clinicC_Id]);
      }
    });

    it('clears stored credentials when empty accessToken is explicitly passed', async () => {
      const clinicD_Id = '99999999-0000-1111-2222-333333333333';
      const tokenClinicD = jwt.sign(
        { userId: 'user-d', email: 'admin@clinicd.com', clinicId: clinicD_Id, tenantId: clinicD_Id, roles: ['clinic_admin'] },
        (env as any).JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      try {
        await pool.query(`
          INSERT INTO api.clinics (id, name, slug, timezone)
          VALUES ($1, 'Clear Token Clinic', 'clear-clinic', 'America/New_York');
        `, [clinicD_Id]);

        // Initial save
        await request(app)
          .put('/api/v1/receptionist/integration')
          .set('Authorization', `Bearer ${tokenClinicD}`)
          .send({
            phoneNumberId: '667788990011223',
            accessToken: 'EAAG_TOKEN_TO_BE_CLEARED',
            enabled: true,
          });

        // Clear token
        const clearRes = await request(app)
          .put('/api/v1/receptionist/integration')
          .set('Authorization', `Bearer ${tokenClinicD}`)
          .send({
            phoneNumberId: '',
            accessToken: '',
            enabled: false,
          });

        expect(clearRes.status).toBe(200);
        expect(clearRes.body.data.hasToken).toBe(false);
        expect(clearRes.body.data.status).toBe('unconfigured');

        const dbCheck = await pool.query(
          `SELECT encrypted_access_token, status FROM api.clinic_whatsapp_integrations WHERE clinic_id = $1`,
          [clinicD_Id]
        );
        expect(dbCheck.rows[0].encrypted_access_token).toBeNull();
        expect(dbCheck.rows[0].status).toBe('unconfigured');
      } finally {
        await pool.query(`DELETE FROM api.clinics WHERE id = $1`, [clinicD_Id]);
      }
    });

    it('strictly rejects unauthenticated requests to integration endpoints with 401', async () => {
      const getRes = await request(app).get('/api/v1/receptionist/integration');
      expect(getRes.status).toBe(401);

      const putRes = await request(app).put('/api/v1/receptionist/integration').send({ phoneNumberId: '123' });
      expect(putRes.status).toBe(401);

      const valRes = await request(app).post('/api/v1/receptionist/integration/validate');
      expect(valRes.status).toBe(401);
    });
  });
});
