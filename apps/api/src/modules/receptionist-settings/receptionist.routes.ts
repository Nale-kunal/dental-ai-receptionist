import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { whatsAppService } from '../../services/whatsapp.service';
import { maskSecret } from '../../utils/encryption';
import { z } from 'zod';

export const receptionistRouter = Router();
receptionistRouter.use(authenticate);

// ─── General Receptionist Settings ──────────────────────────────────────────

receptionistRouter.get('/settings', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT name, settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const clinicName = rows[0]?.name || 'our clinic';
    const s = rows[0]?.settings ?? {};

    // Load canonical phone number ID from integration record or settings
    const integration = await whatsAppService.getClinicIntegration(clinicId);
    const canonicalPhoneId = integration?.phoneNumberId || s.phone_number_id || s.whatsapp_phone_number_id || s.meta_phone_number_id || '';

    const response = {
      enabled: s.receptionist_enabled ?? true,
      greetingMessage: s.greeting_message ?? `Hello! Welcome to ${clinicName}. How can I assist you today?`,
      tone: s.tone ?? 'professional',
      bookingEnabled: s.booking_enabled ?? true,
      handoffEnabled: s.handoff_enabled ?? true,
      afterHoursBehavior: s.after_hours_behavior ?? 'message',
      fallbackMessage: s.fallback_message ?? 'I am connecting you with our human team right now. Please hold on.',
      emergencyPhone: s.emergency_phone ?? '',
      phoneNumberId: canonicalPhoneId,
      whatsappPhoneNumberId: canonicalPhoneId, // backward-compatible alias
      pricingNote: s.pricing_note ?? s.pricing ?? '',
      cancellationPolicy: s.cancellation_policy ?? '',
      reschedulingPolicy: s.rescheduling_policy ?? '',
      acceptedInsurance: s.accepted_insurance ?? s.insurance ?? '',
      preparationInstructions: s.preparation_instructions ?? s.preparation ?? '',
      quietHours: s.quiet_hours ?? { enabled: false, start: '22:00', end: '08:00' },
      bookingRules: s.booking_rules ?? { minAdvanceHours: 2, maxAdvanceDays: 60, slotDurationMinutes: 30 },
      integrationStatus: integration?.status || 'unconfigured',
      hasWhatsAppToken: Boolean(integration?.accessToken),
    };

    sendSuccess(res, response);
  } catch (e) { next(e); }
});

const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  greetingMessage: z.string().optional(),
  tone: z.string().optional(),
  bookingEnabled: z.boolean().optional(),
  handoffEnabled: z.boolean().optional(),
  afterHoursBehavior: z.string().optional(),
  fallbackMessage: z.string().optional(),
  emergencyPhone: z.string().optional(),
  phoneNumberId: z.string().optional(),
  whatsappPhoneNumberId: z.string().optional(),
  pricingNote: z.string().optional(),
  cancellationPolicy: z.string().optional(),
  reschedulingPolicy: z.string().optional(),
  acceptedInsurance: z.string().optional(),
  preparationInstructions: z.string().optional(),
  quietHours: z.any().optional(),
  bookingRules: z.any().optional(),
});

