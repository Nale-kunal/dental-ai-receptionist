import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.get('/summary', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);

    const [
      statusCounts,
      todayResult,
      upcomingResult,
      convResult,
      handoffPendingResult,
      totalHandoffResult,
      patientResult,
      clinicResult,
    ] = await Promise.all([
      // 1. Group by status for total and status breakdown
      prisma.$queryRawUnsafe<Array<{ status: string; count: number }>>(
        `SELECT status, COUNT(*)::int as count
         FROM api.appointments
         WHERE clinic_id = $1::uuid
         GROUP BY status`,
        clinicId
      ).catch(() => []),

      // 2. Appointments scheduled for today
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM api.appointments
         WHERE clinic_id = $1::uuid
           AND starts_at >= CURRENT_DATE
           AND starts_at < CURRENT_DATE + INTERVAL '1 day'`,
        clinicId
      ).catch(() => [{ count: 0 }]),

      // 3. Upcoming appointments (from now forward that are confirmed or pending)
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM api.appointments
         WHERE clinic_id = $1::uuid
           AND starts_at >= NOW()
           AND status IN ('confirmed', 'pending')`,
        clinicId
      ).catch(() => [{ count: 0 }]),

      // 4. Total patient conversations handled
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM api.conversations
         WHERE clinic_id = $1::uuid`,
        clinicId
      ).catch(() => [{ count: 0 }]),

      // 5. Active conversations currently requiring staff attention (pending handoff)
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM api.handoffs h
         JOIN api.conversations c ON c.id = h.conversation_id AND c.clinic_id = h.clinic_id AND c.closed_at IS NULL
         WHERE h.clinic_id = $1::uuid AND h.status = 'pending'`,
        clinicId
      ).catch(() => [{ count: 0 }]),

      // 6. Total historical handoffs
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM api.handoffs
         WHERE clinic_id = $1::uuid`,
        clinicId
      ).catch(() => [{ count: 0 }]),

      // 7. Total registered patients
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as count
         FROM api.patients
         WHERE clinic_id = $1::uuid`,
        clinicId
      ).catch(() => [{ count: 0 }]),

      // 8. Clinic receptionist configuration status
      prisma.$queryRawUnsafe<any[]>(
        `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
        clinicId
      ).catch(() => []),
    ]);

    // Parse counts by status
    let totalAppointments = 0;
    let confirmedCount = 0;
    let pendingCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let rescheduledCount = 0;
    let noShowCount = 0;

    for (const row of statusCounts) {
      const c = Number(row.count) || 0;
      totalAppointments += c;
      if (row.status === 'confirmed') confirmedCount = c;
      else if (row.status === 'pending') pendingCount = c;
      else if (row.status === 'completed') completedCount = c;
      else if (row.status === 'cancelled') cancelledCount = c;
      else if (row.status === 'rescheduled') rescheduledCount = c;
      else if (row.status === 'no_show') noShowCount = c;
    }

    const todayAppointments = Number(todayResult[0]?.count) || 0;
    const upcomingAppointments = Number(upcomingResult[0]?.count) || 0;
    const totalConversations = Number(convResult[0]?.count) || 0;
    const pendingStaffAttention = Number(handoffPendingResult[0]?.count) || 0;
    const totalHistoricalHandoffs = Number(totalHandoffResult[0]?.count) || 0;
    const totalPatients = Number(patientResult[0]?.count) || 0;

    const clinicSettings = clinicResult[0]?.settings ?? {};
    const isReceptionistWorking = clinicSettings.receptionist_enabled !== false;

    // AI Containment Calculation
    const resolvedByAi = Math.max(0, totalConversations - totalHistoricalHandoffs);
    const containmentPercentage = totalConversations > 0
      ? Math.round((resolvedByAi / totalConversations) * 100)
      : 100;

    const summaryPayload = {
      // Direct operational clinic metrics
      todayAppointments,
      upcomingAppointments,
      totalAppointments,
      confirmedCount,
      pendingCount,
      completedCount,
      cancelledCount,
      rescheduledCount,
      noShowCount,
      totalConversations,
      pendingStaffAttention,
      totalPatients,
      containmentRate: `${containmentPercentage}%`,
      receptionistStatus: isReceptionistWorking ? 'working' : 'paused',
      // Nested kpis object for backward compatibility
      kpis: {
        todayAppointments,
        upcomingAppointments,
        totalAppointments,
        confirmedCount,
        pendingCount,
        completedCount,
        cancelledCount,
        rescheduledCount,
        noShowCount,
        totalConversations,
        totalHandoffs: pendingStaffAttention,
        totalPatients,
        aiContainmentRate: `${containmentPercentage}%`,
        receptionistStatus: isReceptionistWorking ? 'working' : 'paused',
      },
    };

    sendSuccess(res, summaryPayload);
  } catch (err) { next(err); }
});

reportsRouter.get('/appointments-by-status', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT status, COUNT(*)::int as count FROM api.appointments WHERE clinic_id = $1::uuid GROUP BY status`,
      clinicId
    ).catch(() => []);

    const counts: Record<string, number> = {
      pending: 0, confirmed: 0, cancelled: 0, completed: 0, no_show: 0, rescheduled: 0,
    };
    for (const r of rows) {
      if (counts[r.status] !== undefined) counts[r.status] = r.count;
    }
    sendSuccess(res, counts);
  } catch (err) { next(err); }
});

reportsRouter.get('/peak-hours', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT EXTRACT(HOUR FROM starts_at)::int as hour, COUNT(*)::int as count
       FROM api.appointments WHERE clinic_id = $1::uuid GROUP BY hour ORDER BY hour ASC`,
      clinicId
    ).catch(() => []);

    const hourMap: Record<number, number> = {};
    for (let h = 8; h <= 18; h++) hourMap[h] = 0;
    for (const r of rows) {
      if (r.hour >= 8 && r.hour <= 18) hourMap[r.hour] = r.count;
    }

    const result = Object.entries(hourMap).map(([hour, count]) => ({
      hour: parseInt(hour, 10),
      label: `${hour}:00`,
      count,
    }));
    sendSuccess(res, result);
  } catch (err) { next(err); }
});
