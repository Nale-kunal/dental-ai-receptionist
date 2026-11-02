/**
 * authService.test.ts
 *
 * Comprehensive unit test suite for apps/api/src/modules/auth/auth.service.ts
 * Tests all core authentication flows in complete isolation using mocked Prisma client.
 * Strictly ZERO database connection required.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../database/prisma/client';
import {
  loginUser,
  changePassword,
  signupClinic,
  refreshAccessToken,
  getMe,
} from '../../modules/auth/auth.service';
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../../middleware/errors/errorHandler';
import { env } from '../../config/env';

// Mock prisma client for unit isolation
jest.mock('../../database/prisma/client', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
  },
}));

describe('Auth Service Unit Tests (Mocked Prisma & Zero DB)', () => {
  const mockQueryRawUnsafe = prisma.$queryRawUnsafe as jest.Mock;
  const mockTransaction = prisma.$transaction as jest.Mock;

  const validClinicId = '11111111-2222-3333-4444-555555555555';
  const validUserId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const validEmail = 'dr.smith@brightsmiles.test';
  const validPassword = 'SecurePassword123!';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. loginUser
  // ───────────────────────────────────────────────────────────────────────────
  describe('loginUser', () => {
    async function createMockUserRow(overrides: Record<string, any> = {}) {
      const hash = overrides.auth_subject !== undefined
        ? overrides.auth_subject
        : await bcrypt.hash(validPassword, 10);

      return {
        id: validUserId,
        clinic_id: validClinicId,
        auth_subject: hash,
        full_name: 'Dr. Jane Smith',
        email: validEmail,
        role: 'clinic_admin',
        active: true,
        clinic_name: 'Bright Smiles Dental',
        clinic_timezone: 'America/New_York',
        suspended_at: null,
        clinic_active: true,
        ...overrides,
      };
    }

    it('successfully logs in with a valid password and bcrypt hash ($2b$)', async () => {
      const userRow = await createMockUserRow();
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      const res = await loginUser({ email: validEmail, password: validPassword });

      expect(res).toBeDefined();
      expect(res.user).toBeDefined();
      expect(res.user.id).toBe(validUserId);
      expect(res.user.clinicId).toBe(validClinicId);
      expect(res.user.email).toBe(validEmail);
      expect(res.user.firstName).toBe('Dr.');
      expect(res.user.lastName).toBe('Jane Smith');
      expect(res.user.roles).toEqual(['clinic_admin']);

      // Token verification
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();

      const decodedAccess: any = jwt.verify(res.accessToken, env.JWT_SECRET);
      expect(decodedAccess.sub).toBe(validUserId);
      expect(decodedAccess.clinicId).toBe(validClinicId);
      expect(decodedAccess.email).toBe(validEmail);

      const decodedRefresh: any = jwt.verify(res.refreshToken, env.REFRESH_TOKEN_SECRET);
      expect(decodedRefresh.sub).toBe(validUserId);
      expect(decodedRefresh.clinicId).toBe(validClinicId);
      expect(decodedRefresh.type).toBe('refresh');
    });

    it('supports $2a$ and $2y$ standard bcrypt prefix variants', async () => {
      // Test $2a$
      const hash2a = await bcrypt.hash(validPassword, 10);
      const userRow2a = await createMockUserRow({ auth_subject: hash2a.replace('$2b$', '$2a$') });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow2a]);

      const res2a = await loginUser({ email: validEmail, password: validPassword });
      expect(res2a.user.id).toBe(validUserId);

      // Test $2y$
      const hash2y = await bcrypt.hash(validPassword, 10);
      const userRow2y = await createMockUserRow({ auth_subject: hash2y.replace('$2b$', '$2y$') });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow2y]);

      const res2y = await loginUser({ email: validEmail, password: validPassword });
      expect(res2y.user.id).toBe(validUserId);
    });

    it('rejects incorrect password with 401 Unauthorized', async () => {
      const userRow = await createMockUserRow();
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: 'WrongPassword999!' })
      ).rejects.toThrow(new UnauthorizedError('Invalid email or password.'));
    });

    it('rejects empty password with 401 Unauthorized', async () => {
      const userRow = await createMockUserRow();
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: '' })
      ).rejects.toThrow(new UnauthorizedError('Invalid email or password.'));
    });

    it('returns uniform 401 response for unknown email (no user enumeration)', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([]); // No user found

      await expect(
        loginUser({ email: 'nonexistent@clinic.test', password: validPassword })
      ).rejects.toThrow(new UnauthorizedError('Invalid email or password.'));
    });

    it('rejects login for a deactivated user (active = false)', async () => {
      const userRow = await createMockUserRow({ active: false });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: validPassword })
      ).rejects.toThrow(new UnauthorizedError('User account has been deactivated.'));
    });

    it('rejects login when clinic is suspended via suspended_at timestamp', async () => {
      const userRow = await createMockUserRow({ suspended_at: new Date('2026-10-01T00:00:00Z') });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: validPassword })
      ).rejects.toThrow(
        new ForbiddenError('Clinic account is suspended. Please contact clinic administration.')
      );
    });

    it('rejects login when clinic active flag is false', async () => {
      const userRow = await createMockUserRow({ clinic_active: false });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: validPassword })
      ).rejects.toThrow(
        new ForbiddenError('Clinic account is suspended. Please contact clinic administration.')
      );
    });

    it('rejects legacy demo-admin shortcut string in auth_subject without bypass', async () => {
      // Previously, auth_subject === 'demo-admin' was a bypass. Now it must be rejected!
      const userRow = await createMockUserRow({ auth_subject: 'demo-admin' });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: 'password123' })
      ).rejects.toThrow(new UnauthorizedError('Invalid email or password.'));
    });

    it('rejects plaintext password stored in auth_subject (enforces strict bcrypt format)', async () => {
      const userRow = await createMockUserRow({ auth_subject: 'plaintextPassword123' });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: 'plaintextPassword123' })
      ).rejects.toThrow(new UnauthorizedError('Invalid email or password.'));
    });

    it('rejects null or empty auth_subject with 401', async () => {
      const userRow = await createMockUserRow({ auth_subject: null });
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      await expect(
        loginUser({ email: validEmail, password: validPassword })
      ).rejects.toThrow(new UnauthorizedError('Invalid email or password.'));
    });

    it('normalizes mixed-case email to lowercase for authentication', async () => {
      const userRow = await createMockUserRow();
      mockQueryRawUnsafe.mockResolvedValueOnce([userRow]);

      const res = await loginUser({ email: 'Dr.Smith@BrightSmiles.TEST', password: validPassword });
      expect(res.user.id).toBe(validUserId);

      // Verify the query was executed with lowercase email
      expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(u.email) = $1'),
        'dr.smith@brightsmiles.test'
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. changePassword
  // ───────────────────────────────────────────────────────────────────────────
  describe('changePassword', () => {
    it('verifies old password with bcrypt, generates new salt & hash, and updates user', async () => {
      const oldHash = await bcrypt.hash('OldSecurePass1!', 10);
      mockQueryRawUnsafe.mockResolvedValueOnce([
        { id: validUserId, auth_subject: oldHash },
      ]);
      mockQueryRawUnsafe.mockResolvedValueOnce([]); // UPDATE query

      await changePassword(validUserId, 'OldSecurePass1!', 'NewSuperSecurePass2@');

      expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(2);

      // Check the UPDATE query
      const updateCall = mockQueryRawUnsafe.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE api.users SET auth_subject = $2 WHERE id = $1::uuid');
      expect(updateCall[1]).toBe(validUserId);

      // Verify the new hash is a valid bcrypt hash matching the new password
      const newHashSaved = updateCall[2];
      expect(newHashSaved).toMatch(/^\$2[ab]\$/);
      const isMatch = await bcrypt.compare('NewSuperSecurePass2@', newHashSaved);
      expect(isMatch).toBe(true);
    });

    it('rejects incorrect old password with UnauthorizedError', async () => {
      const oldHash = await bcrypt.hash('OldSecurePass1!', 10);
      mockQueryRawUnsafe.mockResolvedValueOnce([
        { id: validUserId, auth_subject: oldHash },
      ]);

      await expect(
        changePassword(validUserId, 'WrongOldPassword!', 'NewPassword123!')
      ).rejects.toThrow(new UnauthorizedError('Current password is incorrect.'));

      // Ensure UPDATE was never called
      expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('rejects if user is not found or inactive', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([]);

      await expect(
        changePassword(validUserId, 'OldSecurePass1!', 'NewPassword123!')
      ).rejects.toThrow(new NotFoundError('User'));
    });

    it('rejects legacy demo-admin auth_subject during changePassword', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([
        { id: validUserId, auth_subject: 'demo-admin' },
      ]);

      await expect(
        changePassword(validUserId, 'password123', 'NewPassword123!')
      ).rejects.toThrow(new UnauthorizedError('Current password is incorrect.'));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. signupClinic
  // ───────────────────────────────────────────────────────────────────────────
  describe('signupClinic', () => {
    const signupData = {
      clinicName: 'Apex Family Dental',
      fullName: 'Dr. Robert McCall',
      email: 'robert@apexfamily.test',
      password: 'VeryStrongPassword2026!',
      timezone: 'America/Chicago',
      phone: '+15559876543',
    };

    it('hashes password with bcrypt, assigns admin role, and provisions clinic & user atomically', async () => {
      // 1. Email check -> no duplicate
      mockQueryRawUnsafe.mockResolvedValueOnce([]);
      // 2. Slug check -> no duplicate
      mockQueryRawUnsafe.mockResolvedValueOnce([]);

      // 3. Transaction callback mock
      mockTransaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockImplementation((query: string, ...params: any[]) => {
            if (query.includes('INSERT INTO api.clinics')) {
              return Promise.resolve([
                {
                  id: validClinicId,
                  name: signupData.clinicName,
                  slug: 'apex-family-dental',
                  timezone: signupData.timezone,
                  locale: 'en-US',
                  phone: signupData.phone,
                  email: signupData.email,
                  active: true,
                },
              ]);
            }
            if (query.includes('INSERT INTO api.users')) {
              // Verify role is strictly 'admin' in SQL and password hash is bcrypt in params[1]
              expect(query).toContain("'admin'");
              expect(params[1]).toMatch(/^\$2[ab]\$/); // password hash in auth_subject
              return Promise.resolve([
                {
                  id: validUserId,
                  clinic_id: validClinicId,
                  full_name: signupData.fullName,
                  email: signupData.email,
                  role: 'admin',
                  active: true,
                },
              ]);
            }
            return Promise.resolve([]);
          }),
        };
        return callback(mockTx);
      });

      const res = await signupClinic(signupData);

      expect(res).toBeDefined();
      expect(res.user.id).toBe(validUserId);
      expect(res.user.clinicId).toBe(validClinicId);
      expect(res.user.roles).toEqual(['admin']);
      expect(res.clinic.name).toBe(signupData.clinicName);
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
    });

    it('rejects duplicate email with 409 ConflictError', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 'existing-user-id' }]);

      await expect(signupClinic(signupData)).rejects.toThrow(
        new ConflictError('An account with this email address already exists.')
      );

      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('rejects password shorter than 8 characters with ValidationError', async () => {
      await expect(
        signupClinic({ ...signupData, password: 'short' })
      ).rejects.toThrow(ValidationError);
    });

    it('rejects empty clinicName or fullName with ValidationError', async () => {
      await expect(
        signupClinic({ ...signupData, clinicName: '   ' })
      ).rejects.toThrow(ValidationError);

      await expect(
        signupClinic({ ...signupData, fullName: '   ' })
      ).rejects.toThrow(ValidationError);
    });

    it('generates randomized slug suffix when requested slug collides with an existing clinic', async () => {
      // 1. Email check -> no duplicate
      mockQueryRawUnsafe.mockResolvedValueOnce([]);
      // 2. Slug check -> collides with existing clinic
      mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 'existing-clinic-with-same-slug' }]);

      mockTransaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockImplementation((query: string, ...params: any[]) => {
            if (query.includes('INSERT INTO api.clinics')) {
              const generatedSlug = params[1];
              // Must start with apex-family-dental- followed by a random suffix
              expect(generatedSlug).toMatch(/^apex-family-dental-[a-z0-9]+$/);
              return Promise.resolve([
                {
                  id: validClinicId,
                  name: signupData.clinicName,
                  slug: generatedSlug,
                  timezone: signupData.timezone,
                  locale: 'en-US',
                  active: true,
                },
              ]);
            }
            if (query.includes('INSERT INTO api.users')) {
              return Promise.resolve([
                {
                  id: validUserId,
                  clinic_id: validClinicId,
                  full_name: signupData.fullName,
                  email: signupData.email,
                  role: 'admin',
                  active: true,
                },
              ]);
            }
            return Promise.resolve([]);
          }),
        };
        return callback(mockTx);
      });

      const res = await signupClinic(signupData);
      expect(res.clinic.slug).toMatch(/^apex-family-dental-[a-z0-9]+$/);
    });

    it('normalizes mixed-case email to lowercase during registration', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([]); // email check
      mockQueryRawUnsafe.mockResolvedValueOnce([]); // slug check

      mockTransaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          $queryRawUnsafe: jest.fn().mockImplementation((query: string, ...params: any[]) => {
            if (query.includes('INSERT INTO api.clinics')) {
              expect(params[4]).toBe('robert@apexfamily.test'); // clinic email
              return Promise.resolve([{ id: validClinicId, name: signupData.clinicName, slug: 'apex', timezone: 'America/New_York', active: true }]);
            }
            if (query.includes('INSERT INTO api.users')) {
              expect(params[3]).toBe('robert@apexfamily.test'); // user email
              return Promise.resolve([{ id: validUserId, clinic_id: validClinicId, full_name: signupData.fullName, email: 'robert@apexfamily.test', role: 'admin', active: true }]);
            }
            return Promise.resolve([]);
          }),
        };
        return callback(mockTx);
      });

      await signupClinic({ ...signupData, email: 'Robert@ApexFamily.TEST' });
      expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(email) = $1'),
        'robert@apexfamily.test'
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. refreshAccessToken & getMe
  // ───────────────────────────────────────────────────────────────────────────
  describe('refreshAccessToken & getMe', () => {
    it('successfully refreshes access token from valid refresh token', async () => {
      const validRefreshToken = jwt.sign(
        { sub: validUserId, userId: validUserId, clinicId: validClinicId, type: 'refresh' },
        env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      mockQueryRawUnsafe.mockResolvedValueOnce([
        {
          id: validUserId,
          clinic_id: validClinicId,
          full_name: 'Dr. Jane Smith',
          email: validEmail,
          role: 'clinic_admin',
          active: true,
          clinic_name: 'Bright Smiles Dental',
          clinic_timezone: 'America/New_York',
          suspended_at: null,
          clinic_active: true,
        },
      ]);

      const res = await refreshAccessToken(validRefreshToken);
      expect(res.accessToken).toBeDefined();
      const decoded: any = jwt.verify(res.accessToken, env.JWT_SECRET);
      expect(decoded.sub).toBe(validUserId);
      expect(decoded.clinicId).toBe(validClinicId);
    });

    it('rejects invalid or tampered refresh token with 401', async () => {
      await expect(
        refreshAccessToken('invalid.token.signature')
      ).rejects.toThrow(new UnauthorizedError('Invalid or expired refresh token.'));
    });

    it('rejects refreshAccessToken when user account is deactivated (active = false)', async () => {
      const validRefreshToken = jwt.sign(
        { sub: validUserId, userId: validUserId, clinicId: validClinicId, type: 'refresh' },
        env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      mockQueryRawUnsafe.mockResolvedValueOnce([
        {
          id: validUserId,
          clinic_id: validClinicId,
          active: false,
          clinic_active: true,
          suspended_at: null,
        },
      ]);

      await expect(refreshAccessToken(validRefreshToken)).rejects.toThrow(
        new UnauthorizedError('User account not found or deactivated.')
      );
    });

    it('rejects refreshAccessToken when clinic is suspended or inactive', async () => {
      const validRefreshToken = jwt.sign(
        { sub: validUserId, userId: validUserId, clinicId: validClinicId, type: 'refresh' },
        env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      // Case 1: suspended_at is set
      mockQueryRawUnsafe.mockResolvedValueOnce([
        {
          id: validUserId,
          clinic_id: validClinicId,
          active: true,
          clinic_active: true,
          suspended_at: new Date(),
        },
      ]);

      await expect(refreshAccessToken(validRefreshToken)).rejects.toThrow(
        new ForbiddenError('Clinic account is suspended.')
      );

      // Case 2: clinic_active is false
      mockQueryRawUnsafe.mockResolvedValueOnce([
        {
          id: validUserId,
          clinic_id: validClinicId,
          active: true,
          clinic_active: false,
          suspended_at: null,
        },
      ]);

      await expect(refreshAccessToken(validRefreshToken)).rejects.toThrow(
        new ForbiddenError('Clinic account is suspended.')
      );
    });

    it('getMe returns current authenticated user profile', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([
        {
          id: validUserId,
          clinic_id: validClinicId,
          full_name: 'Dr. Jane Smith',
          email: validEmail,
          role: 'clinic_admin',
          active: true,
          clinic_name: 'Bright Smiles Dental',
          clinic_timezone: 'America/New_York',
        },
      ]);

      const me = await getMe(validUserId);
      expect(me.id).toBe(validUserId);
      expect(me.clinicId).toBe(validClinicId);
      expect(me.firstName).toBe('Dr.');
      expect(me.lastName).toBe('Jane Smith');
      expect(me.roles).toEqual(['clinic_admin']);
    });

    it('throws NotFoundError in getMe when user does not exist in database', async () => {
      mockQueryRawUnsafe.mockResolvedValueOnce([]); // no rows found

      await expect(getMe('00000000-0000-0000-0000-000000000999')).rejects.toThrow(
        new NotFoundError('User')
      );
    });
  });
});
