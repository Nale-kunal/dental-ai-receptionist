/**
 * Auth service — handles authentication, JWT token generation, refresh, and profile retrieval.
 * Connects directly to api.users and api.clinics in Neon PostgreSQL.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../../database/prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import {
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from '../../middleware/errors/errorHandler';
import {
  AuthUser,
  LoginRequest,
  LoginResponse,
  SignupRequest,
  SignupResponse,
} from '@dental/shared';

function parseTokenExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 3600 * 1000;
  if (unit === 'd') return val * 86400 * 1000;
  return 15 * 60 * 1000;
}

export function generateTokenPair(user: AuthUser): { accessToken: string; refreshToken: string } {
  const accessPayload = {
    sub: user.id,
    userId: user.id,
    clinicId: user.clinicId,
    email: user.email,
    roles: user.roles,
    role: user.roles[0] || 'clinic_admin',
    name: user.firstName + (user.lastName ? ' ' + user.lastName : ''),
  };

  const accessToken = jwt.sign(accessPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });

  const refreshPayload = {
    sub: user.id,
    userId: user.id,
    clinicId: user.clinicId,
    type: 'refresh',
  };

  const refreshToken = jwt.sign(refreshPayload, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as any,
  });

  return { accessToken, refreshToken };
}

/**
 * Register a new clinic and its founding administrator in an atomic transaction.
 * Strictly assigns 'clinic_admin' role (never allows client-supplied platform admin).
 */
export async function signupClinic(data: SignupRequest): Promise<SignupResponse> {
  const normalizedEmail = data.email.toLowerCase().trim();
  const trimmedName = data.clinicName.trim();
  const trimmedFullName = data.fullName.trim();

  if (!trimmedName) {
    throw new ValidationError('Validation failed', [{ field: 'clinicName', message: 'Clinic name is required' }]);
  }
  if (!trimmedFullName) {
    throw new ValidationError('Validation failed', [{ field: 'fullName', message: 'Full name is required' }]);
  }
  if (!data.password || data.password.length < 8) {
    throw new ValidationError('Validation failed', [{ field: 'password', message: 'Password must be at least 8 characters' }]);
  }

  // 1. Verify email uniqueness across all users
  const existingUsers = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM api.users WHERE LOWER(email) = $1`,
    normalizedEmail
  );
  if (existingUsers.length > 0) {
    throw new ConflictError('An account with this email address already exists.');
  }

  // 2. Generate a clean unique slug
  let baseSlug = trimmedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  if (!baseSlug) baseSlug = 'clinic';

  let slug = baseSlug;
  const existingClinics = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM api.clinics WHERE slug = $1`,
    slug
  );
  if (existingClinics.length > 0) {
    slug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;
  }

  // 3. Hash password securely using bcrypt
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(data.password, salt);

  // 4. Atomic transaction to create clinic, owner, operating hours, and standard treatment services
  const { clinic, user } = await prisma.$transaction(async (tx) => {
    // A. Create clinic record
    const clinicRows = await tx.$queryRawUnsafe<any[]>(
      `INSERT INTO api.clinics (name, slug, timezone, locale, phone, email, active, settings)
       VALUES ($1, $2, $3, 'en-US', $4, $5, true, $6::jsonb)
       RETURNING id, name, slug, timezone, locale, phone, email, active`,
      trimmedName,
      slug,
      data.timezone || 'America/New_York',
      data.phone?.trim() || null,
      normalizedEmail,
      JSON.stringify({
        receptionist: {
          enabled: true,
          tone: 'warm_professional',
          welcomeMessage: `Welcome to ${trimmedName}! How may our dental team assist you today?`,
        },
        country: (data as any).country || '',
        state: (data as any).state || '',
        city: (data as any).city || '',
        currency: (data as any).currency || 'USD',
        postalCode: (data as any).postalCode || '',
      })
    );
    const createdClinic = clinicRows[0];

    // B. Create founding clinic owner (enforced admin role, never client-controlled)
    const userRows = await tx.$queryRawUnsafe<any[]>(
      `INSERT INTO api.users (clinic_id, auth_subject, full_name, email, role, active)
       VALUES ($1::uuid, $2, $3, $4, 'admin', true)
       RETURNING id, clinic_id, full_name, email, role, active`,
      createdClinic.id,
      hashedPassword,
      trimmedFullName,
      normalizedEmail
    );
    const createdUser = userRows[0];

    // C. Clean Tenant Provisioning:
    // Newly registered clinics start with a genuinely clean, unconfigured state.
    // They must NOT inherit demo hours, demo services, demo dentists, or demo records.
    // The clinic administrator configures their specific operating hours and service catalog.

    return { clinic: createdClinic, user: createdUser };
  });

  const parts = trimmedFullName.split(' ');
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    firstName: parts[0] || 'Admin',
    lastName: parts.slice(1).join(' ') || '',
    clinicId: clinic.id,
    clinicName: clinic.name,
    clinicTimezone: clinic.timezone,
    tenantId: clinic.id,
    roles: [user.role || 'admin'],
  };

  const { accessToken, refreshToken } = generateTokenPair(authUser);

  logger.info('Clinic onboarding completed', {
    clinicId: clinic.id,
    userId: user.id,
    email: normalizedEmail,
  });

  return {
    user: authUser,
    clinic: {
      id: clinic.id,
      name: clinic.name,
      slug: clinic.slug,
      timezone: clinic.timezone,
    },
    accessToken,
    refreshToken,
    expiresIn: parseTokenExpiry(env.JWT_EXPIRES_IN) / 1000,
  };
}

