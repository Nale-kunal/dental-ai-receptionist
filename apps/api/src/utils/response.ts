/**
 * Standardized API response helpers.
 * All responses follow the same envelope format.
 */

import { Response } from 'express';
import { ApiErrorCode } from '@dental/shared';

export interface SuccessResponse<T> {
  ok: true;
  code: 'OK';
  message: string;
  data: T;
}

export interface ErrorResponse {
  ok: false;
  code: ApiErrorCode;
  message: string;
  data: null;
  errors?: Array<{ field: string; message: string }>;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200
): void {
  res.status(statusCode).json({
    ok: true,
    code: 'OK',
    message,
    data,
  } satisfies SuccessResponse<T>);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): void {
  sendSuccess(res, data, message, 201);
}

export function sendError(
  res: Response,
  code: ApiErrorCode,
  message: string,
  statusCode = 400,
  errors?: Array<{ field: string; message: string }>
): void {
  const body: ErrorResponse = { ok: false, code, message, data: null };
  if (errors) body.errors = errors;
  res.status(statusCode).json(body);
}

export function sendNotFound(res: Response, resource = 'Resource'): void {
  sendError(res, 'NOT_FOUND', `${resource} not found`, 404);
}

export function sendUnauthorized(res: Response, message = 'Authentication required'): void {
  sendError(res, 'UNAUTHORIZED', message, 401);
}

export function sendForbidden(res: Response, message = 'Access denied'): void {
  sendError(res, 'FORBIDDEN', message, 403);
}

export function sendConflict(res: Response, message: string): void {
  sendError(res, 'CONFLICT', message, 409);
}

export function sendValidationError(
  res: Response,
  errors: Array<{ field: string; message: string }>,
  message = 'Validation failed'
): void {
  sendError(res, 'VALIDATION', message, 422, errors);
}

export function sendInternalError(res: Response, message = 'An unexpected error occurred'): void {
  sendError(res, 'INTERNAL_ERROR', message, 500);
}
