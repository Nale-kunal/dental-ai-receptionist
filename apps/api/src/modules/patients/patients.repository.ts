import { prisma } from '../../database/prisma/client';
import { PatientFilters, PaginatedResponse, UpsertPatientRequest } from '@dental/shared';
import { NotFoundError, ConflictError, AppError } from '../../middleware/errors/errorHandler';
import { assertValidUuid } from '../../middleware/authorization/tenantScope';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dental/shared';
import { logger } from '../../config/logger';

let cachedPatientColumns: Set<string> | null = null;
export async function getPatientColumns(): Promise<Set<string>> {
  if (cachedPatientColumns) return cachedPatientColumns;
  try {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'api' AND table_name = 'patients'`
    );
    cachedPatientColumns = new Set(cols.map((c) => c.column_name));
  } catch {
    cachedPatientColumns = new Set([
      'id', 'clinic_id', 'full_name', 'phone', 'email', 'whatsapp_id',
      'date_of_birth', 'consent_whatsapp', 'notes', 'created_at', 'updated_at',
    ]);
  }
  return cachedPatientColumns;
}

let hasPatientAuditTable: boolean | null = null;
async function checkPatientAuditTable(): Promise<boolean> {
  if (hasPatientAuditTable !== null) return hasPatientAuditTable;
  try {
    const res = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'api' AND table_name = 'patient_audit_events'`
    );
    hasPatientAuditTable = res.length > 0;
  } catch {
    hasPatientAuditTable = false;
  }
  return hasPatientAuditTable;
}

function mapPatient(p: any) {
  const parts = (p.full_name ?? p.fullName ?? '').split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  return {
    id: p.id,
    clinicId: p.clinic_id ?? p.clinicId,
    fullName: p.full_name ?? p.fullName ?? `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    phone: p.phone,
    email: p.email,
    whatsappId: p.whatsapp_id ?? p.whatsappId ?? null,
    dateOfBirth: p.date_of_birth ? new Date(p.date_of_birth).toISOString().split('T')[0] : null,
    consentWhatsapp: p.consent_whatsapp ?? true,
    notes: p.notes,
    isArchived: Boolean(p.is_archived ?? p.isArchived ?? false),
    archivedAt: p.archived_at ? new Date(p.archived_at).toISOString() : null,
    archivedBy: p.archived_by ?? p.archivedBy ?? null,
    archiveReason: p.archive_reason ?? p.archiveReason ?? null,
    restoredAt: p.restored_at ? new Date(p.restored_at).toISOString() : null,
    restoredBy: p.restored_by ?? p.restoredBy ?? null,
    createdAt: p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString(),
    updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : new Date().toISOString(),
  };
}

export async function listPatients(
  clinicId: string,
  filters: PatientFilters
): Promise<PaginatedResponse<ReturnType<typeof mapPatient>>> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const cols = await getPatientColumns();
  const isArchived = Boolean(filters.isArchived);

  // If archive requested but column does not exist yet in DB, return empty result safely
  if (isArchived && !cols.has('is_archived')) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    };
  }

  const conditions: string[] = ['clinic_id = $1::uuid'];
  const params: unknown[] = [clinicId];
  let idx = 2;

  if (cols.has('is_archived')) {
    conditions.push(`COALESCE(is_archived, false) = $${idx++}`);
    params.push(isArchived);
  }

  if (filters.search) {
    conditions.push(`(full_name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
    `SELECT COUNT(*)::text as count FROM api.patients WHERE ${where}`,
    ...params
  );
  const total = parseInt(countResult[0]?.count ?? '0', 10);

  const selectCols = [
    'id', 'clinic_id', 'full_name', 'phone', 'email', 'whatsapp_id', 'date_of_birth', 'consent_whatsapp', 'notes', 'created_at', 'updated_at',
    ...(cols.has('is_archived') ? ['is_archived'] : []),
    ...(cols.has('archived_at') ? ['archived_at'] : []),
    ...(cols.has('archived_by') ? ['archived_by'] : []),
    ...(cols.has('archive_reason') ? ['archive_reason'] : []),
    ...(cols.has('restored_at') ? ['restored_at'] : []),
    ...(cols.has('restored_by') ? ['restored_by'] : []),
  ].join(', ');

  const orderBy = isArchived && cols.has('archived_at')
    ? 'archived_at DESC NULLS LAST, full_name ASC'
    : 'full_name ASC';

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${selectCols}
     FROM api.patients
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${idx++} OFFSET $${idx++}`,
    ...params,
    pageSize,
    offset
  );

  return {
    items: rows.map(mapPatient),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getArchivedPatientsCount(clinicId: string): Promise<number> {
  const cols = await getPatientColumns();
  if (!cols.has('is_archived')) return 0;

  const result = await prisma.$queryRawUnsafe<[{ count: string }]>(
    `SELECT COUNT(*)::text as count FROM api.patients WHERE clinic_id = $1::uuid AND is_archived = true`,
    clinicId
  );
  return parseInt(result[0]?.count ?? '0', 10);
}

export async function getPatient(clinicId: string, patientId: string) {
  assertValidUuid(patientId, 'patientId');
  const cols = await getPatientColumns();

  const selectCols = [
    'id', 'clinic_id', 'full_name', 'phone', 'email', 'whatsapp_id', 'date_of_birth', 'consent_whatsapp', 'notes', 'created_at', 'updated_at',
    ...(cols.has('is_archived') ? ['is_archived'] : []),
    ...(cols.has('archived_at') ? ['archived_at'] : []),
    ...(cols.has('archived_by') ? ['archived_by'] : []),
    ...(cols.has('archive_reason') ? ['archive_reason'] : []),
    ...(cols.has('restored_at') ? ['restored_at'] : []),
    ...(cols.has('restored_by') ? ['restored_by'] : []),
  ].join(', ');

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${selectCols}
     FROM api.patients
     WHERE id = $1::uuid AND clinic_id = $2::uuid`,
    patientId,
    clinicId
  );

  if (!rows || rows.length === 0) throw new NotFoundError('Patient');
  return mapPatient(rows[0]);
}

