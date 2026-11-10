import request from 'supertest';
import { createApp } from '../../app';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { prisma } from '../../database/prisma/client';
import { resolveReceptionistEnabled } from '../../modules/receptionist-settings/receptionist.routes';

// Mock prisma for unit test isolation
jest.mock('../../database/prisma/client', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe('Automated Receptionist Answering Status & Dispatch Authorization Suite', () => {
  let app: any;

  const clinicA_Id = '11111111-1111-1111-1111-111111111111';
  const clinicB_Id = '22222222-2222-2222-2222-222222222222';

  const tokenClinicA = jwt.sign(
    { userId: 'user-a', email: 'admin@clinica.test', clinicId: clinicA_Id, tenantId: clinicA_Id, roles: ['clinic_admin'] },
    (env as any).JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  const tokenClinicB = jwt.sign(
    { userId: 'user-b', email: 'admin@clinicb.test', clinicId: clinicB_Id, tenantId: clinicB_Id, roles: ['clinic_admin'] },
    (env as any).JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authoritative Status Helper: resolveReceptionistEnabled (Strict Fail-Closed)', () => {
    it('fails closed (returns false) when settings are empty, null, or undefined', () => {
      expect(resolveReceptionistEnabled(null)).toBe(false);
      expect(resolveReceptionistEnabled(undefined)).toBe(false);
      expect(resolveReceptionistEnabled({})).toBe(false);
      expect(resolveReceptionistEnabled({ tone: 'warm_professional' })).toBe(false);
    });

    it('returns false when top-level receptionist_enabled is boolean false', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: false })).toBe(false);
    });

    it('returns false when top-level receptionist_enabled is string "false" (guards truthiness trap)', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: 'false' })).toBe(false);
    });

    it('returns true when top-level receptionist_enabled is boolean true', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: true })).toBe(true);
    });

    it('returns false when nested receptionist.enabled is boolean false', () => {
      expect(resolveReceptionistEnabled({ receptionist: { enabled: false } })).toBe(false);
    });

    it('returns false when nested receptionist.enabled is string "false"', () => {
      expect(resolveReceptionistEnabled({ receptionist: { enabled: 'false' } })).toBe(false);
    });

    it('returns true when nested receptionist.enabled is boolean true', () => {
      expect(resolveReceptionistEnabled({ receptionist: { enabled: true } })).toBe(true);
    });

    it('fails closed when canonical status is NULL', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: null })).toBe(false);
      expect(resolveReceptionistEnabled({ receptionist: { enabled: null } })).toBe(false);
      expect(resolveReceptionistEnabled({ receptionist_enabled: null, receptionist: { enabled: null } })).toBe(false);
    });

    it('fails closed when canonical status is a malformed string', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: 'active' })).toBe(false);
      expect(resolveReceptionistEnabled({ receptionist_enabled: 'yes' })).toBe(false);
      expect(resolveReceptionistEnabled({ receptionist: { enabled: '1' } })).toBe(false);
    });

    it('fails closed on contradictory canonical fields (one true, one false)', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: true, receptionist: { enabled: false } })).toBe(false);
      expect(resolveReceptionistEnabled({ receptionist_enabled: false, receptionist: { enabled: true } })).toBe(false);
    });

    it('does not authorize from legacy settings.enabled when canonical keys are missing', () => {
      expect(resolveReceptionistEnabled({ enabled: true })).toBe(false);
      expect(resolveReceptionistEnabled({ enabled: false })).toBe(false);
    });
  });

  describe('PATCH /api/v1/receptionist/status (Atomic Status Toggle)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .patch('/api/v1/receptionist/status')
        .send({ enabled: false });

      expect(res.status).toBe(401);
    });

    it('rejects non-boolean payloads with 400 Validation Error', async () => {
      const res = await request(app)
        .patch('/api/v1/receptionist/status')
        .set('Authorization', `Bearer ${tokenClinicA}`)
        .send({ enabled: 'paused' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('atomically pauses the receptionist with jsonb_set', async () => {
      const updatedSettings = {
        receptionist_enabled: false,
        receptionist: { enabled: false, tone: 'professional' },
        greeting_message: 'Hello clinic',
      };

      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { settings: updatedSettings },
      ]);

      const res = await request(app)
        .patch('/api/v1/receptionist/status')
        .set('Authorization', `Bearer ${tokenClinicA}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.enabled).toBe(false);
      expect(res.body.data.status).toBe('PAUSED');
      expect(res.body.data.clinicId).toBe(clinicA_Id);

      // Verify single atomic UPDATE was called with jsonb_set
      const updateCall = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE api.clinics');
      expect(updateCall[0]).toContain('jsonb_set');
      expect(updateCall[1]).toBe(clinicA_Id);
      expect(updateCall[2]).toBe(false);
    });

    it('atomically activates the receptionist with jsonb_set', async () => {
      const updatedSettings = {
        receptionist_enabled: true,
        receptionist: { enabled: true, tone: 'professional' },
      };

      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { settings: updatedSettings },
      ]);

      const res = await request(app)
        .patch('/api/v1/receptionist/status')
        .set('Authorization', `Bearer ${tokenClinicA}`)
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.enabled).toBe(true);
      expect(res.body.data.status).toBe('ACTIVE');

      const updateCall = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE api.clinics');
      expect(updateCall[0]).toContain('jsonb_set');
      expect(updateCall[1]).toBe(clinicA_Id);
      expect(updateCall[2]).toBe(true);
    });

    it('maintains strict tenant isolation: Clinic A token only updates Clinic A', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { settings: { receptionist_enabled: false } },
      ]);

      await request(app)
        .patch('/api/v1/receptionist/status')
        .set('Authorization', `Bearer ${tokenClinicA}`)
        .send({ enabled: false });

      const updateCall = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(updateCall[1]).toBe(clinicA_Id);
    });
  });

  describe('GET /api/v1/receptionist/dispatch-auth (Real-Time Authorization Guard)', () => {
    it('returns canDispatch: false when receptionist is PAUSED', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: true,
          suspended_at: null,
          receptionist_enabled: false,
          integration_enabled: true,
          integration_status: 'valid',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.receptionistEnabled).toBe(false);
      expect(res.body.data.reason).toBe('receptionist_paused');
    });

    it('returns canDispatch: true when ACTIVE, not suspended, and integration valid', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: true,
          suspended_at: null,
          receptionist_enabled: true,
          integration_enabled: true,
          integration_status: 'valid',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.canDispatch).toBe(true);
      expect(res.body.data.receptionistEnabled).toBe(true);
      expect(res.body.data.reason).toBe('authorized');
    });

    it('fails closed when clinic is suspended', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: true,
          suspended_at: new Date().toISOString(),
          receptionist_enabled: false,
          integration_enabled: true,
          integration_status: 'valid',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.reason).toBe('clinic_inactive');
    });

    it('fails closed when clinic is not found in database', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(404);
      expect(res.body.canDispatch).toBe(false);
    });

    it('fails closed when canonical status is missing/null/unconfigured', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: true,
          suspended_at: null,
          receptionist_enabled: false, // Computed as false by fail-closed SQL
          integration_enabled: true,
          integration_status: 'valid',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.receptionistEnabled).toBe(false);
    });

    it('fails closed when clinic is inactive (active: false)', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: false,
          suspended_at: null,
          receptionist_enabled: false,
          integration_enabled: true,
          integration_status: 'valid',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.isClinicActive).toBe(false);
      expect(res.body.data.reason).toBe('clinic_inactive');
    });

    it('fails closed when clinic activity is NULL', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: false, // coerced by (c.active IS TRUE) in SQL
          suspended_at: null,
          receptionist_enabled: false,
          integration_enabled: true,
          integration_status: 'valid',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.isClinicActive).toBe(false);
      expect(res.body.data.reason).toBe('clinic_inactive');
    });

    it('fails closed when WhatsApp integration is explicitly disabled (enabled: false)', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: true,
          suspended_at: null,
          receptionist_enabled: true,
          integration_enabled: false,
          integration_status: 'disabled',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.integrationEnabled).toBe(false);
      expect(res.body.data.reason).toBe('integration_disabled');
    });

    it('fails closed when WhatsApp integration record is completely missing from database', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          clinic_id: clinicA_Id,
          active: true,
          suspended_at: null,
          receptionist_enabled: true,
          integration_enabled: false, // COALESCE(i.enabled, false) evaluates to false when row missing
          integration_status: null,
        },
      ]);

      const res = await request(app)
        .get('/api/v1/receptionist/dispatch-auth')
        .set('Authorization', `Bearer ${tokenClinicA}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.canDispatch).toBe(false);
      expect(res.body.data.integrationEnabled).toBe(false);
      expect(res.body.data.reason).toBe('integration_disabled');
    });
  });
});

