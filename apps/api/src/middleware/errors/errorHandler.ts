/**
 * Global error handling middleware.
 * Converts all thrown errors to consistent API responses.
 * Never exposes stack traces or internal details to clients.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';
import { sendError, sendInternalError, sendValidationError } from '../../utils/response';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly errors?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    errors: Array<{ field: string; message: string }>
  ) {
    super(422, 'VALIDATION', message, errors);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Request correlation for log tracing
  const requestId = (req as any).id ?? 'unknown';

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Application error', {
        requestId,
        code: err.code,
        message: err.message,
        path: req.path,
        method: req.method,
      });
    }

    if (err.errors) {
      sendValidationError(res, err.errors, err.message);
    } else {
      sendError(res, err.code as any, err.message, err.statusCode);
    }
    return;
  }

  // Prisma errors
  if (err instanceof Error && err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    if (prismaErr.code === 'P2025') {
      sendError(res, 'NOT_FOUND', 'Record not found', 404);
      return;
    }
    if (prismaErr.code === 'P2002') {
      sendError(res, 'CONFLICT', 'A record with these details already exists', 409);
      return;
    }
  }

  // Unknown errors — log full details but send safe message
  logger.error('Unhandled error', {
    requestId,
    name: err instanceof Error ? err.name : 'Unknown',
    message: err instanceof Error ? err.message : String(err),
    path: req.path,
    method: req.method,
  });

  sendInternalError(res);
}
