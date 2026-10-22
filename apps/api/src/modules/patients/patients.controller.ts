import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as repo from './patients.repository';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess, sendCreated } from '../../utils/response';
import { ValidationError, ConflictError } from '../../middleware/errors/errorHandler';

const patientSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  notes: z.string().max(2000).optional(),
});

function normalizePatientNames<T extends { fullName?: string; firstName?: string; lastName?: string }>(data: T): T & { fullName: string; firstName: string; lastName: string } {
  let fullName = data.fullName?.trim();
  let firstName = data.firstName?.trim();
  let lastName = data.lastName?.trim();

  if (fullName && (!firstName || !lastName)) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] || 'Unknown';
    lastName = parts.slice(1).join(' ') || parts[0] || 'Patient';
  } else if (!fullName && (firstName || lastName)) {
    fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown Patient';
    firstName = firstName || 'Unknown';
    lastName = lastName || 'Patient';
  } else if (!fullName && !firstName && !lastName) {
    fullName = 'New Patient';
    firstName = 'New';
    lastName = 'Patient';
  }

  return {
    ...data,
    fullName: fullName!,
    firstName: firstName!,
    lastName: lastName!,
  };
}

const filterSchema = z.object({
  search: z.string().max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['lastName', 'firstName', 'createdAt']).default('lastName'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export async function listPatients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = filterSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })));
    }
    const result = await repo.listPatients(clinicId, parsed.data);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const patient = await repo.getPatient(clinicId, req.params.id);
    sendSuccess(res, patient);
  } catch (err) {
    next(err);
  }
}

export async function createPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = patientSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })));
    }
    const normalizedData = normalizePatientNames(parsed.data);
    try {
      const patient = await repo.createPatient(clinicId, normalizedData as any);
      sendCreated(res, patient, 'Patient created');
    } catch (e: any) {
      if (e.message?.includes('already exists')) throw new ConflictError(e.message);
      throw e;
    }
  } catch (err) {
    next(err);
  }
}

export async function updatePatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = patientSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })));
    }
    const patient = await repo.updatePatient(clinicId, req.params.id, parsed.data);
    sendSuccess(res, patient, 'Patient updated');
  } catch (err) {
    next(err);
  }
}

export async function getPatientAppointments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const appointments = await repo.getPatientAppointments(clinicId, req.params.id);
    sendSuccess(res, appointments);
  } catch (err) {
    next(err);
  }
}