export async function archivePatient(
  clinicId: string,
  patientId: string,
  reason?: string,
  userId?: string,
  userEmail?: string
) {
  assertValidUuid(patientId, 'patientId');
  const cols = await getPatientColumns();

  // 1. Verify patient exists and belongs to clinic
  const existing = await getPatient(clinicId, patientId);
  if (existing.isArchived) {
    throw new ConflictError(`Patient "${existing.fullName}" is already archived.`);
  }

  // 2. Check for active upcoming appointments
  const upcomingAppts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.id, a.starts_at, a.status, a.confirmation_code, s.name as "serviceName"
     FROM api.appointments a
     LEFT JOIN api.services s ON s.id = a.service_id
     WHERE a.patient_id = $1::uuid
       AND a.clinic_id = $2::uuid
       AND a.starts_at >= NOW()
       AND a.status IN ('pending', 'confirmed')
     ORDER BY a.starts_at ASC`,
    patientId,
    clinicId
  );

  if (upcomingAppts && upcomingAppts.length > 0) {
    const apptCount = upcomingAppts.length;
    const earliest = new Date(upcomingAppts[0].starts_at).toISOString();
    throw new AppError(
      409,
      'UPCOMING_APPOINTMENTS_EXIST',
      `Cannot archive patient with ${apptCount} active upcoming appointment(s). Please reschedule or cancel upcoming appointment(s) (earliest: ${earliest}) before archiving.`
    );
  }

  // 3. Perform soft archive
  if (cols.has('is_archived')) {
    await prisma.$queryRawUnsafe(
      `UPDATE api.patients
       SET is_archived = true,
           archived_at = NOW(),
           archived_by = $3::uuid,
           archive_reason = $4,
           updated_at = NOW()
       WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      patientId,
      clinicId,
      userId && userId.length === 36 ? userId : null,
      reason?.trim() || null
    );
  }

  // 4. Record in audit trail
  const hasAuditTable = await checkPatientAuditTable();
  if (hasAuditTable) {
    await prisma.$queryRawUnsafe(
      `INSERT INTO api.patient_audit_events (clinic_id, patient_id, action, user_id, user_email, reason, created_at)
       VALUES ($1::uuid, $2::uuid, 'PATIENT_ARCHIVED', $3::uuid, $4, $5, NOW())`,
      clinicId,
      patientId,
      userId && userId.length === 36 ? userId : null,
      userEmail || 'clinic_staff',
      reason?.trim() || null
    ).catch((err) => {
      logger.warn('Failed to record patient archive audit event', { error: err.message, patientId });
    });
  }

  logger.info('Patient archived successfully', {
    clinicId,
    patientId,
    patientName: existing.fullName,
    archivedBy: userEmail || userId,
    reason,
  });

  return getPatient(clinicId, patientId);
}

