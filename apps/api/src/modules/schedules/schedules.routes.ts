import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/errors/errorHandler';
import { getPublicHolidays } from './holiday.data';

export const schedulesRouter = Router();
schedulesRouter.use(authenticate);

/**
 * GET /api/v1/schedules/clinic
 * Clinic working hours by day of week (0 = Sunday ... 6 = Saturday)
 */
schedulesRouter.get('/clinic', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const hours = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, day_of_week as "dayOfWeek",
              opens_at::text as "opensAt", closes_at::text as "closesAt"
       FROM api.business_hours
       WHERE clinic_id = $1::uuid
       ORDER BY day_of_week ASC`,
      clinicId
    );
    sendSuccess(res, hours);
  } catch (err) { next(err); }
});

const updateHoursSchema = z.object({
  hours: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      isOpen: z.boolean(),
      opensAt: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Invalid opening time'),
      closesAt: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Invalid closing time'),
    })
  ).min(1, 'At least one day schedule required'),
});

/**
 * PUT /api/v1/schedules/clinic
 * Updates clinic business hours in Neon PostgreSQL
 */
schedulesRouter.put('/clinic', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = updateHoursSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid business hours payload',
        },
      });
    }

    const { hours } = parsed.data;

    // Validate that open days have opensAt < closesAt
    for (const h of hours) {
      if (h.isOpen && h.opensAt >= h.closesAt) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Closing time must be later than opening time for day ${h.dayOfWeek}`,
          },
        });
      }
    }

    // Persist to api.business_hours
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`DELETE FROM api.business_hours WHERE clinic_id = $1::uuid`, clinicId);
      for (const h of hours) {
        if (h.isOpen) {
          const openTime = h.opensAt.length === 5 ? `${h.opensAt}:00` : h.opensAt;
          const closeTime = h.closesAt.length === 5 ? `${h.closesAt}:00` : h.closesAt;
          await tx.$queryRawUnsafe(
            `INSERT INTO api.business_hours (clinic_id, day_of_week, opens_at, closes_at)
             VALUES ($1::uuid, $2, $3::time, $4::time)`,
            clinicId,
            h.dayOfWeek,
            openTime,
            closeTime
          );
        }
      }
    });

    const updatedHours = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, day_of_week as "dayOfWeek",
              opens_at::text as "opensAt", closes_at::text as "closesAt"
       FROM api.business_hours
       WHERE clinic_id = $1::uuid
       ORDER BY day_of_week ASC`,
      clinicId
    );

    sendSuccess(res, updatedHours, 'Clinic business hours saved successfully');
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/schedules/doctors/:id
 */
schedulesRouter.get('/doctors/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const doctorId = req.params.id;

    const schedules = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, dentist_id as "dentistId", day_of_week as "dayOfWeek",
              starts_at::text as "startsAt", ends_at::text as "endsAt"
       FROM api.dentist_schedules
       WHERE dentist_id = $1::uuid AND clinic_id = $2::uuid
       ORDER BY day_of_week ASC`,
      doctorId,
      clinicId
    );
    sendSuccess(res, schedules);
  } catch (err) { next(err); }
});

const updateDoctorScheduleSchema = z.object({
  schedules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      isWorking: z.boolean(),
      startsAt: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Invalid start time'),
      endsAt: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Invalid end time'),
    })
  ).min(1, 'At least one day schedule required'),
});

/**
 * PUT /api/v1/schedules/doctors/:id
 * Sets individual working hours for a dentist
 */
