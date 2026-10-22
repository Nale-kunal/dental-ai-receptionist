/**
 * JWT-based authentication middleware.
 *
 * Verifies access tokens from Authorization: Bearer <token>.
 * Attaches the verified user context to req.user.
 * Never trusts client-supplied clinic_id — always derives from server-side user record.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { sendUnauthorized } from '../../utils/response';
import { logger } from '../../config/logger';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  clinicId: string;   // Server-resolved — never trust req.body or query params for this
  tenantId: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      id?: string; // request ID
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    sendUnauthorized(res, 'Authentication required');
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      email: string;
      clinicId: string;
      tenantId: string;
      roles: string[];
      iat: number;
      exp: number;
    };

    req.user = {
      userId: payload.sub,
      email: payload.email,
      clinicId: payload.clinicId,
      tenantId: payload.tenantId,
      roles: payload.roles,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendUnauthorized(res, 'Session expired. Please sign in again.');
    } else if (err instanceof jwt.JsonWebTokenError) {
      sendUnauthorized(res, 'Invalid session. Please sign in again.');
    } else {
      logger.error('Unexpected auth error', { error: String(err) });
      sendUnauthorized(res, 'Authentication failed.');
    }
  }
}

/**
 * Middleware that requires the authenticated user to have at least one of the specified roles.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendUnauthorized(res);
      return;
    }

    const hasRole = req.user.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      logger.warn('Role authorization denied', {
        userId: req.user.userId,
        userRoles: req.user.roles,
        requiredRoles: allowedRoles,
        path: req.path,
      });
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
        data: null,
      });
      return;
    }

    next();
  };
}

/**
 * Extract and validate the clinic ID from the route params,
 * ensuring it matches the authenticated user's authorized clinic.
 *
 * SECURITY: This prevents insecure direct object references.
 * A user cannot access another clinic by changing the URL.
 */
export function validateClinicAccess(req: Request, res: Response, next: NextFunction): void {
  const paramClinicId = req.params.clinicId;

  if (!req.user) {
    sendUnauthorized(res);
    return;
  }

  if (paramClinicId && paramClinicId !== req.user.clinicId) {
    logger.warn('Cross-clinic access attempt', {
      userId: req.user.userId,
      userClinicId: req.user.clinicId,
      requestedClinicId: paramClinicId,
      path: req.path,
    });
    res.status(403).json({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Access denied.',
      data: null,
    });
    return;
  }

  next();
}
