import { prisma } from '../../database/prisma/client';
import { PatientFilters, PaginatedResponse, UpsertPatientRequest } from '@dental/shared';
import { NotFoundError } from '../../middleware/errors/errorHandler';
import { assertValidUuid } from '../../middleware/authorization/tenantScope';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dental/shared';

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

  const conditions: string[] = ['clinic_id = $1::uuid'];
  const params: unknown[] = [clinicId];
  let idx = 2;

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

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, clinic_id, full_name, phone, email, whatsapp_id, date_of_birth, consent_whatsapp, notes, created_at, updated_at
     FROM api.patients
     WHERE ${where}
     ORDER BY full_name ASC
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
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getPatient(clinicId: string, patientId: string) {
  assertValidUuid(patientId, 'patientId');

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, clinic_id, full_name, phone, email, whatsapp_id, date_of_birth, consent_whatsapp, notes, created_at, updated_at
     FROM api.patients
     WHERE id = $1::uuid AND clinic_id = $2::uuid`,
    patientId,
    clinicId
  );

  if (!rows || rows.length === 0) throw new NotFoundError('Patient');
  return mapPatient(rows[0]);
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
