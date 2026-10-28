import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { NotFoundError, ConflictError } from '../../middleware/errors/errorHandler';
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE } from '@dental/shared';

export const handoffsRouter = Router();
handoffsRouter.use(authenticate);

handoffsRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? 1)));
    const pageSize = Math.min(100, parseInt(String(req.query.pageSize ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string | undefined;

    const conditions: string[] = ['h.clinic_id = $1::uuid'];
    const params: unknown[] = [clinicId];
    let idx = 2;

    if (status) {
      conditions.push(`h.status = $${idx++}::api.handoff_status`);
      params.push(status);
    }

    // Pending handoffs require an existing, non-closed conversation to be actionable
    if (status === 'pending') {
      conditions.push(`h.conversation_id IS NOT NULL`);
      conditions.push(`EXISTS (
        SELECT 1 FROM api.conversations c
        WHERE c.id = h.conversation_id
          AND c.clinic_id = h.clinic_id
          AND c.closed_at IS NULL
      )`);
    } else if (!status) {
      conditions.push(`(h.status != 'pending' OR (h.conversation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM api.conversations c
        WHERE c.id = h.conversation_id
          AND c.clinic_id = h.clinic_id
          AND c.closed_at IS NULL
      )))`);
    }

    const where = conditions.join(' AND ');

    const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text as count FROM api.handoffs h WHERE ${where}`,
      ...params
    );
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.clinic_id, h.conversation_id, h.patient_id, h.channel,
              h.status, h.priority, h.reason, h.context, h.assigned_to,
              h.accepted_at, h.resolved_at, h.resolution, h.created_at, h.updated_at,
              p.full_name as "patientName", p.phone as "patientPhone", p.email as "patientEmail"
       FROM api.handoffs h
       LEFT JOIN api.patients p ON p.id = h.patient_id
       WHERE ${where}
       ORDER BY CASE h.status WHEN 'pending' THEN 1 WHEN 'accepted' THEN 2 ELSE 3 END,
                h.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      ...params,
      pageSize,
      offset
    );

    sendSuccess(res, {
      items: rows.map((h) => ({
        id: h.id,
        clinicId: h.clinic_id,
        conversationId: h.conversation_id,
        patientId: h.patient_id,
        channel: h.channel,
        status: h.status,
        priority: h.priority,
        reason: h.reason,
        context: h.context,
        assignedTo: h.assigned_to,
        acceptedAt: h.accepted_at ? new Date(h.accepted_at).toISOString() : null,
        resolvedAt: h.resolved_at ? new Date(h.resolved_at).toISOString() : null,
        resolution: h.resolution,
        createdAt: new Date(h.created_at).toISOString(),
        updatedAt: new Date(h.updated_at).toISOString(),
        patient: h.patient_id ? {
          id: h.patient_id,
          name: h.patientName,
          phone: h.patientPhone,
          email: h.patientEmail,
        } : null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e) { next(e); }
});

handoffsRouter.get('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.clinic_id, h.conversation_id, h.patient_id, h.channel,
              h.status, h.priority, h.reason, h.context, h.assigned_to,
              h.accepted_at, h.resolved_at, h.resolution, h.created_at, h.updated_at,
              p.full_name as "patientName", p.phone as "patientPhone", p.email as "patientEmail"
       FROM api.handoffs h
       LEFT JOIN api.patients p ON p.id = h.patient_id
       WHERE h.id = $1::uuid AND h.clinic_id = $2::uuid`,
      req.params.id,
      clinicId
    );

    if (!rows || rows.length === 0) throw new NotFoundError('Handoff');
    const h = rows[0];

    sendSuccess(res, {
      id: h.id,
      clinicId: h.clinic_id,
      conversationId: h.conversation_id,
      patientId: h.patient_id,
      channel: h.channel,
      status: h.status,
      priority: h.priority,
      reason: h.reason,
      context: h.context,
      assignedTo: h.assigned_to,
      acceptedAt: h.accepted_at ? new Date(h.accepted_at).toISOString() : null,
      resolvedAt: h.resolved_at ? new Date(h.resolved_at).toISOString() : null,
      resolution: h.resolution,
      createdAt: new Date(h.created_at).toISOString(),
      updatedAt: new Date(h.updated_at).toISOString(),
      patient: h.patient_id ? {
        id: h.patient_id,
        name: h.patientName,
        phone: h.patientPhone,
        email: h.patientEmail,
      } : null,
    });
  } catch (e) { next(e); }
});

handoffsRouter.post('/:id/accept', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const userId = req.user?.userId;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.handoffs
       SET status = 'accepted', assigned_to = $3::uuid, accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid AND clinic_id = $2::uuid AND status = 'pending'
       RETURNING *`,
      req.params.id,
      clinicId,
      userId ?? null
    );

    if (!rows || rows.length === 0) {
      throw new ConflictError('Handoff not found or already accepted/resolved.');
    }

    sendSuccess(res, rows[0], 'Handoff accepted');
  } catch (e) { next(e); }
});

handoffsRouter.post('/:id/resolve', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const userId = req.user?.userId;
    const parsed = z.object({ resolution: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) throw new Error('Resolution is required');

    // Call stored procedure api.resolve_handoff(p_clinic_id, p_handoff_id, p_assigned_to, p_resolution)
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT api.resolve_handoff($1::uuid, $2::uuid, $3::uuid, $4) as resolve_handoff`,
      clinicId,
      req.params.id,
      userId ?? null,
      parsed.data.resolution
    );

    const envelope = result[0]?.resolve_handoff;
    if (!envelope || !envelope.ok) {
      throw new ConflictError(envelope?.message ?? 'Handoff resolution failed');
    }

    sendSuccess(res, envelope.data, 'Handoff resolved');
  } catch (e) { next(e); }
});
