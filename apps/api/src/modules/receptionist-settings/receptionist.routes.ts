import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { whatsAppService } from '../../services/whatsapp.service';
import { maskSecret } from '../../utils/encryption';
import { NotFoundError } from '../../middleware/errors/errorHandler';
import { z } from 'zod';

export const receptionistRouter = Router();
receptionistRouter.use(authenticate);

/**
 * Canonical helper to resolve receptionist enabled status.
 * Strict Fail-Closed Precedence Rules:
 * 1. If settings is missing, null, or non-object -> false (fail closed)
 * 2. If top-level receptionist_enabled is false or 'false' -> false (denied)
 * 3. If nested receptionist.enabled is false or 'false' -> false (denied)
 * 4. Contradictory check: If either canonical key is false, immediately denied
 * 5. Malformed string check: If any present canonical key is not boolean/boolean-string -> false (denied)
 * 6. Authorized ONLY when at least one canonical key is explicitly true AND neither is false/malformed
 * 7. Missing, null, unconfigured, or unknown status -> false (strict fail closed)
 */
export function resolveReceptionistEnabled(settings: any): boolean {
  if (!settings || typeof settings !== 'object') return false;

  const top = settings.receptionist_enabled;
  const nested = (settings.receptionist && typeof settings.receptionist === 'object') ? settings.receptionist.enabled : undefined;

  // 1. Explicit denial on false or "false" (fails closed)
  if (top === false || top === 'false') return false;
  if (nested === false || nested === 'false') return false;

  // 2. Validate boolean values; malformed strings (e.g. 'active', 'yes', '1') fail closed
  const isTopTrue = (top === true || top === 'true');
  const isNestedTrue = (nested === true || nested === 'true');

  const isTopValid = isTopTrue || top === undefined || top === null;
  const isNestedValid = isNestedTrue || nested === undefined || nested === null;

  if (!isTopValid || !isNestedValid) return false;

  // 3. Authorized ONLY when at least one canonical key is explicitly true
  if (isTopTrue || isNestedTrue) {
    return true;
  }

  // 4. Missing, null, or unknown status strictly fails closed
  return false;
}

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
    const r = (s.receptionist && typeof s.receptionist === 'object') ? s.receptionist : {};

    // Load canonical phone number ID from integration record or settings
    const integration = await whatsAppService.getClinicIntegration(clinicId);
    const canonicalPhoneId = integration?.phoneNumberId || s.phone_number_id || s.whatsapp_phone_number_id || s.meta_phone_number_id || '';

    const response = {
      enabled: resolveReceptionistEnabled(s),
      greetingMessage: s.greeting_message ?? r.welcomeMessage ?? r.greeting_message ?? `Hello! Welcome to ${clinicName}. How can I assist you today?`,
      tone: s.tone ?? r.tone ?? 'professional',
      bookingEnabled: s.booking_enabled ?? r.booking_enabled ?? true,
      handoffEnabled: s.handoff_enabled ?? r.handoff_enabled ?? true,
      afterHoursBehavior: s.after_hours_behavior ?? r.after_hours_behavior ?? 'message',
      fallbackMessage: s.fallback_message ?? r.fallback_message ?? r.fallbackMessage ?? 'I am connecting you with our human team right now. Please hold on.',
      emergencyPhone: s.emergency_phone ?? r.emergency_phone ?? r.emergencyPhone ?? '',
      phoneNumberId: canonicalPhoneId,
      whatsappPhoneNumberId: canonicalPhoneId, // backward-compatible alias
      pricingNote: s.pricing_note ?? s.pricing ?? r.pricing_note ?? '',
      cancellationPolicy: s.cancellation_policy ?? r.cancellation_policy ?? r.cancellationPolicy ?? '',
      reschedulingPolicy: s.rescheduling_policy ?? r.rescheduling_policy ?? r.reschedulingPolicy ?? '',
      acceptedInsurance: s.accepted_insurance ?? s.insurance ?? r.accepted_insurance ?? r.acceptedInsurance ?? '',
      preparationInstructions: s.preparation_instructions ?? s.preparation ?? r.preparation_instructions ?? '',
      quietHours: s.quiet_hours ?? r.quiet_hours ?? { enabled: false, start: '22:00', end: '08:00' },
      bookingRules: s.booking_rules ?? r.booking_rules ?? { minAdvanceHours: 2, maxAdvanceDays: 60, slotDurationMinutes: 30 },
      integrationStatus: integration?.status || 'unconfigured',
      integrationEnabled: Boolean(integration?.enabled),
      hasWhatsAppToken: Boolean(integration?.accessToken),
    };

    sendSuccess(res, response);
  } catch (e) { next(e); }
});