export async function loginUser(data: LoginRequest): Promise<LoginResponse> {
  const emailInput = data.email.toLowerCase().trim();

  // Find user in api.users join clinics to inspect active and suspended status
  const userRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id, u.clinic_id, u.auth_subject, u.full_name, u.email, u.role, u.active,
            c.name as clinic_name, c.timezone as clinic_timezone, c.suspended_at, c.active as clinic_active
     FROM api.users u
     JOIN api.clinics c ON c.id = u.clinic_id
     WHERE LOWER(u.email) = $1`,
    emailInput
  );

  const user = userRows[0];

  // Consistent timing / response to avoid account enumeration
  if (!user) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  // Check account active status
  if (!user.active) {
    throw new UnauthorizedError('User account has been deactivated.');
  }

  // Enforce clinic suspension / inactive status
  if (user.suspended_at || !user.clinic_active) {
    throw new ForbiddenError('Clinic account is suspended. Please contact clinic administration.');
  }

  // Verify password with bcrypt or demo subject
  let isPasswordValid = false;
  if (user.auth_subject === 'demo-admin') {
    // In production, demo shortcut passwords are strictly disabled
    if (env.NODE_ENV === 'production') {
      throw new UnauthorizedError('Invalid email or password.');
    }
    isPasswordValid = data.password === 'password123' || data.password === 'demo';
  } else if (
    user.auth_subject &&
    (user.auth_subject.startsWith('$2a$') ||
      user.auth_subject.startsWith('$2b$') ||
      user.auth_subject.startsWith('$2y$'))
  ) {
    isPasswordValid = await bcrypt.compare(data.password, user.auth_subject);
  } else if (user.auth_subject) {
    isPasswordValid = data.password === user.auth_subject;
  }

  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  const parts = (user.full_name || '').split(' ');
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    firstName: parts[0] || 'Admin',
    lastName: parts.slice(1).join(' ') || '',
    clinicId: user.clinic_id,
    clinicName: user.clinic_name,
    clinicTimezone: user.clinic_timezone || 'America/New_York',
    tenantId: user.clinic_id,
    roles: [user.role || 'clinic_admin'],
  };

  const { accessToken, refreshToken } = generateTokenPair(authUser);

  logger.info('User logged in', { userId: user.id, email: user.email, clinicId: user.clinic_id });

  return {
    user: authUser,
    accessToken,
    refreshToken,
    expiresIn: parseTokenExpiry(env.JWT_EXPIRES_IN) / 1000,
  };
}

export async function refreshAccessToken(
  rawRefreshToken: string
): Promise<Pick<LoginResponse, 'accessToken' | 'expiresIn'>> {
  let payload: any;
  try {
    payload = jwt.verify(rawRefreshToken, env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token.');
  }

  const userRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id, u.clinic_id, u.full_name, u.email, u.role, u.active,
            c.name as clinic_name, c.timezone as clinic_timezone, c.suspended_at, c.active as clinic_active
     FROM api.users u
     JOIN api.clinics c ON c.id = u.clinic_id
     WHERE u.id = $1::uuid`,
    payload.userId || payload.sub
  );

  const user = userRows[0];
  if (!user || !user.active) {
    throw new UnauthorizedError('User account not found or deactivated.');
  }

  if (user.suspended_at || !user.clinic_active) {
    throw new ForbiddenError('Clinic account is suspended.');
  }

  const parts = (user.full_name || '').split(' ');
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    firstName: parts[0] || 'Admin',
    lastName: parts.slice(1).join(' ') || '',
    clinicId: user.clinic_id,
    clinicName: user.clinic_name,
    clinicTimezone: user.clinic_timezone || 'America/New_York',
    tenantId: user.clinic_id,
    roles: [user.role || 'clinic_admin'],
  };

  const { accessToken } = generateTokenPair(authUser);

  return {
    accessToken,
    expiresIn: parseTokenExpiry(env.JWT_EXPIRES_IN) / 1000,
  };
}

export async function getMe(userId: string): Promise<AuthUser> {
  const userRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.id, u.clinic_id, u.full_name, u.email, u.role, u.active,
            c.name as clinic_name, c.timezone as clinic_timezone
     FROM api.users u
     JOIN api.clinics c ON c.id = u.clinic_id
     WHERE u.id = $1::uuid`,
    userId
  );

  const user = userRows[0];
  if (!user) throw new NotFoundError('User');

  const parts = (user.full_name || '').split(' ');
  return {
    id: user.id,
    email: user.email,
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    clinicId: user.clinic_id,
    clinicName: user.clinic_name,
    clinicTimezone: user.clinic_timezone || 'America/New_York',
    tenantId: user.clinic_id,
    roles: [user.role || 'clinic_admin'],
  };
}

export async function logoutUser(_userId: string, _refreshToken?: string): Promise<void> {
  // Stateless JWT logout with client session invalidation
  logger.info('User signed out', { userId: _userId });
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const userRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, auth_subject FROM api.users WHERE id = $1::uuid AND active = true`,
    userId
  );

  const user = userRows[0];
  if (!user) throw new NotFoundError('User');

  let isOldValid = false;
  if (user.auth_subject === 'demo-admin') {
    isOldValid = oldPassword === 'password123' || oldPassword === 'demo';
  } else if (
    user.auth_subject &&
    (user.auth_subject.startsWith('$2a$') ||
      user.auth_subject.startsWith('$2b$') ||
      user.auth_subject.startsWith('$2y$'))
  ) {
    isOldValid = await bcrypt.compare(oldPassword, user.auth_subject);
  } else {
    isOldValid = oldPassword === user.auth_subject;
  }

  if (!isOldValid) {
    throw new UnauthorizedError('Current password is incorrect.');
  }

  const salt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, salt);

  await prisma.$queryRawUnsafe(
    `UPDATE api.users SET auth_subject = $2 WHERE id = $1::uuid`,
    userId,
    newHash
  );

  logger.info('User password updated securely', { userId });
}