schedulesRouter.put('/doctors/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const doctorId = req.params.id;

    // Verify doctor belongs to clinic
    const doc = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, display_name FROM api.dentists WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      doctorId, clinicId
    );
    if (!doc || doc.length === 0) throw new NotFoundError('Doctor');

    const parsed = updateDoctorScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid dentist schedule payload',
        },
      });
    }

    const { schedules } = parsed.data;

    // Validate times for working days
    for (const s of schedules) {
      if (s.isWorking && s.startsAt >= s.endsAt) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Shift end time must be later than start time for day ${s.dayOfWeek}`,
          },
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `DELETE FROM api.dentist_schedules WHERE dentist_id = $1::uuid AND clinic_id = $2::uuid`,
        doctorId, clinicId
      );
      for (const s of schedules) {
        if (s.isWorking) {
          const startTime = s.startsAt.length === 5 ? `${s.startsAt}:00` : s.startsAt;
          const endTime = s.endsAt.length === 5 ? `${s.endsAt}:00` : s.endsAt;
          await tx.$queryRawUnsafe(
            `INSERT INTO api.dentist_schedules (clinic_id, dentist_id, day_of_week, starts_at, ends_at)
             VALUES ($1::uuid, $2::uuid, $3, $4::time, $5::time)`,
            clinicId, doctorId, s.dayOfWeek, startTime, endTime
          );
        }
      }
    });

    const updated = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, dentist_id as "dentistId", day_of_week as "dayOfWeek",
              starts_at::text as "startsAt", ends_at::text as "endsAt"
       FROM api.dentist_schedules
       WHERE dentist_id = $1::uuid AND clinic_id = $2::uuid
       ORDER BY day_of_week ASC`,
      doctorId, clinicId
    );

    sendSuccess(res, updated, 'Dentist working schedule saved successfully');
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/schedules/blocks
 */
schedulesRouter.get('/blocks', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const dentistId = req.query.dentistId as string | undefined;

    const blocks = await prisma.$queryRawUnsafe<any[]>(
      `SELECT sb.id, sb.clinic_id, sb.dentist_id as "dentistId", sb.kind,
              sb.starts_at as "startsAt", sb.ends_at as "endsAt", sb.reason,
              d.display_name as "dentistName"
       FROM api.schedule_blocks sb
       LEFT JOIN api.dentists d ON d.id = sb.dentist_id
       WHERE sb.clinic_id = $1::uuid
         AND ($2::uuid IS NULL OR sb.dentist_id = $2::uuid)
       ORDER BY sb.starts_at ASC`,
      clinicId,
      dentistId || null
    );
    sendSuccess(res, blocks);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/schedules/blocks/check-conflicts
 */
schedulesRouter.post('/blocks/check-conflicts', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const { startsAt, endsAt, dentistId } = req.body;

    if (!startsAt || !endsAt) {
      return res.status(400).json({ ok: false, error: { message: 'startsAt and endsAt required' } });
    }

    const conflicts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, a.confirmation_code as "confirmationCode", a.starts_at as "startsAt", a.ends_at as "endsAt",
              a.status, p.full_name as "patientName", p.phone as "patientPhone", d.display_name as "dentistName"
       FROM api.appointments a
       LEFT JOIN api.patients p ON p.id = a.patient_id
       LEFT JOIN api.dentists d ON d.id = a.dentist_id
       WHERE a.clinic_id = $1::uuid
         AND a.status IN ('confirmed', 'pending')
         AND ($2::uuid IS NULL OR a.dentist_id = $2::uuid)
         AND tstzrange(a.starts_at, a.ends_at) && tstzrange($3::timestamptz, $4::timestamptz)
       ORDER BY a.starts_at ASC`,
      clinicId,
      dentistId || null,
      startsAt,
      endsAt
    );

    sendSuccess(res, {
      hasConflicts: conflicts.length > 0,
      conflictCount: conflicts.length,
      conflicts,
    });
  } catch (err) { next(err); }
});

const blockSchema = z.object({
  kind: z.enum(['holiday', 'closure', 'break', 'leave', 'maintenance']),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().trim().min(1, 'Reason or closure name required').max(500),
  dentistId: z.string().uuid().nullable().optional(),
  ignoreConflicts: z.boolean().optional(),
});

/**
 * POST /api/v1/schedules/blocks
 * Adds a holiday or closure block
 */
schedulesRouter.post('/blocks', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid block data',
        },
      });
    }

    const { kind, startsAt, endsAt, reason, dentistId, ignoreConflicts } = parsed.data;

    if (new Date(startsAt) >= new Date(endsAt)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'End time must be after start time',
        },
      });
    }

    // Check conflicts with existing appointments
    if (!ignoreConflicts) {
      const conflicts = await prisma.$queryRawUnsafe<any[]>(
        `SELECT a.id, a.confirmation_code as "confirmationCode", a.starts_at as "startsAt",
                p.full_name as "patientName", d.display_name as "dentistName"
         FROM api.appointments a
         LEFT JOIN api.patients p ON p.id = a.patient_id
         LEFT JOIN api.dentists d ON d.id = a.dentist_id
         WHERE a.clinic_id = $1::uuid
           AND a.status IN ('confirmed', 'pending')
           AND ($2::uuid IS NULL OR a.dentist_id = $2::uuid)
           AND tstzrange(a.starts_at, a.ends_at) && tstzrange($3::timestamptz, $4::timestamptz)`,
        clinicId,
        dentistId || null,
        startsAt,
        endsAt
      );

      if (conflicts.length > 0) {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'APPOINTMENT_CONFLICT',
            message: `This closure conflicts with ${conflicts.length} confirmed/pending appointment(s). Please confirm whether to proceed.`,
            conflicts,
          },
        });
      }
    }

    const inserted = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO api.schedule_blocks (clinic_id, dentist_id, kind, starts_at, ends_at, reason)
       VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, $5::timestamptz, $6)
       RETURNING id, clinic_id, dentist_id as "dentistId", kind,
                 starts_at as "startsAt", ends_at as "endsAt", reason`,
      clinicId,
      dentistId || null,
      kind,
      startsAt,
      endsAt,
      reason
    );

    sendSuccess(res, inserted[0], 'Closure / Holiday created successfully');
  } catch (err) { next(err); }
});

