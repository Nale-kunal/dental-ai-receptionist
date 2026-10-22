import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess, sendCreated } from '../../utils/response';
import { ValidationError, NotFoundError } from '../../middleware/errors/errorHandler';
import { z } from 'zod';

export const servicesRouter = Router();
servicesRouter.use(authenticate);

const serviceSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).optional(),
  durationMinutes: z.number().int().min(5).max(480),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  price: z.number().min(0).max(100000).nullable().optional(),
  currency: z.string().min(1).max(10).optional().default('USD'),
  pricingModel: z.enum(['fixed', 'starting_from', 'quote_required']).optional().default('fixed'),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  active: z.boolean().optional(),
});

function mapService(s: any) {
  return {
    id: s.id,
    clinicId: s.clinic_id ?? s.clinicId,
    code: s.code,
    name: s.name,
    durationMinutes: s.duration_minutes ?? s.durationMinutes,
    bufferMinutes: s.buffer_minutes ?? s.bufferMinutes ?? 15,
    price: s.price != null ? Number(s.price) : null,
    currency: s.currency || 'USD',
    pricingModel: s.pricing_model || s.pricingModel || 'fixed',
    description: s.description ?? null,
    category: s.category ?? null,
    active: s.active ?? true,
    isActive: s.active ?? true,
    createdAt: s.created_at ? new Date(s.created_at).toISOString() : undefined,
    updatedAt: s.updated_at ? new Date(s.updated_at).toISOString() : undefined,
  };
}

servicesRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const services = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, code, name, duration_minutes, buffer_minutes, active,
              price, currency, pricing_model, description, category, created_at, updated_at
       FROM api.services
       WHERE clinic_id = $1::uuid
       ORDER BY name ASC`,
      clinicId
    );
    sendSuccess(res, services.map(mapService));
  } catch (e) { next(e); }
});

servicesRouter.post('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
    }

    const code = parsed.data.code || parsed.data.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const buffer = parsed.data.bufferMinutes ?? 15;
    const priceVal = parsed.data.price !== undefined ? parsed.data.price : null;
    const currencyVal = parsed.data.currency || 'USD';
    const pricingModelVal = parsed.data.pricingModel || 'fixed';
    const descriptionVal = parsed.data.description ?? null;
    const categoryVal = parsed.data.category ?? null;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO api.services (clinic_id, code, name, duration_minutes, buffer_minutes, price, currency, pricing_model, description, category, active)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id, clinic_id, code, name, duration_minutes, buffer_minutes, price, currency, pricing_model, description, category, active, created_at, updated_at`,
      clinicId, code, parsed.data.name, parsed.data.durationMinutes, buffer,
      priceVal, currencyVal, pricingModelVal, descriptionVal, categoryVal
    );

    sendCreated(res, mapService(rows[0]), 'Service created');
  } catch (e) { next(e); }
});

servicesRouter.get('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, code, name, duration_minutes, buffer_minutes, active,
              price, currency, pricing_model, description, category, created_at, updated_at
       FROM api.services
       WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      req.params.id, clinicId
    );
    if (!rows || rows.length === 0) throw new NotFoundError('Service');
    sendSuccess(res, mapService(rows[0]));
  } catch (e) { next(e); }
});

servicesRouter.patch('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.services
       SET name = COALESCE($3, name),
           code = COALESCE($4, code),
           duration_minutes = COALESCE($5, duration_minutes),
           buffer_minutes = COALESCE($6, buffer_minutes),
           price = CASE WHEN $7::boolean THEN $8::numeric ELSE price END,
           currency = COALESCE($9, currency),
           pricing_model = COALESCE($10, pricing_model),
           description = CASE WHEN $11::boolean THEN $12 ELSE description END,
           category = CASE WHEN $13::boolean THEN $14 ELSE category END,
           active = COALESCE($15, active),
           updated_at = NOW()
       WHERE id = $1::uuid AND clinic_id = $2::uuid
       RETURNING id, clinic_id, code, name, duration_minutes, buffer_minutes, price, currency, pricing_model, description, category, active, created_at, updated_at`,
      req.params.id, clinicId, parsed.data.name ?? null, parsed.data.code ?? null,
      parsed.data.durationMinutes ?? null, parsed.data.bufferMinutes ?? null,
      parsed.data.price !== undefined, parsed.data.price ?? null,
      parsed.data.currency ?? null,
      parsed.data.pricingModel ?? null,
      parsed.data.description !== undefined, parsed.data.description ?? null,
      parsed.data.category !== undefined, parsed.data.category ?? null,
      parsed.data.active ?? null
    );

    if (!rows || rows.length === 0) throw new NotFoundError('Service');
    sendSuccess(res, mapService(rows[0]), 'Service updated');
  } catch (e) { next(e); }
});

servicesRouter.delete('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const serviceId = req.params.id;

    // Check service exists
    const service = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name FROM api.services WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      serviceId, clinicId
    );
    if (!service || service.length === 0) throw new NotFoundError('Service');

    // Check existing appointments
    const appts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int as count FROM api.appointments WHERE service_id = $1::uuid AND clinic_id = $2::uuid`,
      serviceId, clinicId
    );
    const hasAppointments = (appts[0]?.count || 0) > 0;

    if (hasAppointments) {
      await prisma.$queryRawUnsafe(
        `UPDATE api.services SET active = false WHERE id = $1::uuid AND clinic_id = $2::uuid`,
        serviceId, clinicId
      );
      return sendSuccess(res, {
        id: serviceId,
        deactivated: true,
        active: false,
        message: 'Treatment has existing patient appointment records and has been deactivated instead of deleted to protect appointment integrity.',
      });
    }

    await prisma.$queryRawUnsafe(`DELETE FROM api.services WHERE id = $1::uuid AND clinic_id = $2::uuid`, serviceId, clinicId);
    sendSuccess(res, { id: serviceId, deleted: true, message: 'Treatment procedure removed successfully.' });
  } catch (e) { next(e); }
});

