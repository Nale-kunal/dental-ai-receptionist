import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as repo from './appointments.repository';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess, sendCreated } from '../../utils/response';
import { ValidationError } from '../../middleware/errors/errorHandler';

const bookSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor ID'),
  patientId: z.string().uuid('Invalid patient ID'),
  serviceId: z.string().uuid('Invalid service ID'),
  startsAt: z.string().datetime({ offset: true, message: 'Invalid date-time format' }),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const cancelSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').max(500),
});

const rescheduleSchema = z.object({
  newStartsAt: z.string().datetime({ offset: true, message: 'Invalid date-time format' }),
  reason: z.string().max(500).optional(),
});

const filterSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled']).optional(),
  doctorId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sortBy: z.enum(['startsAt', 'createdAt', 'status', 'patientName']).default('startsAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export async function listAppointments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = filterSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }
    const result = await repo.listAppointments(clinicId, parsed.data);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getAppointment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const appointment = await repo.getAppointment(clinicId, req.params.id);
    sendSuccess(res, appointment);
  } catch (err) {
    next(err);
  }
}

export async function bookAppointment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }
    const appointment = await repo.bookAppointment(clinicId, parsed.data as any);
    sendCreated(res, appointment, 'Appointment booked successfully');
  } catch (err) {
    next(err);
  }
}

export async function cancelAppointment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }
    const result = await repo.cancelAppointment(
      clinicId,
      req.params.id,
      parsed.data.reason,
      req.user!.email
    );
    sendSuccess(res, result, 'Appointment cancelled');
  } catch (err) {
    next(err);
  }
}

export async function rescheduleAppointment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }
    const result = await repo.rescheduleAppointment(
      clinicId,
      req.params.id,
      parsed.data.newStartsAt,
      parsed.data.reason
    );
    sendSuccess(res, result, 'Appointment rescheduled');
  } catch (err) {
    next(err);
  }
}

export async function getAppointmentHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const history = await repo.getAppointmentHistory(clinicId, req.params.id);
    sendSuccess(res, history);
  } catch (err) {
    next(err);
  }
}

export async function getDashboardMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const metrics = await repo.getDashboardMetrics(clinicId);
    sendSuccess(res, metrics);
  } catch (err) {
    next(err);
  }
}