/**
 * PUT /api/v1/schedules/blocks/:id
 */
schedulesRouter.put('/blocks/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const blockId = req.params.id;

    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid block data',
        },
      });
    }

    const { kind, startsAt, endsAt, reason, dentistId } = parsed.data;

    if (new Date(startsAt) >= new Date(endsAt)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'End time must be after start time',
        },
      });
    }

    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.schedule_blocks
       SET kind = $3, starts_at = $4::timestamptz, ends_at = $5::timestamptz, reason = $6, dentist_id = $7::uuid
       WHERE id = $1::uuid AND clinic_id = $2::uuid
       RETURNING id, clinic_id, dentist_id as "dentistId", kind,
                 starts_at as "startsAt", ends_at as "endsAt", reason`,
      blockId,
      clinicId,
      kind,
      startsAt,
      endsAt,
      reason,
      dentistId || null
    );

    if (!updated || updated.length === 0) {
      throw new NotFoundError('Schedule block');
    }

    sendSuccess(res, updated[0], 'Closure / Holiday updated successfully');
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/schedules/blocks/:id
 */
schedulesRouter.delete('/blocks/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const blockId = req.params.id;

    const deleted = await prisma.$queryRawUnsafe<any[]>(
      `DELETE FROM api.schedule_blocks
       WHERE id = $1::uuid AND clinic_id = $2::uuid
       RETURNING id`,
      blockId,
      clinicId
    );

    if (!deleted || deleted.length === 0) {
      throw new NotFoundError('Schedule block');
    }

    sendSuccess(res, { id: blockId }, 'Closure / Holiday removed successfully');
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/schedules/holidays
 * Returns location-aware public holidays for the clinic's configured jurisdiction,
 * merged with clinic-specific working-day/closure overrides and schedule blocks.
 */
schedulesRouter.get('/holidays', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const targetYear = parseInt(req.query.year as string, 10) || new Date().getFullYear();

    // 1. Get clinic's country and timezone
    const clinicRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT timezone, settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const settings = (clinicRows[0]?.settings as any) || {};
    const countryCode = (settings.country || 'US').toUpperCase();

    // 2. Compute authoritative public holidays for this country and year
    const baseHolidays = getPublicHolidays(countryCode, targetYear);

    // 3. Fetch clinic's explicit overrides
    const overrides = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, holiday_date::text as "holidayDate", holiday_name as "holidayName",
              country_code as "countryCode", action,
              custom_opens_at::text as "customOpensAt", custom_closes_at::text as "customClosesAt",
              notes
       FROM api.clinic_holiday_overrides
       WHERE clinic_id = $1::uuid AND EXTRACT(YEAR FROM holiday_date) = $2`,
      clinicId,
      targetYear
    );
    const overrideMap = new Map<string, any>();
    for (const ov of overrides) {
      overrideMap.set(ov.holidayDate, ov);
    }

    // 4. Fetch schedule_blocks for closures
    const blocks = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, kind, starts_at as "startsAt", ends_at as "endsAt", reason, dentist_id as "dentistId"
       FROM api.schedule_blocks
       WHERE clinic_id = $1::uuid
         AND kind IN ('holiday', 'closure')
         AND EXTRACT(YEAR FROM starts_at) = $2`,
      clinicId,
      targetYear
    );
    const blockMap = new Map<string, any>();
    for (const b of blocks) {
      const dateKey = new Date(b.startsAt).toISOString().split('T')[0];
      blockMap.set(dateKey, b);
    }

    // 5. Merge base holidays with overrides & blocks
    const results: any[] = [];
    const processedDates = new Set<string>();

    for (const bh of baseHolidays) {
      processedDates.add(bh.date);
      const ov = overrideMap.get(bh.date);
      const blk = blockMap.get(bh.date);

      if (ov) {
        results.push({
          date: bh.date,
          name: ov.holidayName || bh.name,
          countryCode: ov.countryCode || countryCode,
          isPublicHoliday: true,
          status: ov.action, // 'closed' | 'working_day' | 'modified_hours'
          opensAt: ov.customOpensAt ? ov.customOpensAt.slice(0, 5) : undefined,
          closesAt: ov.customClosesAt ? ov.customClosesAt.slice(0, 5) : undefined,
          notes: ov.notes,
          overrideId: ov.id,
          scheduleBlockId: blk?.id,
        });
      } else {
        // Default treatment: recognized public holiday is closed
        results.push({
          date: bh.date,
          name: bh.name,
          countryCode,
          isPublicHoliday: true,
          status: 'closed',
          scheduleBlockId: blk?.id,
        });
      }
    }

    // Include custom clinic closures that are not standard public holidays
    for (const b of blocks) {
      const dateKey = new Date(b.startsAt).toISOString().split('T')[0];
      if (!processedDates.has(dateKey) && !b.dentistId) {
        processedDates.add(dateKey);
        results.push({
          date: dateKey,
          name: b.reason || 'Clinic Closure',
          countryCode,
          isPublicHoliday: false,
          status: 'custom_closure',
          scheduleBlockId: b.id,
        });
      }
    }

    results.sort((a, b) => a.date.localeCompare(b.date));
    sendSuccess(res, {
      countryCode,
      year: targetYear,
      holidays: results,
    });
  } catch (err) { next(err); }
});

const overrideSchema = z.object({
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format YYYY-MM-DD required'),
  holidayName: z.string().min(1).max(200),
  action: z.enum(['closed', 'working_day', 'modified_hours']),
  customOpensAt: z.string().optional(),
  customClosesAt: z.string().optional(),
  notes: z.string().max(500).optional(),
});

/**
 * PUT /api/v1/schedules/holidays/override
 * Sets a clinic-specific override for a public holiday (e.g. marking it as a working day
 * or setting modified hours). Overrides do NOT affect other tenant clinics.
 */
schedulesRouter.put('/holidays/override', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid holiday override payload',
        },
      });
    }

    const { holidayDate, holidayName, action, customOpensAt, customClosesAt, notes } = parsed.data;

    // Fetch clinic timezone & country
    const clinicRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT timezone, settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const tz = clinicRows[0]?.timezone || 'America/New_York';
    const countryCode = ((clinicRows[0]?.settings as any)?.country || 'US').toUpperCase();

    const openTime = customOpensAt ? (customOpensAt.length === 5 ? `${customOpensAt}:00` : customOpensAt) : null;
    const closeTime = customClosesAt ? (customClosesAt.length === 5 ? `${customClosesAt}:00` : customClosesAt) : null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Upsert into api.clinic_holiday_overrides
      const ovRows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO api.clinic_holiday_overrides (clinic_id, holiday_date, holiday_name, country_code, action, custom_opens_at, custom_closes_at, notes, updated_at)
         VALUES ($1::uuid, $2::date, $3, $4, $5, $6::time, $7::time, $8, NOW())
         ON CONFLICT (clinic_id, holiday_date)
         DO UPDATE SET
           action = EXCLUDED.action,
           custom_opens_at = EXCLUDED.custom_opens_at,
           custom_closes_at = EXCLUDED.custom_closes_at,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING id, clinic_id, holiday_date::text as "holidayDate", holiday_name as "holidayName", action`,
        clinicId,
        holidayDate,
        holidayName,
        countryCode,
        action,
        openTime,
        closeTime,
        notes || null
      );

      // 2. Synchronize schedule_blocks according to precedence:
      if (action === 'working_day') {
        // Clinic explicitly chooses to work on this national holiday:
        // Remove whole-clinic closure block for this date so regular business hours are bookable
        await tx.$queryRawUnsafe(
          `DELETE FROM api.schedule_blocks
           WHERE clinic_id = $1::uuid
             AND dentist_id IS NULL
             AND kind = 'holiday'
             AND (starts_at::date = $2::date OR (starts_at AT TIME ZONE $3)::date = $2::date)`,
          clinicId,
          holidayDate,
          tz
        );
      } else if (action === 'closed') {
        // Ensure whole-clinic closure block exists
        const existingBlocks = await tx.$queryRawUnsafe<any[]>(
          `SELECT id FROM api.schedule_blocks
           WHERE clinic_id = $1::uuid
             AND dentist_id IS NULL
             AND (starts_at::date = $2::date OR (starts_at AT TIME ZONE $3)::date = $2::date)`,
          clinicId,
          holidayDate,
          tz
        );
        if (existingBlocks.length === 0) {
          const startsAt = `${holidayDate}T00:00:00.000Z`;
          const endsAt = `${holidayDate}T23:59:59.999Z`;
          await tx.$queryRawUnsafe(
            `INSERT INTO api.schedule_blocks (clinic_id, dentist_id, kind, starts_at, ends_at, reason)
             VALUES ($1::uuid, NULL, 'holiday', ($2::text)::timestamp AT TIME ZONE $4, ($3::text)::timestamp AT TIME ZONE $4, $5)`,
            clinicId,
            `${holidayDate} 00:00:00`,
            `${holidayDate} 23:59:59`,
            tz,
            holidayName
          );
        }
      }

      return ovRows[0];
    });

    sendSuccess(res, result, `Holiday policy updated: ${holidayName} marked as ${action.replace('_', ' ')}.`);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/schedules/holidays/override/:id
 */
schedulesRouter.delete('/holidays/override/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const overrideId = req.params.id;

    await prisma.$queryRawUnsafe(
      `DELETE FROM api.clinic_holiday_overrides WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      overrideId,
      clinicId
    );

    sendSuccess(res, { id: overrideId }, 'Holiday override removed; standard calendar rule restored.');
  } catch (err) { next(err); }
});


