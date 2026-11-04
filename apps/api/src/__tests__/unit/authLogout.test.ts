/**
 * authLogout.test.ts
 *
 * Unit and integration tests for backend authentication logout lifecycle,
 * persistent refresh token revocation across service restarts/instances,
 * repeated logout idempotency, and Cache-Control headers.
 * Zero live database required.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app';
import { env } from '../../config/env';
import {
  logoutUser,
  isRefreshTokenRevoked,
  revokeRefreshToken,
  refreshAccessToken,
  clearRevocationCache,
  hashToken,
} from '../../modules/auth/auth.service';
import { UnauthorizedError } from '../../middleware/errors/errorHandler';
import { prisma } from '../../database/prisma/client';

// Mock prisma for unit isolation
jest.mock('../../database/prisma/client', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
  },
}));

const app = createApp();

describe('Auth Logout & Session Revocation Security Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRevocationCache();
  });

  describe('1. Server-Side Refresh Token Revocation', () => {
    const validUserId = '11111111-2222-3333-4444-555555555555';
    const validClinicId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    function createTestRefreshToken(expiresIn = '7d'): string {
      return jwt.sign(
        { sub: validUserId, userId: validUserId, clinicId: validClinicId, type: 'refresh' },
        env.REFRESH_TOKEN_SECRET,
        { expiresIn: expiresIn as any }
      );
    }

    it('marks a valid refresh token as revoked upon logout', async () => {
      const token = createTestRefreshToken();
      expect(await isRefreshTokenRevoked(token)).toBe(false);

      await logoutUser(token);

      expect(await isRefreshTokenRevoked(token)).toBe(true);
    });

    it('rejects refreshAccessToken when the refresh token has been revoked', async () => {
      const token = createTestRefreshToken();
      await logoutUser(token);

      // Attempting to refresh using a revoked refresh token must be rejected
      await expect(refreshAccessToken(token)).rejects.toThrow(
        new UnauthorizedError('Invalid or expired refresh token.')
      );
    });

    it('survives service restart/new instance by checking persistent PostgreSQL storage', async () => {
      const token = createTestRefreshToken();
      const tokenHash = hashToken(token);

      // Simulate: token was previously revoked in PostgreSQL
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([{ token_hash: tokenHash }]);

      // Simulate: brand new service instance or server restart (in-memory cache is empty)
      clearRevocationCache();

      // Service queries database and confirms revocation
      await expect(refreshAccessToken(token)).rejects.toThrow(
        new UnauthorizedError('Invalid or expired refresh token.')
      );

      // Verify Prisma was queried for the persistent revocation check
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('api.revoked_tokens'),
        tokenHash
      );
    });

    it('handles empty or invalid string tokens safely without throwing', async () => {
      await expect(logoutUser('')).resolves.toBeUndefined();
      await expect(logoutUser('not.a.valid.jwt.token')).resolves.toBeUndefined();
    });

    it('is idempotent across repeated logout calls with the same token', async () => {
      const token = createTestRefreshToken();
      await logoutUser(token);
      await logoutUser(token);
      expect(await isRefreshTokenRevoked(token)).toBe(true);
    });
  });

  describe('2. HTTP Cache-Control: no-store Header Verification', () => {
    it('sets no-store, no-cache headers on /api/v1/auth/login endpoint', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@clinic.test', password: 'badpassword' });

      expect(res.headers['cache-control']).toBe(
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['expires']).toBe('0');
    });

    it('sets no-store, no-cache headers on unauthorized 401 error responses', async () => {
      const res = await request(app).get('/api/v1/appointments');

      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe(
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['expires']).toBe('0');
    });

    it('does not apply no-store headers to public non-API routes such as /health', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBeUndefined();
    });
  });
});
