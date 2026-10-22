import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess, sendCreated } from '../../utils/response';
import { ValidationError, NotFoundError } from '../../middleware/errors/errorHandler';
import { z } from 'zod';

export const doctorsRouter = Router();
doctorsRouter.use(authenticate);

const doctorSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  title: z.string().max(50).optional().nullable(),
  qualifications: z.string().max(300).optional().nullable(),
  specialty: z.string().max(200).optional().nullable(),
  experienceYears: z.number().int().min(0).max(70).optional().nullable(),
  licenseNumber: z.string().max(100).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  defaultBufferMinutes: z.number().int().min(0).max(120).optional(),
});

let cachedDentistColumns: Set<string> | null = null;

async function getDentistColumns(): Promise<Set<string>> {
  if (cachedDentistColumns) return cachedDentistColumns;
  try {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'api' AND table_name = 'dentists'`
    );
    cachedDentistColumns = new Set(cols.map((c) => c.column_name));
  } catch {
    cachedDentistColumns = new Set(['id', 'clinic_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at']);
  }
  return cachedDentistColumns;
}

function mapDentist(d: any) {
  const displayName = d.display_name ?? d.displayName ?? d.name ?? 'Dr. Dentist';
  return {
    id: d.id,
    clinicId: d.clinic_id ?? d.clinicId,
    displayName,
    name: displayName,
    title: d.title ?? null,
    qualifications: d.qualifications ?? null,
    specialty: d.specialty || 'General Dentistry',
    experienceYears: d.experience_years != null ? Number(d.experience_years) : (d.experienceYears != null ? Number(d.experienceYears) : null),
    licenseNumber: d.license_number ?? d.licenseNumber ?? null,
    bio: d.bio ?? null,
    active: d.active ?? true,
    isActive: d.active ?? true,
    defaultBufferMinutes: d.default_buffer_minutes ?? d.defaultBufferMinutes ?? 15,
    createdAt: d.created_at ? new Date(d.created_at).toISOString() : new Date().toISOString(),
  };
}

doctorsRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const cols = await getDentistColumns();
    const selectFields = [
      'id', 'clinic_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at',
      ...(cols.has('title') ? ['title'] : []),
      ...(cols.has('qualifications') ? ['qualifications'] : []),
      ...(cols.has('experience_years') ? ['experience_years'] : []),
      ...(cols.has('license_number') ? ['license_number'] : []),
      ...(cols.has('bio') ? ['bio'] : []),
    ].join(', ');

    const dentists = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectFields}
       FROM api.dentists
       WHERE clinic_id = $1::uuid
       ORDER BY display_name ASC`,
      clinicId
    );
    sendSuccess(res, dentists.map(mapDentist));
  } catch (e) { next(e); }
});