receptionistRouter.put('/settings', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message || 'Invalid settings payload',
      });
    }

    const payload = parsed.data;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT settings FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );
    const settings = rows[0]?.settings ?? {};

    if (payload.enabled !== undefined) settings.receptionist_enabled = payload.enabled;
    if (payload.greetingMessage !== undefined) settings.greeting_message = payload.greetingMessage;
    if (payload.tone !== undefined) settings.tone = payload.tone;
    if (payload.bookingEnabled !== undefined) settings.booking_enabled = payload.bookingEnabled;
    if (payload.handoffEnabled !== undefined) settings.handoff_enabled = payload.handoffEnabled;
    if (payload.afterHoursBehavior !== undefined) settings.after_hours_behavior = payload.afterHoursBehavior;
    if (payload.fallbackMessage !== undefined) settings.fallback_message = payload.fallbackMessage;
    if (payload.emergencyPhone !== undefined) settings.emergency_phone = payload.emergencyPhone;
    if (payload.cancellationPolicy !== undefined) settings.cancellation_policy = payload.cancellationPolicy;
    if (payload.reschedulingPolicy !== undefined) settings.rescheduling_policy = payload.reschedulingPolicy;
    if (payload.acceptedInsurance !== undefined) settings.accepted_insurance = payload.acceptedInsurance;
    if (payload.preparationInstructions !== undefined) settings.preparation_instructions = payload.preparationInstructions;
    if (payload.pricingNote !== undefined) settings.pricing_note = payload.pricingNote;
    if (payload.quietHours !== undefined) settings.quiet_hours = payload.quietHours;
    if (payload.bookingRules !== undefined) settings.booking_rules = payload.bookingRules;

    // Handle Phone Number ID persistence and uniqueness validation
    const rawPhoneId = payload.phoneNumberId !== undefined ? payload.phoneNumberId : payload.whatsappPhoneNumberId;
    if (rawPhoneId !== undefined) {
      const cleanPhoneId = rawPhoneId.trim();
      if (cleanPhoneId && !/^\d{8,25}$/.test(cleanPhoneId)) {
        return res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Phone Number ID must contain only digits (8-25 characters)',
        });
      }

      // Check uniqueness against other clinics
      if (cleanPhoneId) {
        const conflictRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT clinic_id FROM api.clinic_whatsapp_integrations
           WHERE phone_number_id = $1 AND clinic_id != $2::uuid`,
          cleanPhoneId,
          clinicId
        );
        if (conflictRows && conflictRows.length > 0) {
          return res.status(409).json({
            ok: false,
            code: 'CONFLICT',
            message: `Phone Number ID '${cleanPhoneId}' is already assigned to another clinic`,
          });
        }
      }

      // Standardize canonical keys
      settings.phone_number_id = cleanPhoneId || null;
      settings.whatsapp_phone_number_id = cleanPhoneId || null;
      settings.meta_phone_number_id = cleanPhoneId || null;

      // Persist to dedicated integration table
      await prisma.$queryRawUnsafe(
        `INSERT INTO api.clinic_whatsapp_integrations (clinic_id, phone_number_id, updated_at)
         VALUES ($1::uuid, $2, NOW())
         ON CONFLICT (clinic_id) DO UPDATE SET
           phone_number_id = EXCLUDED.phone_number_id,
           updated_at = NOW()`,
        clinicId,
        cleanPhoneId || null
      );
    }

    await prisma.$queryRawUnsafe(
      `UPDATE api.clinics SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      clinicId,
      JSON.stringify(settings)
    );

    sendSuccess(res, settings, 'Receptionist settings updated');
  } catch (e) { next(e); }
});

// ─── Dedicated WhatsApp Integration Endpoints ───────────────────────────────

receptionistRouter.get('/integration', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const integration = await whatsAppService.getClinicIntegration(clinicId);

    const safeResponse = {
      clinicId,
      phoneNumberId: integration?.phoneNumberId || null,
      wabaId: integration?.wabaId || null,
      enabled: integration?.enabled ?? true,
      status: integration?.status || 'unconfigured',
      hasToken: Boolean(integration?.accessToken),
      maskedToken: maskSecret(integration?.accessToken),
      tokenExpiresAt: integration?.tokenExpiresAt || null,
      lastValidatedAt: integration?.lastValidatedAt || null,
      lastError: integration?.lastError || null,
    };

    sendSuccess(res, safeResponse);
  } catch (e) { next(e); }
});

const updateIntegrationSchema = z.object({
  phoneNumberId: z.string().optional(),
  wabaId: z.string().optional(),
  accessToken: z.string().optional(),
  enabled: z.boolean().optional(),
  validateNow: z.boolean().optional(),
});

receptionistRouter.put('/integration', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = updateIntegrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message || 'Invalid integration payload',
      });
    }

    const { phoneNumberId, wabaId, accessToken, enabled, validateNow } = parsed.data;

    if (phoneNumberId && !/^\d{8,25}$/.test(phoneNumberId.trim())) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Phone Number ID must contain only digits (8-25 characters)',
      });
    }

    const result = await whatsAppService.updateClinicIntegration(clinicId, {
      phoneNumberId,
      wabaId,
      accessToken,
      enabled,
    });

    let validationResult: any = null;
    if (validateNow && result.hasToken && result.phoneNumberId) {
      validationResult = await whatsAppService.validateIntegration(clinicId);
    }

    sendSuccess(
      res,
      {
        ...result,
        validation: validationResult,
      },
      validationResult?.valid
        ? 'WhatsApp integration credentials updated and validated with Meta'
        : 'WhatsApp integration credentials saved securely (unvalidated)'
    );
  } catch (e: any) {
    if (e.message && e.message.includes('already assigned')) {
      return res.status(409).json({
        ok: false,
        code: 'CONFLICT',
        message: e.message,
      });
    }
    next(e);
  }
});

receptionistRouter.post('/integration/validate', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const result = await whatsAppService.validateIntegration(clinicId);

    if (result.valid) {
      sendSuccess(res, result, result.message);
    } else {
      res.status(result.status === 'unconfigured' ? 400 : 422).json({
        ok: false,
        code: result.status === 'unconfigured' ? 'UNCONFIGURED' : 'VALIDATION_FAILED',
        message: result.message,
        data: result,
      });
    }
  } catch (e) {
    next(e);
  }
});
