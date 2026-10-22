import { getAuthenticatedClinicId, assertClinicOwnership, isValidUuid, assertValidUuid } from '../../middleware/authorization/tenantScope';
import { UnauthorizedError, ForbiddenError } from '../../middleware/errors/errorHandler';

describe('Tenant Scoping Authorization & Security', () => {
  const testClinicId = '00000000-0000-0000-0000-000000000001';
  const otherClinicId = '99999999-9999-9999-9999-999999999999';

  describe('getAuthenticatedClinicId', () => {
    it('returns the clinicId when request has an authenticated user', () => {
      const mockReq = {
        user: {
          id: 'user-123',
          clinicId: testClinicId,
          role: 'clinic_admin',
        },
      } as any;

      expect(getAuthenticatedClinicId(mockReq)).toBe(testClinicId);
    });

    it('throws UnauthorizedError if user is not attached to request', () => {
      const mockReq = {} as any;
      expect(() => getAuthenticatedClinicId(mockReq)).toThrow(UnauthorizedError);
    });
  });

  describe('assertClinicOwnership', () => {
    it('passes silently when record belongs to the authenticated clinic', () => {
      const mockReq = {
        user: {
          id: 'user-123',
          clinicId: testClinicId,
          role: 'clinic_admin',
        },
      } as any;

      expect(() => assertClinicOwnership(mockReq, testClinicId)).not.toThrow();
    });

    it('throws ForbiddenError when record belongs to a different clinic', () => {
      const mockReq = {
        user: {
          id: 'user-123',
          clinicId: testClinicId,
          role: 'clinic_admin',
        },
      } as any;

      expect(() => assertClinicOwnership(mockReq, otherClinicId)).toThrow(ForbiddenError);
    });

    it('throws UnauthorizedError when user is not authenticated', () => {
      const mockReq = {} as any;
      expect(() => assertClinicOwnership(mockReq, testClinicId)).toThrow(UnauthorizedError);
    });
  });

  describe('isValidUuid', () => {
    it('validates proper UUIDs', () => {
      expect(isValidUuid(testClinicId)).toBe(true);
      expect(isValidUuid('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d')).toBe(true);
    });

    it('rejects SQL injection or invalid strings', () => {
      expect(isValidUuid("'; DROP TABLE appointments; --")).toBe(false);
      expect(isValidUuid('invalid-uuid')).toBe(false);
      expect(isValidUuid('')).toBe(false);
    });
  });

  describe('assertValidUuid', () => {
    it('throws error for invalid format', () => {
      expect(() => assertValidUuid('not-a-uuid', 'clinicId')).toThrow('Invalid clinicId format');
    });
  });
});
