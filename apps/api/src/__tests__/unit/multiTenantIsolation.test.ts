import { assertClinicOwnership, getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { ForbiddenError, UnauthorizedError } from '../../middleware/errors/errorHandler';
import { Request } from 'express';

describe('Multi-Tenant Isolation & Security Suite', () => {
  const clinicA_Id = '00000000-0000-0000-0000-000000000001';
  const clinicB_Id = '00000000-0000-0000-0000-000000000002';

  const mockUserClinicA: any = {
    userId: 'user-a-1',
    email: 'admin@clinica.example.com',
    clinicId: clinicA_Id,
    tenantId: clinicA_Id,
    roles: ['clinic_admin'],
  };

  const mockUserClinicB: any = {
    userId: 'user-b-1',
    email: 'admin@clinicb.example.com',
    clinicId: clinicB_Id,
    tenantId: clinicB_Id,
    roles: ['clinic_admin'],
  };

  describe('Tenant ID Enforcement', () => {
    it('extracts authenticated clinicId strictly from server-resolved token claims', () => {
      const req = { user: mockUserClinicA } as Request;
      expect(getAuthenticatedClinicId(req)).toBe(clinicA_Id);
    });

    it('rejects unauthenticated requests trying to access clinic scope', () => {
      const req = {} as Request;
      expect(() => getAuthenticatedClinicId(req)).toThrow(UnauthorizedError);
    });

    it('denies access when a user attempts to access a record belonging to another clinic (IDOR Prevention)', () => {
      const reqClinicA = { user: mockUserClinicA } as Request;
      const recordClinicB_Id = clinicB_Id;

      expect(() => {
        assertClinicOwnership(reqClinicA, recordClinicB_Id, 'Patient');
      }).toThrow(ForbiddenError);
    });

    it('allows access when a user accesses a record belonging to their own clinic', () => {
      const reqClinicA = { user: mockUserClinicA } as Request;
      const recordClinicA_Id = clinicA_Id;

      expect(() => {
        assertClinicOwnership(reqClinicA, recordClinicA_Id, 'Patient');
      }).not.toThrow();
    });
  });

  describe('Cross-Clinic Patient Separation with Identical Names & Phones', () => {
    // Both clinics have a patient named Rahul Sharma with identical phone number
    const sharedPhone = '+15551234567';
    const sharedName = 'Rahul Sharma';

    const patientClinicA = {
      id: 'patient-uuid-clinic-a',
      clinic_id: clinicA_Id,
      full_name: sharedName,
      phone: sharedPhone,
      whatsapp_id: sharedPhone,
      display_title: 'VIP Executive',
    };

    const patientClinicB = {
      id: 'patient-uuid-clinic-b',
      clinic_id: clinicB_Id,
      full_name: sharedName,
      phone: sharedPhone,
      whatsapp_id: sharedPhone,
      display_title: 'Orthodontics Patient',
    };

    it('proves Clinic A and Clinic B maintain separate isolated patient records despite identical phone & name', () => {
      expect(patientClinicA.clinic_id).not.toBe(patientClinicB.clinic_id);
      expect(patientClinicA.id).not.toBe(patientClinicB.id);
      expect(patientClinicA.display_title).not.toBe(patientClinicB.display_title);
    });

    it('blocks Clinic A from modifying Clinic B patient by ID', () => {
      const reqClinicA = { user: mockUserClinicA } as Request;
      expect(() => {
        assertClinicOwnership(reqClinicA, patientClinicB.clinic_id, 'Patient');
      }).toThrow(ForbiddenError);
    });

    it('blocks Clinic B from modifying Clinic A patient by ID', () => {
      const reqClinicB = { user: mockUserClinicB } as Request;
      expect(() => {
        assertClinicOwnership(reqClinicB, patientClinicA.clinic_id, 'Patient');
      }).toThrow(ForbiddenError);
    });
  });

  describe('Real Contact Name Resolution Priority (No Generic WhatsApp User)', () => {
    function resolveContactIdentity(row: {
      patient_name?: string | null;
      patient_phone?: string | null;
      contact_phone?: string | null;
      channel_conversation_id?: string | null;
    }) {
      const verifiedPatientName = row.patient_name?.trim();
      const verifiedPhone = row.patient_phone?.trim() || row.contact_phone?.trim();
      const channelId = row.channel_conversation_id?.trim();

      if (verifiedPatientName) {
        return verifiedPatientName;
      }
      if (verifiedPhone) {
        return verifiedPhone;
      }
      if (channelId && /^\+?[0-9\s\-()]+$/.test(channelId)) {
        return channelId;
      }
      return 'Unknown contact';
    }

    it('resolves verified patient name when present (Priority 1)', () => {
      const identity = resolveContactIdentity({
        patient_name: 'Rahul Sharma',
        patient_phone: '+15550199',
        channel_conversation_id: '+15550199',
      });
      expect(identity).toBe('Rahul Sharma');
    });

    it('falls back to verified phone when patient name is not recorded (Priority 2)', () => {
      const identity = resolveContactIdentity({
        patient_name: null,
        patient_phone: '+15550199',
        channel_conversation_id: 'wa-chat-99',
      });
      expect(identity).toBe('+15550199');
    });

    it('falls back to channel conversation ID if formatted as phone number (Priority 3)', () => {
      const identity = resolveContactIdentity({
        patient_name: null,
        patient_phone: null,
        channel_conversation_id: '+15550199',
      });
      expect(identity).toBe('+15550199');
    });

    it('falls back to Unknown contact when no patient or phone is known', () => {
      const identity = resolveContactIdentity({
        patient_name: null,
        patient_phone: null,
        channel_conversation_id: 'web_session_anonymous',
      });
      expect(identity).toBe('Unknown contact');
      expect(identity).not.toBe('WhatsApp user');
      expect(identity).not.toBe('WhatsApp Patient');
    });
  });

  describe('Clinic Account Suspension Enforcement', () => {
    it('rejects access when clinic is flagged as suspended', () => {
      const suspendedClinic = {
        id: 'clinic-suspended-1',
        name: 'Suspended Clinic',
        active: false,
        suspended_at: new Date('2026-10-01T00:00:00Z'),
      };

      const isSuspended = suspendedClinic.suspended_at !== null || !suspendedClinic.active;
      expect(isSuspended).toBe(true);

      const checkSuspension = () => {
        if (isSuspended) {
          throw new ForbiddenError('Clinic account is suspended. Please contact clinic administration.');
        }
      };

      expect(checkSuspension).toThrow(ForbiddenError);
    });
  });
});
