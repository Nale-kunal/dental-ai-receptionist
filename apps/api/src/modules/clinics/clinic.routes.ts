import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { NotFoundError, ValidationError } from '../../middleware/errors/errorHandler';
import { z } from 'zod';

export const clinicRouter = Router();
clinicRouter.use(authenticate);

function mapClinic(c: any) {
  const rawSettings = c.settings ?? {};
  const {
    meta_access_token,
    access_token,
    whatsapp_token,
    encrypted_access_token,
    secret,
    api_key,
    ...sanitizedSettings
  } = rawSettings;

  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    phone: c.phone,
    email: c.email,
    timezone: c.timezone,
    locale: c.locale,
    active: c.active,
    isActive: c.active,
    settings: sanitizedSettings,
    address: (c.settings as any)?.address ?? (c.settings as any)?.location ?? '',
    city: (c.settings as any)?.city ?? '',
    state: (c.settings as any)?.state ?? '',
    country: (c.settings as any)?.country ?? '',
    postalCode: (c.settings as any)?.postalCode ?? '',
    currency: (c.settings as any)?.currency ?? 'USD',
    createdAt: c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString(),
    updatedAt: c.updated_at ? new Date(c.updated_at).toISOString() : new Date().toISOString(),
  };
}

clinicRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, slug, timezone, locale, phone, email, active, settings, created_at, updated_at
       FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    if (!rows || rows.length === 0) throw new NotFoundError('Clinic');
    sendSuccess(res, mapClinic(rows[0]));
  } catch (e) { next(e); }
});

clinicRouter.get('/context', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT api.get_clinic_context($1::uuid) as ctx`,
      clinicId
    );
    const envelope = result[0]?.ctx;
    if (!envelope || !envelope.ok) {
      throw new NotFoundError('Clinic context');
    }
    sendSuccess(res, envelope.data);
  } catch (e) { next(e); }
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  currency: z.string().max(10).optional(),
});

clinicRouter.patch('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
    }

    const currentRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const currentSettings = currentRows[0]?.settings ?? {};

    if (parsed.data.address !== undefined) currentSettings.address = parsed.data.address;
    if (parsed.data.city !== undefined) currentSettings.city = parsed.data.city;
    if (parsed.data.state !== undefined) currentSettings.state = parsed.data.state;
    if (parsed.data.country !== undefined) currentSettings.country = parsed.data.country;
    if (parsed.data.postalCode !== undefined) currentSettings.postalCode = parsed.data.postalCode;
    if (parsed.data.currency !== undefined) currentSettings.currency = parsed.data.currency;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.clinics
       SET name = COALESCE($2, name),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           timezone = COALESCE($5, timezone),
           locale = COALESCE($6, locale),
           settings = $7::jsonb,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, name, slug, timezone, locale, phone, email, active, settings, created_at, updated_at`,
      clinicId,
      parsed.data.name ?? null,
      parsed.data.phone ?? null,
      parsed.data.email ?? null,
      parsed.data.timezone ?? null,
      parsed.data.locale ?? null,
      JSON.stringify(currentSettings)
    );

    if (!rows || rows.length === 0) throw new NotFoundError('Clinic');
    sendSuccess(res, mapClinic(rows[0]), 'Clinic updated');
  } catch (e) { next(e); }
});

// Settings & Knowledge Base configuration
clinicRouter.get('/config', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    if (!rows || rows.length === 0) throw new NotFoundError('Clinic');
    sendSuccess(res, rows[0].settings ?? {});
  } catch (e) { next(e); }
});

clinicRouter.put('/config/:key', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const key = req.params.key;
    const value = req.body.value;

    const currentRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    if (!currentRows || currentRows.length === 0) throw new NotFoundError('Clinic');
    const settings = currentRows[0].settings ?? {};
    settings[key] = value;

    await prisma.$queryRawUnsafe(
      `UPDATE api.clinics SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      clinicId,
      JSON.stringify(settings)
    );

    sendSuccess(res, { key, value }, 'Configuration saved');
  } catch (e) { next(e); }
});

// FAQs
clinicRouter.get('/faqs', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const settings = rows[0]?.settings ?? {};
    const faqs = settings.faqs || [
      { id: '1', question: 'What insurance plans do you accept?', answer: settings.accepted_insurance || settings.insurance || 'Many PPO dental insurance plans are accepted.', isActive: true },
      { id: '2', question: 'What is your cancellation policy?', answer: settings.cancellation_policy || 'Please provide 24 hours notice to cancel.', isActive: true },
      { id: '3', question: 'How do I prepare for my first visit?', answer: settings.preparation_instructions || settings.first_visit_info || 'Please arrive 15 minutes early with your photo ID.', isActive: true },
      { id: '4', question: 'What are your payment methods?', answer: settings.payment_methods || settings.payment || 'We accept major credit cards, debit, cash, HSA/FSA.', isActive: true },
      { id: '5', question: 'What should I do in a dental emergency?', answer: settings.emergency_guidance || settings.emergency || 'Call the clinic for urgent pain during hours; visit emergency room for severe trauma.', isActive: true }
    ];
    sendSuccess(res, faqs);
  } catch (e) { next(e); }
});
