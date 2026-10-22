/**
 * Appointments repository.
 *
 * All booking, cancellation, and rescheduling strictly call the existing
 * database functions (api.book_appointment, api.cancel_appointment, api.reschedule_appointment)
 * to preserve booking invariants, range exclusion locks, and n8n compatibility.
 */

import { prisma } from '../../database/prisma/client';
import { logger } from '../../config/logger';
import {
  AppointmentFilters,
  BookAppointmentRequest,
  PaginatedResponse,
} from '@dental/shared';
import { NotFoundError, ConflictError, AppError } from '../../middleware/errors/errorHandler';
import { assertValidUuid } from '../../middleware/authorization/tenantScope';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dental/shared';

type AppointmentRow = {
  id: string;
  clinicId: string;
  clinicTimezone?: string;
  patientId: string;
  dentistId: string;
  serviceId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  confirmationCode: string;
  durationMinutes: number;
  bufferMinutes: number;
  cancelReason: string | null;
  cancelledAt: Date | null;
  rescheduledFrom: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  patient?: { fullName: string; phone: string | null; email: string | null };
  dentist?: { displayName: string; specialty: string | null };
  service?: { name: string; durationMinutes: number; code: string };
};

function mapAppointment(a: AppointmentRow) {
  return {
    id: a.id,
    clinicId: a.clinicId,
    clinicTimezone: a.clinicTimezone || 'America/New_York',
    patientId: a.patientId,
    doctorId: a.dentistId,
    dentistId: a.dentistId,
    serviceId: a.serviceId,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status as any,
    confirmationCode: a.confirmationCode,
    notes: (a.metadata as any)?.notes ?? null,
    cancellationReason: a.cancelReason,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    rescheduledFrom: a.rescheduledFrom,
    metadata: a.metadata as any,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    patient: a.patient
      ? {
          id: a.patientId,
          name: a.patient.fullName,
          fullName: a.patient.fullName,
          phone: a.patient.phone,
          email: a.patient.email,
        }
      : undefined,
    doctor: a.dentist
      ? {
          id: a.dentistId,
          name: a.dentist.displayName,
          displayName: a.dentist.displayName,
          specialty: a.dentist.specialty,
        }
      : undefined,
    service: a.service
      ? {
          id: a.serviceId!,
          name: a.service.name,
          code: a.service.code,
          durationMinutes: a.service.durationMinutes,
        }
      : undefined,
  };
}

const ALLOWED_SORT_FIELDS: Record<string, string> = {
  startsAt: 'a.starts_at',
  createdAt: 'a.created_at',
  status: 'a.status',
};

