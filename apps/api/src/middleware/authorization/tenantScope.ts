/**
 * Clinic scope enforcement.
 *
 * Every repository that accesses clinic data MUST use these helpers to ensure
 * the query is scoped to the authenticated user's clinic.
 *
 * Never accept clinic_id from request body or query string as proof of authorization.
 */

import { Request } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/errorHandler';

/**
 * Gets the authenticated user's clinic ID from the request.
 * Throws if the user is not authenticated.
 */
export function getAuthenticatedClinicId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }
  return req.user.clinicId;
}

/**
 * Validates that a given record belongs to the authenticated user's clinic.
 * Throws ForbiddenError if there is a mismatch.
 *
 * @param req - The authenticated request
 * @param recordClinicId - The clinic_id from the database record
 * @param resourceName - Used in the error message
 */
export function assertClinicOwnership(
  req: Request,
  recordClinicId: string,
  resourceName = 'Resource'
): void {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  if (recordClinicId !== req.user.clinicId) {
    throw new ForbiddenError(`${resourceName} not found`); // Avoid leaking existence
  }
}

/**
 * Validates that a UUID looks valid (not injected garbage).
 */
export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function assertValidUuid(value: string, fieldName = 'id'): void {
  if (!isValidUuid(value)) {
    throw new Error(`Invalid ${fieldName} format`);
  }
}