doctorsRouter.post('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = doctorSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
    }

    const cols = await getDentistColumns();
    const displayName = parsed.data.displayName || parsed.data.name || 'Dr. New Dentist';
    const specialty = parsed.data.specialty || 'General Dentistry';
    const defaultBuffer = parsed.data.defaultBufferMinutes ?? 15;
    const active = parsed.data.active ?? parsed.data.isActive ?? true;

    // Check if any requested professional fields cannot be persisted in the current database schema
    const unpersistedRequestedFields: string[] = [];
    if (parsed.data.title !== undefined && parsed.data.title !== null && parsed.data.title !== '' && !cols.has('title')) {
      unpersistedRequestedFields.push('title');
    }
    if (parsed.data.qualifications !== undefined && parsed.data.qualifications !== null && parsed.data.qualifications !== '' && !cols.has('qualifications')) {
      unpersistedRequestedFields.push('qualifications');
    }
    if (parsed.data.experienceYears !== undefined && parsed.data.experienceYears !== null && !cols.has('experience_years')) {
      unpersistedRequestedFields.push('experienceYears');
    }
    if (parsed.data.licenseNumber !== undefined && parsed.data.licenseNumber !== null && parsed.data.licenseNumber !== '' && !cols.has('license_number')) {
      unpersistedRequestedFields.push('licenseNumber');
    }
    if (parsed.data.bio !== undefined && parsed.data.bio !== null && parsed.data.bio !== '' && !cols.has('bio')) {
      unpersistedRequestedFields.push('bio');
    }

    if (unpersistedRequestedFields.length > 0) {
      throw new ValidationError(
        `Professional profile fields (${unpersistedRequestedFields.join(', ')}) cannot be persisted because their columns have not yet been added to the database. Please execute migration 001_add_dentist_profile_fields.sql on the Neon database.`,
        unpersistedRequestedFields.map((field) => ({
          field,
          message: 'Database column not present in api.dentists. Requires pending SQL migration 001_add_dentist_profile_fields.sql.',
        }))
      );
    }

    const insertCols = ['clinic_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes'];
    const insertVals: any[] = [clinicId, displayName, specialty, active, defaultBuffer];

    if (cols.has('title') && parsed.data.title !== undefined) {
      insertCols.push('title');
      insertVals.push(parsed.data.title ?? null);
    }
    if (cols.has('qualifications') && parsed.data.qualifications !== undefined) {
      insertCols.push('qualifications');
      insertVals.push(parsed.data.qualifications ?? null);
    }
    if (cols.has('experience_years') && parsed.data.experienceYears !== undefined) {
      insertCols.push('experience_years');
      insertVals.push(parsed.data.experienceYears ?? null);
    }
    if (cols.has('license_number') && parsed.data.licenseNumber !== undefined) {
      insertCols.push('license_number');
      insertVals.push(parsed.data.licenseNumber ?? null);
    }
    if (cols.has('bio') && parsed.data.bio !== undefined) {
      insertCols.push('bio');
      insertVals.push(parsed.data.bio ?? null);
    }

    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
    const retCols = insertCols.join(', ') + ', created_at, id';

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO api.dentists (${insertCols.join(', ')})
       VALUES (${placeholders})
       RETURNING ${retCols}`,
      ...insertVals
    );

    sendCreated(res, mapDentist(rows[0]), 'Doctor created');
  } catch (e) { next(e); }
});

doctorsRouter.get('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const cols = await getDentistColumns();
    const selectFields = [
      'id', 'clinic_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at',
      ...(cols.has('title') ? ['title'] : []),
      ...(cols.has('qualifications') ? ['qualifications'] : []),
      ...(cols.has('experience_years') ? ['experience_years'] : []),
      ...(cols.has('license_number') ? ['license_number'] : []),
      ...(cols.has('bio') ? ['bio'] : []),
    ].join(', ');

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${selectFields}
       FROM api.dentists
       WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      req.params.id, clinicId
    );
    if (!rows || rows.length === 0) throw new NotFoundError('Doctor');
    sendSuccess(res, mapDentist(rows[0]));
  } catch (e) { next(e); }
});

doctorsRouter.patch('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = doctorSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
    }

    const cols = await getDentistColumns();

    // Check if any requested professional fields cannot be persisted in the current database schema
    const unpersistedRequestedFields: string[] = [];
    if (parsed.data.title !== undefined && parsed.data.title !== null && parsed.data.title !== '' && !cols.has('title')) {
      unpersistedRequestedFields.push('title');
    }
    if (parsed.data.qualifications !== undefined && parsed.data.qualifications !== null && parsed.data.qualifications !== '' && !cols.has('qualifications')) {
      unpersistedRequestedFields.push('qualifications');
    }
    if (parsed.data.experienceYears !== undefined && parsed.data.experienceYears !== null && !cols.has('experience_years')) {
      unpersistedRequestedFields.push('experienceYears');
    }
    if (parsed.data.licenseNumber !== undefined && parsed.data.licenseNumber !== null && parsed.data.licenseNumber !== '' && !cols.has('license_number')) {
      unpersistedRequestedFields.push('licenseNumber');
    }
    if (parsed.data.bio !== undefined && parsed.data.bio !== null && parsed.data.bio !== '' && !cols.has('bio')) {
      unpersistedRequestedFields.push('bio');
    }

    if (unpersistedRequestedFields.length > 0) {
      throw new ValidationError(
        `Professional profile fields (${unpersistedRequestedFields.join(', ')}) cannot be persisted because their columns have not yet been added to the database. Please execute migration 001_add_dentist_profile_fields.sql on the Neon database.`,
        unpersistedRequestedFields.map((field) => ({
          field,
          message: 'Database column not present in api.dentists. Requires pending SQL migration 001_add_dentist_profile_fields.sql.',
        }))
      );
    }

    const setClauses: string[] = [];
    const params: any[] = [req.params.id, clinicId];
    let pIdx = 3;

    if (parsed.data.displayName !== undefined || parsed.data.name !== undefined) {
      setClauses.push(`display_name = $${pIdx++}`);
      params.push(parsed.data.displayName || parsed.data.name);
    }
    if (parsed.data.specialty !== undefined) {
      setClauses.push(`specialty = $${pIdx++}`);
      params.push(parsed.data.specialty);
    }
    if (parsed.data.active !== undefined || parsed.data.isActive !== undefined) {
      setClauses.push(`active = $${pIdx++}`);
      params.push(parsed.data.active ?? parsed.data.isActive);
    }
    if (parsed.data.defaultBufferMinutes !== undefined) {
      setClauses.push(`default_buffer_minutes = $${pIdx++}`);
      params.push(parsed.data.defaultBufferMinutes);
    }
    if (cols.has('title') && parsed.data.title !== undefined) {
      setClauses.push(`title = $${pIdx++}`);
      params.push(parsed.data.title);
    }
    if (cols.has('qualifications') && parsed.data.qualifications !== undefined) {
      setClauses.push(`qualifications = $${pIdx++}`);
      params.push(parsed.data.qualifications);
    }
    if (cols.has('experience_years') && parsed.data.experienceYears !== undefined) {
      setClauses.push(`experience_years = $${pIdx++}`);
      params.push(parsed.data.experienceYears);
    }
    if (cols.has('license_number') && parsed.data.licenseNumber !== undefined) {
      setClauses.push(`license_number = $${pIdx++}`);
      params.push(parsed.data.licenseNumber);
    }
    if (cols.has('bio') && parsed.data.bio !== undefined) {
      setClauses.push(`bio = $${pIdx++}`);
      params.push(parsed.data.bio);
    }

    if (setClauses.length === 0) {
      const current = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM api.dentists WHERE id = $1::uuid AND clinic_id = $2::uuid`,
        req.params.id, clinicId
      );
      if (!current || current.length === 0) throw new NotFoundError('Doctor');
      return sendSuccess(res, mapDentist(current[0]), 'Doctor updated');
    }

    const retCols = [
      'id', 'clinic_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at',
      ...(cols.has('title') ? ['title'] : []),
      ...(cols.has('qualifications') ? ['qualifications'] : []),
      ...(cols.has('experience_years') ? ['experience_years'] : []),
      ...(cols.has('license_number') ? ['license_number'] : []),
      ...(cols.has('bio') ? ['bio'] : []),
    ].join(', ');

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.dentists
       SET ${setClauses.join(', ')}
       WHERE id = $1::uuid AND clinic_id = $2::uuid
       RETURNING ${retCols}`,
      ...params
    );

    if (!rows || rows.length === 0) throw new NotFoundError('Doctor');

    sendSuccess(res, mapDentist(rows[0]), 'Doctor updated');
  } catch (e) { next(e); }
});

doctorsRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const { isActive, active } = req.body;
    const newStatus = Boolean(isActive ?? active);
    const cols = await getDentistColumns();

    const retCols = [
      'id', 'clinic_id', 'display_name', 'specialty', 'active', 'default_buffer_minutes', 'created_at',
      ...(cols.has('title') ? ['title'] : []),
      ...(cols.has('qualifications') ? ['qualifications'] : []),
      ...(cols.has('experience_years') ? ['experience_years'] : []),
      ...(cols.has('license_number') ? ['license_number'] : []),
      ...(cols.has('bio') ? ['bio'] : []),
    ].join(', ');

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.dentists
       SET active = $3
       WHERE id = $1::uuid AND clinic_id = $2::uuid
       RETURNING ${retCols}`,
      req.params.id, clinicId, newStatus
    );

    if (!rows || rows.length === 0) throw new NotFoundError('Doctor');
    sendSuccess(res, mapDentist(rows[0]), newStatus ? 'Doctor activated' : 'Doctor deactivated');
  } catch (e) { next(e); }
});

