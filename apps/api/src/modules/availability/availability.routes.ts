import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';

export const availabilityRouter = Router();
availabilityRouter.use(authenticate);

/**
 * GET /api/v1/availability/slots
 * Calls api.search_availability stored procedure for real slot calculation
 */
availabilityRouter.get('/slots', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
    let doctorId = req.query.doctorId as string | undefined;
    let serviceId = req.query.serviceId as string | undefined;

    // If doctor or service not provided, pick first active
    if (!doctorId) {
      const docRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM api.dentists WHERE clinic_id = $1::uuid AND active LIMIT 1`,
        clinicId
      );
      doctorId = docRows[0]?.id;
    }

    if (!serviceId) {
      const srvRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM api.services WHERE clinic_id = $1::uuid AND active LIMIT 1`,
        clinicId
      );
      serviceId = srvRows[0]?.id;
    }

    if (!doctorId || !serviceId) {
      return sendSuccess(res, { date: dateStr, slots: [] });
    }

    // Fetch clinic timezone
    const clinicRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT timezone FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const clinicTimezone = clinicRows[0]?.timezone || 'America/New_York';

    // Call stored procedure api.search_availability
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT api.search_availability($1::uuid, $2::uuid, $3::uuid, $4::date, 20) as res`,
      clinicId,
      doctorId,
      serviceId,
      dateStr
    );

    const envelope = result[0]?.res;
    if (envelope && envelope.ok && Array.isArray(envelope.data)) {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: clinicTimezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const slots = envelope.data.map((s: any) => {
        const d = new Date(s.starts_at);
        const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
        let h = parts.hour;
        if (h === '24') h = '00';
        const time = `${h}:${parts.minute}`;

        return {
          time,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          durationMinutes: s.duration_minutes,
          available: true,
          datetime: s.starts_at,
        };
      });

      return sendSuccess(res, {
        date: dateStr,
        doctorId,
        serviceId,
        timezone: clinicTimezone,
        slots,
      });
    }

    sendSuccess(res, { date: dateStr, doctorId, serviceId, timezone: clinicTimezone, slots: [] });
  } catch (err) { next(err); }
});
