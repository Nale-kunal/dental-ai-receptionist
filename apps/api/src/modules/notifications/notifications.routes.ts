import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { DEFAULT_PAGE_SIZE } from '@dental/shared';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? 1)));
    const pageSize = Math.min(100, parseInt(String(req.query.pageSize ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string | undefined;

    const conditions: string[] = ['clinic_id = $1::uuid'];
    const params: unknown[] = [clinicId];
    let idx = 2;

    if (status) {
      conditions.push(`status = $${idx++}::api.delivery_status`);
      params.push(status);
    }

    const where = conditions.join(' AND ');

    const countRes = await prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text as count FROM api.notifications WHERE ${where}`,
      ...params
    );
    const total = parseInt(countRes[0]?.count ?? '0', 10);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, patient_id, appointment_id, kind, channel,
              recipient, template, status, attempts, next_attempt_at, sent_at,
              delivered_at, failed_at, created_at
       FROM api.notifications
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      ...params,
      pageSize,
      offset
    );

    sendSuccess(res, {
      items: rows.map((n) => ({
        id: n.id,
        clinicId: n.clinic_id,
        patientId: n.patient_id,
        appointmentId: n.appointment_id,
        kind: n.kind,
        type: n.kind,
        channel: n.channel,
        recipient: n.recipient,
        template: n.template,
        status: n.status,
        attempts: n.attempts,
        sentAt: n.sent_at ? new Date(n.sent_at).toISOString() : null,
        deliveredAt: n.delivered_at ? new Date(n.delivered_at).toISOString() : null,
        failedAt: n.failed_at ? new Date(n.failed_at).toISOString() : null,
        createdAt: new Date(n.created_at).toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e) { next(e); }
});