doctorsRouter.delete('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const doctorId = req.params.id;

    // Check if dentist exists
    const doctor = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, display_name FROM api.dentists WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      doctorId, clinicId
    );
    if (!doctor || doctor.length === 0) throw new NotFoundError('Doctor');

    // Check existing appointments
    const appts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int as count FROM api.appointments WHERE dentist_id = $1::uuid AND clinic_id = $2::uuid`,
      doctorId, clinicId
    );
    const hasAppointments = (appts[0]?.count || 0) > 0;

    if (hasAppointments) {
      // Safe archival / deactivation to preserve medical records & foreign keys
      await prisma.$queryRawUnsafe(
        `UPDATE api.dentists SET active = false WHERE id = $1::uuid AND clinic_id = $2::uuid`,
        doctorId, clinicId
      );
      return sendSuccess(res, {
        id: doctorId,
        deactivated: true,
        active: false,
        message: 'Dentist has historical appointment records and has been deactivated instead of deleted to protect patient history.',
      });
    }

    // No appointments: safe removal of schedule and dentist
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`DELETE FROM api.dentist_schedules WHERE dentist_id = $1::uuid AND clinic_id = $2::uuid`, doctorId, clinicId);
      await tx.$queryRawUnsafe(`DELETE FROM api.schedule_blocks WHERE dentist_id = $1::uuid AND clinic_id = $2::uuid`, doctorId, clinicId);
      await tx.$queryRawUnsafe(`DELETE FROM api.dentists WHERE id = $1::uuid AND clinic_id = $2::uuid`, doctorId, clinicId);
    });

    sendSuccess(res, { id: doctorId, deleted: true, message: 'Doctor deleted successfully' });
  } catch (e) { next(e); }
});