const updateStatusSchema = z.object({
  enabled: z.boolean({ required_error: 'enabled boolean is required' }),
});

// Dedicated atomic status toggle endpoint for instant persistence
receptionistRouter.patch('/status', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message || 'Invalid status payload. Expected { enabled: boolean }',
      });
    }

    const { enabled } = parsed.data;

    // Atomic update using jsonb_set in PostgreSQL: eliminates read-modify-write lost-update race conditions
    // Touches strictly receptionist_enabled and receptionist.enabled, preserving all unrelated settings
    const updatedRows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.clinics
       SET settings = jsonb_set(
             jsonb_set(
               COALESCE(settings, '{}'::jsonb) || jsonb_build_object('receptionist', COALESCE(settings->'receptionist', '{}'::jsonb)),
               '{receptionist_enabled}',
               to_jsonb($2::boolean),
               true
             ),
             '{receptionist,enabled}',
             to_jsonb($2::boolean),
             true
           ),
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING settings`,
      clinicId,
      enabled
    );

    if (!updatedRows || updatedRows.length === 0) {
      return res.status(404).json({
        ok: false,
        code: 'CLINIC_NOT_FOUND',
        message: 'Clinic not found',
      });
    }

    sendSuccess(res, {
      clinicId,
      enabled,
      status: enabled ? 'ACTIVE' : 'PAUSED',
      updatedAt: new Date().toISOString(),
    }, enabled ? 'Automated receptionist activated' : 'Automated receptionist paused');
  } catch (e) { next(e); }
});

// Real-time dispatch authorization check endpoint (fails closed)
receptionistRouter.get('/dispatch-auth', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         c.id AS clinic_id,
         (c.active IS TRUE) AS active,
         c.suspended_at,
         CASE
           WHEN NOT (c.active IS TRUE) OR c.suspended_at IS NOT NULL THEN false
           WHEN (c.settings->>'receptionist_enabled') = 'false' THEN false
           WHEN (c.settings->'receptionist'->>'enabled') = 'false' THEN false
           WHEN (
             ((c.settings->>'receptionist_enabled') = 'true' OR (c.settings->'receptionist'->>'enabled') = 'true')
             AND ((c.settings->>'receptionist_enabled') IS NULL OR (c.settings->>'receptionist_enabled') = 'true')
             AND ((c.settings->'receptionist'->>'enabled') IS NULL OR (c.settings->'receptionist'->>'enabled') = 'true')
           ) THEN true
           ELSE false
         END AS receptionist_enabled,
         COALESCE(i.enabled, false) AS integration_enabled,
         i.status AS integration_status
       FROM api.clinics c
       LEFT JOIN api.clinic_whatsapp_integrations i ON i.clinic_id = c.id
       WHERE c.id = $1::uuid`,
      clinicId
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        ok: false,
        code: 'CLINIC_NOT_FOUND',
        canDispatch: false,
        receptionistEnabled: false,
        message: 'Clinic not found',
      });
    }

    const row = rows[0];
    const isClinicActive = Boolean(row.active === true && !row.suspended_at);
    const receptionistEnabled = Boolean(row.receptionist_enabled === true);
    const integrationEnabled = Boolean(row.integration_enabled === true);
    const canDispatch = isClinicActive && receptionistEnabled && integrationEnabled;

    sendSuccess(res, {
      clinicId,
      receptionistEnabled,
      isClinicActive,
      integrationEnabled,
      canDispatch,
      reason: !isClinicActive
        ? 'clinic_inactive'
        : !receptionistEnabled
        ? 'receptionist_paused'
        : !integrationEnabled
        ? 'integration_disabled'
        : 'authorized',
    });
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

    // Handle Phone Number ID persistence and uniqueness validation before transaction
    const rawPhoneId = payload.phoneNumberId !== undefined ? payload.phoneNumberId : payload.whatsappPhoneNumberId;
    let cleanPhoneId: string | null = null;
    if (rawPhoneId !== undefined) {
      cleanPhoneId = rawPhoneId.trim();
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

    // Execute settings update inside a transaction with SELECT ... FOR UPDATE
    // Row-level lock guarantees serialization with concurrent PATCH /status updates
    const updatedSettings = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT settings FROM api.clinics WHERE id = $1::uuid FOR UPDATE`,
        clinicId
      );
      if (!rows || rows.length === 0) {
        throw new NotFoundError('Clinic');
      }

      const settings = rows[0]?.settings ?? {};
      if (!settings.receptionist || typeof settings.receptionist !== 'object') {
        settings.receptionist = {};
      }

      // CRITICAL: Only update receptionist enabled if explicitly provided in payload!
      // When saving preferences from UI, enabled is omitted to prevent overwriting status toggle
      if (payload.enabled !== undefined) {
        settings.receptionist_enabled = payload.enabled;
        settings.receptionist.enabled = payload.enabled;
      }
      if (payload.greetingMessage !== undefined) {
        settings.greeting_message = payload.greetingMessage;
        settings.receptionist.welcomeMessage = payload.greetingMessage;
        settings.receptionist.greeting_message = payload.greetingMessage;
      }
      if (payload.tone !== undefined) {
        settings.tone = payload.tone;
        settings.receptionist.tone = payload.tone;
      }
      if (payload.bookingEnabled !== undefined) {
        settings.booking_enabled = payload.bookingEnabled;
        settings.receptionist.booking_enabled = payload.bookingEnabled;
      }
      if (payload.handoffEnabled !== undefined) {
        settings.handoff_enabled = payload.handoffEnabled;
        settings.receptionist.handoff_enabled = payload.handoffEnabled;
      }
      if (payload.afterHoursBehavior !== undefined) {
        settings.after_hours_behavior = payload.afterHoursBehavior;
        settings.receptionist.after_hours_behavior = payload.afterHoursBehavior;
      }
      if (payload.fallbackMessage !== undefined) {
        settings.fallback_message = payload.fallbackMessage;
        settings.receptionist.fallback_message = payload.fallbackMessage;
        settings.receptionist.fallbackMessage = payload.fallbackMessage;
      }
      if (payload.emergencyPhone !== undefined) {
        settings.emergency_phone = payload.emergencyPhone;
        settings.receptionist.emergency_phone = payload.emergencyPhone;
        settings.receptionist.emergencyPhone = payload.emergencyPhone;
      }
      if (payload.cancellationPolicy !== undefined) {
        settings.cancellation_policy = payload.cancellationPolicy;
        settings.receptionist.cancellation_policy = payload.cancellationPolicy;
        settings.receptionist.cancellationPolicy = payload.cancellationPolicy;
      }
      if (payload.reschedulingPolicy !== undefined) {
        settings.rescheduling_policy = payload.reschedulingPolicy;
        settings.receptionist.rescheduling_policy = payload.reschedulingPolicy;
        settings.receptionist.reschedulingPolicy = payload.reschedulingPolicy;
      }
      if (payload.acceptedInsurance !== undefined) {
        settings.accepted_insurance = payload.acceptedInsurance;
        settings.receptionist.accepted_insurance = payload.acceptedInsurance;
        settings.receptionist.acceptedInsurance = payload.acceptedInsurance;
      }
      if (payload.preparationInstructions !== undefined) {
        settings.preparation_instructions = payload.preparationInstructions;
        settings.receptionist.preparation_instructions = payload.preparationInstructions;
      }
      if (payload.pricingNote !== undefined) {
        settings.pricing_note = payload.pricingNote;
        settings.receptionist.pricing_note = payload.pricingNote;
      }
      if (payload.quietHours !== undefined) {
        settings.quiet_hours = payload.quietHours;
        settings.receptionist.quiet_hours = payload.quietHours;
      }
      if (payload.bookingRules !== undefined) {
        settings.booking_rules = payload.bookingRules;
        settings.receptionist.booking_rules = payload.bookingRules;
      }

      if (cleanPhoneId !== null) {
        settings.phone_number_id = cleanPhoneId || null;
        settings.whatsapp_phone_number_id = cleanPhoneId || null;
        settings.meta_phone_number_id = cleanPhoneId || null;
      }

      await tx.$queryRawUnsafe(
        `UPDATE api.clinics SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
        clinicId,
        JSON.stringify(settings)
      );

      return settings;
    });

    sendSuccess(res, updatedSettings, 'Receptionist settings updated');
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
