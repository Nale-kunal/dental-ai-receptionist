import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';

export const auditRouter = Router();
auditRouter.use(authenticate);

let cachedAuditTables: boolean | null = null;
async function hasPatientAuditEventsTable(): Promise<boolean> {
  if (cachedAuditTables !== null) return cachedAuditTables;
  try {
    const res = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'api' AND table_name = 'patient_audit_events'`
    );
    cachedAuditTables = res.length > 0;
  } catch {
    cachedAuditTables = false;
  }
  return cachedAuditTables;
}

auditRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const includePatientAudit = await hasPatientAuditEventsTable();

    let historyRows: any[] = [];
    let total = 0;

    if (includePatientAudit) {
      historyRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM (
           SELECT h.id::text as id,
                  'appointment_status_change' as type,
                  'Status changed from ' || COALESCE(h.from_status::text, 'initial') || ' to ' || h.to_status::text as action,
                  COALESCE(h.changed_by, 'system') as "changedBy",
                  h.reason,
                  h.created_at,
                  'appointment' as "entityType",
                  h.appointment_id as "entityId",
                  a.confirmation_code as "confirmationCode",
                  p.full_name as "patientName"
           FROM api.appointment_status_history h
           JOIN api.appointments a ON a.id = h.appointment_id
           LEFT JOIN api.patients p ON p.id = a.patient_id
           WHERE h.clinic_id = $1::uuid

           UNION ALL

           SELECT pa.id::text as id,
                  'patient_lifecycle' as type,
                  CASE WHEN pa.action = 'PATIENT_ARCHIVED' THEN 'Patient archived' ELSE 'Patient restored' END as action,
                  COALESCE(pa.user_email, 'clinic_staff') as "changedBy",
                  pa.reason,
                  pa.created_at,
                  'patient' as "entityType",
                  pa.patient_id as "entityId",
                  NULL as "confirmationCode",
                  p.full_name as "patientName"
           FROM api.patient_audit_events pa
           JOIN api.patients p ON p.id = pa.patient_id
           WHERE pa.clinic_id = $1::uuid
         ) combined
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        clinicId,
        limit,
        offset
      );

      const countAppts = await prisma.$queryRawUnsafe<[{ count: string }]>(
        `SELECT COUNT(*)::text as count FROM api.appointment_status_history WHERE clinic_id = $1::uuid`,
        clinicId
      );
      const countPatients = await prisma.$queryRawUnsafe<[{ count: string }]>(
        `SELECT COUNT(*)::text as count FROM api.patient_audit_events WHERE clinic_id = $1::uuid`,
        clinicId
      );
      total = parseInt(countAppts[0]?.count ?? '0', 10) + parseInt(countPatients[0]?.count ?? '0', 10);
    } else {
      historyRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT h.id, h.clinic_id, h.appointment_id as "entityId", h.from_status, h.to_status,
                h.changed_by as "changedBy", h.reason, h.created_at,
                'appointment_status_change' as type, 'appointment' as "entityType",
                'Status changed from ' || COALESCE(h.from_status::text, 'initial') || ' to ' || h.to_status::text as action,
                a.confirmation_code as "confirmationCode", p.full_name as "patientName"
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
      total = parseInt(countRes[0]?.count ?? '0', 10);
    }

    const items = historyRows.map((r) => ({
      id: r.id.toString(),
      type: r.type,
      action: r.action,
      changedBy: r.changedBy || 'system',
      user: { name: r.changedBy, email: r.changedBy },
      details: r.entityType === 'patient'
        ? `${r.action} (${r.patientName || 'Patient'}). ${r.reason ? `Reason: ${r.reason}` : ''}`
        : `Appointment ${r.confirmationCode} (${r.patientName || 'Patient'}) changed to ${r.to_status || 'updated'}. ${r.reason ? `Reason: ${r.reason}` : ''}`,
      entityType: r.entityType,
      entityId: r.entityId,
      appointmentId: r.entityType === 'appointment' ? r.entityId : undefined,
      confirmationCode: r.confirmationCode,
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