export async function listAppointments(
  clinicId: string,
  filters: AppointmentFilters
): Promise<PaginatedResponse<ReturnType<typeof mapAppointment>>> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const sortField = ALLOWED_SORT_FIELDS[filters.sortBy ?? 'startsAt'] ?? 'a.starts_at';
  const sortOrder = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = ['a.clinic_id = $1::uuid'];
  const params: unknown[] = [clinicId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`a.status = $${idx++}::api.appointment_status`);
    params.push(filters.status);
  }
  if (filters.doctorId) {
    assertValidUuid(filters.doctorId, 'doctorId');
    conditions.push(`a.dentist_id = $${idx++}::uuid`);
    params.push(filters.doctorId);
  }
  if (filters.serviceId) {
    assertValidUuid(filters.serviceId, 'serviceId');
    conditions.push(`a.service_id = $${idx++}::uuid`);
    params.push(filters.serviceId);
  }
  if (filters.patientId) {
    assertValidUuid(filters.patientId, 'patientId');
    conditions.push(`a.patient_id = $${idx++}::uuid`);
    params.push(filters.patientId);
  }
  if (filters.dateFrom) {
    conditions.push(`a.starts_at >= $${idx++}`);
    params.push(new Date(filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(`a.starts_at < $${idx++}`);
    params.push(new Date(filters.dateTo));
  }
  if (filters.search) {
    conditions.push(`(
      p.full_name ILIKE $${idx} OR p.phone ILIKE $${idx} OR a.confirmation_code ILIKE $${idx}
    )`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
    `SELECT COUNT(*)::text as count
     FROM api.appointments a
     LEFT JOIN api.patients p ON p.id = a.patient_id
     WHERE ${where}`,
    ...params
  );

  const total = parseInt(countResult[0]?.count ?? '0', 10);

  const rows = await prisma.$queryRawUnsafe<AppointmentRow[]>(
    `SELECT
       a.id, a.clinic_id as "clinicId", c.timezone as "clinicTimezone", a.patient_id as "patientId",
       a.dentist_id as "dentistId", a.service_id as "serviceId",
       a.starts_at as "startsAt", a.ends_at as "endsAt",
       a.status, a.confirmation_code as "confirmationCode",
       a.duration_minutes as "durationMinutes", a.buffer_minutes as "bufferMinutes",
       a.cancel_reason as "cancelReason",
       a.cancelled_at as "cancelledAt", a.rescheduled_from as "rescheduledFrom",
       a.metadata, a.created_at as "createdAt", a.updated_at as "updatedAt",
       json_build_object('fullName', p.full_name, 'phone', p.phone, 'email', p.email) as patient,
       json_build_object('displayName', d.display_name, 'specialty', d.specialty) as dentist,
       CASE WHEN s.id IS NOT NULL THEN
         json_build_object('name', s.name, 'code', s.code, 'durationMinutes', s.duration_minutes)
       ELSE NULL END as service
     FROM api.appointments a
     LEFT JOIN api.clinics c ON c.id = a.clinic_id
     LEFT JOIN api.patients p ON p.id = a.patient_id
     LEFT JOIN api.dentists d ON d.id = a.dentist_id
     LEFT JOIN api.services s ON s.id = a.service_id
     WHERE ${where}
     ORDER BY ${sortField} ${sortOrder}
     LIMIT $${idx++} OFFSET $${idx++}`,
    ...params,
    pageSize,
    offset
  );

  return {
    items: rows.map(mapAppointment),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getAppointment(clinicId: string, appointmentId: string) {
  assertValidUuid(appointmentId, 'appointmentId');

  const rows = await prisma.$queryRawUnsafe<AppointmentRow[]>(
    `SELECT
       a.id, a.clinic_id as "clinicId", c.timezone as "clinicTimezone", a.patient_id as "patientId",
       a.dentist_id as "dentistId", a.service_id as "serviceId",
       a.starts_at as "startsAt", a.ends_at as "endsAt",
       a.status, a.confirmation_code as "confirmationCode",
       a.duration_minutes as "durationMinutes", a.buffer_minutes as "bufferMinutes",
       a.cancel_reason as "cancelReason",
       a.cancelled_at as "cancelledAt", a.rescheduled_from as "rescheduledFrom",
       a.metadata, a.created_at as "createdAt", a.updated_at as "updatedAt",
       json_build_object('fullName', p.full_name, 'phone', p.phone, 'email', p.email) as patient,
       json_build_object('displayName', d.display_name, 'specialty', d.specialty) as dentist,
       CASE WHEN s.id IS NOT NULL THEN
         json_build_object('name', s.name, 'code', s.code, 'durationMinutes', s.duration_minutes)
       ELSE NULL END as service
     FROM api.appointments a
     LEFT JOIN api.clinics c ON c.id = a.clinic_id
     LEFT JOIN api.patients p ON p.id = a.patient_id
     LEFT JOIN api.dentists d ON d.id = a.dentist_id
     LEFT JOIN api.services s ON s.id = a.service_id
     WHERE a.id = $1::uuid AND a.clinic_id = $2::uuid`,
    appointmentId,
    clinicId
  );

  if (!rows || rows.length === 0) {
    throw new NotFoundError('Appointment');
  }

  return mapAppointment(rows[0]);
}

export async function bookAppointment(clinicId: string, data: BookAppointmentRequest) {
  assertValidUuid(data.doctorId, 'doctorId');
  assertValidUuid(data.patientId, 'patientId');
  assertValidUuid(data.serviceId, 'serviceId');

  const startsAt = new Date(data.startsAt);
  if (isNaN(startsAt.getTime())) {
    throw new AppError(422, 'VALIDATION', 'Invalid appointment start time.');
  }

  // Call the existing api.book_appointment function — preserves all booking invariants
  const result = await prisma.$queryRawUnsafe<any[]>(
    `SELECT api.book_appointment($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::jsonb) as book_appointment`,
    clinicId,
    data.doctorId,
    data.patientId,
    data.serviceId,
    startsAt.toISOString(),
    JSON.stringify(data.metadata ?? {})
  );

  const envelope = result[0]?.book_appointment as {
    ok: boolean;
    code: string;
    message: string;
    data: unknown;
  };

  if (!envelope || !envelope.ok) {
    if (envelope?.code === 'CONFLICT') throw new ConflictError(envelope.message);
    if (envelope?.code === 'NOT_FOUND') throw new NotFoundError('Appointment slot');
    throw new AppError(400, envelope?.code ?? 'BOOKING_FAILED', envelope?.message ?? 'Booking failed');
  }

  logger.info('Appointment booked', { clinicId, appointmentId: (envelope.data as any)?.appointment_id });
  return envelope.data;
}

export async function cancelAppointment(
  clinicId: string,
  appointmentId: string,
  reason: string,
  actorEmail: string
) {
  assertValidUuid(appointmentId, 'appointmentId');

  const result = await prisma.$queryRawUnsafe<any[]>(
    `SELECT api.cancel_appointment($1::uuid, $2::uuid, $3, $4) as cancel_appointment`,
    clinicId,
    appointmentId,
    reason,
    actorEmail
  );

  const envelope = result[0]?.cancel_appointment as {
    ok: boolean;
    code: string;
    message: string;
    data: unknown;
  };

  if (!envelope || !envelope.ok) {
    if (envelope?.code === 'NOT_FOUND') throw new NotFoundError('Appointment');
    if (envelope?.code === 'CONFLICT') throw new ConflictError(envelope.message);
    throw new AppError(400, envelope?.code ?? 'CANCEL_FAILED', envelope?.message ?? 'Cancellation failed');
  }

  logger.info('Appointment cancelled', { clinicId, appointmentId, actor: actorEmail });
  return envelope.data;
}

export async function rescheduleAppointment(
  clinicId: string,
  appointmentId: string,
  newStartsAt: string,
  reason?: string
) {
  assertValidUuid(appointmentId, 'appointmentId');

  const startsAt = new Date(newStartsAt);
  if (isNaN(startsAt.getTime())) {
    throw new AppError(422, 'VALIDATION', 'Invalid new appointment start time.');
  }

  const result = await prisma.$queryRawUnsafe<any[]>(
    `SELECT api.reschedule_appointment($1::uuid, $2::uuid, $3::timestamptz, $4) as reschedule_appointment`,
    clinicId,
    appointmentId,
    startsAt.toISOString(),
    reason ?? null
  );

  const envelope = result[0]?.reschedule_appointment as {
    ok: boolean;
    code: string;
    message: string;
    data: unknown;
  };

  if (!envelope || !envelope.ok) {
    if (envelope?.code === 'NOT_FOUND') throw new NotFoundError('Appointment');
    if (envelope?.code === 'CONFLICT') throw new ConflictError(envelope.message);
    throw new AppError(400, envelope?.code ?? 'RESCHEDULE_FAILED', envelope?.message ?? 'Rescheduling failed');
  }

  logger.info('Appointment rescheduled', { clinicId, appointmentId });
  return envelope.data;
}

export async function getAppointmentHistory(clinicId: string, appointmentId: string) {
  assertValidUuid(appointmentId, 'appointmentId');

  const history = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, appointment_id as "appointmentId", from_status as "previousStatus",
            to_status as "newStatus", changed_by as "changedBy", reason,
            created_at as "changedAt"
     FROM api.appointment_status_history
     WHERE appointment_id = $1::uuid AND clinic_id = $2::uuid
     ORDER BY created_at ASC`,
    appointmentId,
    clinicId
  );

  return history.map((h) => ({
    id: h.id.toString(),
    appointmentId: h.appointmentId,
    previousStatus: h.previousStatus,
    newStatus: h.newStatus,
    changedBy: h.changedBy,
    reason: h.reason,
    changedAt: new Date(h.changedAt).toISOString(),
  }));
}

export async function getDashboardMetrics(clinicId: string) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const [todayStats, upcoming7, upcoming30, patientStats, conversationStats, handoffStats, dentistStats] =
    await Promise.all([
      prisma.$queryRawUnsafe<Array<{ status: string; count: string }>>(
        `SELECT status, COUNT(*)::text as count
         FROM api.appointments
         WHERE clinic_id = $1::uuid AND starts_at >= $2 AND starts_at <= $3
         GROUP BY status`,
        clinicId, todayStart, todayEnd
      ).catch(() => []),
      prisma.$queryRawUnsafe<[{ count: string }]>(
        `SELECT COUNT(*)::text as count FROM api.appointments
         WHERE clinic_id = $1::uuid AND starts_at > $2 AND starts_at <= $3
         AND status NOT IN ('cancelled', 'rescheduled')`,
        clinicId, now, new Date(now.getTime() + 7 * 86400000)
      ).catch(() => [{ count: '0' }]),
      prisma.$queryRawUnsafe<[{ count: string }]>(
        `SELECT COUNT(*)::text as count FROM api.appointments
         WHERE clinic_id = $1::uuid AND starts_at > $2 AND starts_at <= $3
         AND status NOT IN ('cancelled', 'rescheduled')`,
        clinicId, now, new Date(now.getTime() + 30 * 86400000)
      ).catch(() => [{ count: '0' }]),
      prisma.$queryRawUnsafe<[{ total: string; new_this_month: string }]>(
        `SELECT COUNT(*)::text as total,
         SUM(CASE WHEN created_at >= date_trunc('month', NOW()) THEN 1 ELSE 0 END)::text as new_this_month
         FROM api.patients WHERE clinic_id = $1::uuid`,
        clinicId
      ).catch(() => [{ total: '0', new_this_month: '0' }]),
      prisma.$queryRawUnsafe<[{ total: string }]>(
        `SELECT COUNT(*)::text as total FROM api.conversations WHERE clinic_id = $1::uuid`,
        clinicId
      ).catch(() => [{ total: '0' }]),
      prisma.$queryRawUnsafe<[{ count: string }]>(
        `SELECT COUNT(*)::text as count FROM api.handoffs
         WHERE clinic_id = $1::uuid AND status = 'pending'`,
        clinicId
      ).catch(() => [{ count: '0' }]),
      prisma.$queryRawUnsafe<[{ active: string; total: string }]>(
        `SELECT
           SUM(CASE WHEN active THEN 1 ELSE 0 END)::text as active,
           COUNT(*)::text as total
         FROM api.dentists WHERE clinic_id = $1::uuid`,
        clinicId
      ).catch(() => [{ active: '0', total: '0' }]),
    ]);

  const statusMap: Record<string, number> = {};
  for (const row of todayStats) {
    statusMap[row.status] = parseInt(row.count, 10);
  }

  return {
    today: {
      total: Object.values(statusMap).reduce((a, b) => a + b, 0),
      confirmed: statusMap.confirmed ?? 0,
      pending: statusMap.pending ?? 0,
      completed: statusMap.completed ?? 0,
      cancelled: statusMap.cancelled ?? 0,
      noShow: statusMap.no_show ?? 0,
    },
    upcoming: {
      next7Days: parseInt(upcoming7[0]?.count ?? '0', 10),
      next30Days: parseInt(upcoming30[0]?.count ?? '0', 10),
    },
    patients: {
      total: parseInt(patientStats[0]?.total ?? '0', 10),
      newThisMonth: parseInt(patientStats[0]?.new_this_month ?? '0', 10),
    },
    conversations: {
      totalCount: parseInt(conversationStats[0]?.total ?? '0', 10),
      pendingHandoffs: parseInt(handoffStats[0]?.count ?? '0', 10),
    },
    doctors: {
      active: parseInt(dentistStats[0]?.active ?? '0', 10),
      total: parseInt(dentistStats[0]?.total ?? '0', 10),
    },
    generatedAt: now.toISOString(),
  };
}