export async function restorePatient(
  clinicId: string,
  patientId: string,
  userId?: string,
  userEmail?: string
) {
  assertValidUuid(patientId, 'patientId');
  const cols = await getPatientColumns();

  // 1. Verify patient exists and belongs to clinic
  const existing = await getPatient(clinicId, patientId);
  if (!existing.isArchived) {
    throw new ConflictError(`Patient "${existing.fullName}" is not archived.`);
  }

  // 2. Perform restore update
  if (cols.has('is_archived')) {
    await prisma.$queryRawUnsafe(
      `UPDATE api.patients
       SET is_archived = false,
           restored_at = NOW(),
           restored_by = $3::uuid,
           updated_at = NOW()
       WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      patientId,
      clinicId,
      userId && userId.length === 36 ? userId : null
    );
  }

  // 3. Record in audit trail
  const hasAuditTable = await checkPatientAuditTable();
  if (hasAuditTable) {
    await prisma.$queryRawUnsafe(
      `INSERT INTO api.patient_audit_events (clinic_id, patient_id, action, user_id, user_email, reason, created_at)
       VALUES ($1::uuid, $2::uuid, 'PATIENT_RESTORED', $3::uuid, $4, NULL, NOW())`,
      clinicId,
      patientId,
      userId && userId.length === 36 ? userId : null,
      userEmail || 'clinic_staff'
    ).catch((err) => {
      logger.warn('Failed to record patient restore audit event', { error: err.message, patientId });
    });
  }

  logger.info('Patient restored successfully', {
    clinicId,
    patientId,
    patientName: existing.fullName,
    restoredBy: userEmail || userId,
  });

  return getPatient(clinicId, patientId);
}

export async function createPatient(clinicId: string, data: UpsertPatientRequest) {
  const fullName = (data as any).fullName ?? `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim();

  // Call api.find_or_create_patient to preserve n8n deduplication logic
  const result = await prisma.$queryRawUnsafe<any[]>(
    `SELECT api.find_or_create_patient($1::uuid, $2, $3, $4, $5, $6) as res`,
    clinicId,
    fullName,
    data.phone ?? null,
    data.email ?? null,
    data.phone ?? null, // whatsapp_id fallback to phone
    data.dateOfBirth ? new Date(data.dateOfBirth) : null
  );

  const envelope = result[0]?.res;
  if (!envelope || !envelope.ok) {
    throw new Error(envelope?.message ?? 'Failed to create patient');
  }

  const patientId = envelope.data.patient_id;
  return getPatient(clinicId, patientId);
}

export async function updatePatient(
  clinicId: string,
  patientId: string,
  data: Partial<UpsertPatientRequest>
) {
  assertValidUuid(patientId, 'patientId');
  const existing = await getPatient(clinicId, patientId);

  const fullName = (data as any).fullName ?? (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : existing.fullName);

  await prisma.$queryRawUnsafe(
    `UPDATE api.patients
     SET full_name = COALESCE($3, full_name),
         phone = COALESCE($4, phone),
         email = COALESCE($5, email),
         notes = COALESCE($6, notes),
         updated_at = NOW()
     WHERE id = $1::uuid AND clinic_id = $2::uuid`,
    patientId,
    clinicId,
    fullName,
    data.phone ?? null,
    data.email ?? null,
    data.notes ?? null
  );

  return getPatient(clinicId, patientId);
}

export async function getPatientAppointments(clinicId: string, patientId: string) {
  assertValidUuid(patientId, 'patientId');

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.id, a.clinic_id, a.patient_id, a.dentist_id, a.service_id,
            a.starts_at as "startsAt", a.ends_at as "endsAt", a.status,
            a.confirmation_code as "confirmationCode", a.duration_minutes,
            d.display_name as "dentistName", s.name as "serviceName"
     FROM api.appointments a
     LEFT JOIN api.dentists d ON d.id = a.dentist_id
     LEFT JOIN api.services s ON s.id = a.service_id
     WHERE a.patient_id = $1::uuid AND a.clinic_id = $2::uuid
     ORDER BY a.starts_at DESC`,
    patientId,
    clinicId
  );

  return rows.map((r) => ({
    id: r.id,
    startsAt: new Date(r.startsAt).toISOString(),
    endsAt: new Date(r.endsAt).toISOString(),
    status: r.status,
    confirmationCode: r.confirmationCode,
    doctorName: r.dentistName,
    serviceName: r.serviceName,
  }));
}
