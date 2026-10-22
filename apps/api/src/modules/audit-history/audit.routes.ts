import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';

export const auditRouter = Router();
auditRouter.use(authenticate);

auditRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const historyRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.clinic_id, h.appointment_id, h.from_status, h.to_status,
              h.changed_by, h.reason, h.created_at,
              a.confirmation_code, p.full_name as "patientName"
       FROM api.appointment_status_history h
       JOIN api.appointments a ON a.id = h.appointment_id
       LEFT JOIN api.patients p ON p.id = a.patient_id
       WHERE h.clinic_id = $1::uuid
       ORDER BY h.created_at DESC
       LIMIT $2 OFFSET $3`,
      clinicId,
      limit,
      offset
    );

    const countRes = await prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text as count FROM api.appointment_status_history WHERE clinic_id = $1::uuid`,
      clinicId
    );
    const total = parseInt(countRes[0]?.count ?? '0', 10);

    const items = historyRows.map((r) => ({
      id: r.id.toString(),
      type: 'appointment_status_change',
      action: `Status changed from ${r.from_status || 'initial'} to ${r.to_status}`,
      changedBy: r.changed_by || 'system',
      user: { name: r.changed_by, email: r.changed_by },
      details: `Appointment ${r.confirmation_code} (${r.patientName || 'Patient'}) changed to ${r.to_status}. ${r.reason ? `Reason: ${r.reason}` : ''}`,
      entityType: 'appointment',
      entityId: r.appointment_id,
      appointmentId: r.appointment_id,
      confirmationCode: r.confirmation_code,
      patientName: r.patientName,
      previousStatus: r.from_status,
      newStatus: r.to_status,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      reason: r.reason,
      changedAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      timestamp: new Date(r.created_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    }));

    sendSuccess(res, {
      items,
      total,
      limit,
      offset,
    });
  } catch (err) { next(err); }
});
