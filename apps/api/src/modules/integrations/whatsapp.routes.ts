/**
 * Machine-to-Machine Outbound WhatsApp Dispatch Route
 *
 * Dedicated endpoint for external orchestrators (such as n8n):
 * - Authenticates caller via X-Service-Key with timing-safe comparison.
 * - Strict schema validation: rejects caller-supplied access tokens or phone number IDs.
 * - Resolves integration credentials strictly by clinic_id from api.clinic_whatsapp_integrations.
 * - Rejects dispatch if integration is disabled, unvalidated, invalid, or token is expired.
 * - Enforces 8-second Meta API timeout via AbortController.
 * - Guarantees idempotency via api.notifications (clinic_id, idempotency_key).
 * - Never returns tokens or decrypted credentials in responses, logs, or errors.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../database/prisma/client';
import { whatsAppService } from '../../services/whatsapp.service';

export const integrationsRouter = Router();

/**
 * Timing-safe string comparison to protect against side-channel timing attacks.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    // Constant time comparison against self to equalize execution time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Middleware: Enforces X-Service-Key authentication against env.INTERNAL_SERVICE_KEY.
 */
export function authenticateServiceKey(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.INTERNAL_SERVICE_KEY || env.INTERNAL_SERVICE_KEY;

  if (!configuredKey) {
    logger.error('INTERNAL_SERVICE_KEY is not configured on this server');
    res.status(503).json({
      ok: false,
      code: 'SERVICE_AUTH_NOT_CONFIGURED',
      message: 'Internal service authentication is not configured on this server.',
      data: null,
    });
    return;
  }

  const rawHeader =
    req.headers['x-service-key'] ||
    (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : undefined);

  const providedKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (!providedKey || typeof providedKey !== 'string') {
    res.status(401).json({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide valid X-Service-Key header.',
      data: null,
    });
    return;
  }

  if (!timingSafeEqualStr(providedKey.trim(), configuredKey.trim())) {
    logger.warn('Unauthorized service key attempt', { ip: req.ip, path: req.path });
    res.status(401).json({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Invalid service authentication key.',
      data: null,
    });
    return;
  }

  next();
}

/**
 * Strict request schema.
 * Rejects unknown keys to prevent callers from attempting to supply credentials or phone IDs.
 */
const outboundSendSchema = z
  .object({
    clinic_id: z.string().uuid('Invalid clinic_id UUID format'),
    recipient: z
      .string()
      .trim()
      .min(7, 'Recipient phone number must have at least 7 characters')
      .max(30, 'Recipient phone number is too long'),
    message: z
      .string()
      .trim()
      .min(1, 'Message body cannot be empty')
      .max(4096, 'Message body cannot exceed 4096 characters'),
    idempotency_key: z
      .string()
      .trim()
      .min(1, 'idempotency_key cannot be empty')
      .max(255, 'idempotency_key cannot exceed 255 characters'),
    conversation_id: z.string().uuid('Invalid conversation_id UUID format').optional(),
  })
  .strict();

/**
 * POST /api/v1/integrations/whatsapp/send
 */
integrationsRouter.post('/whatsapp/send', authenticateServiceKey, async (req: Request, res: Response) => {
  // 1. Strict Request Validation
  const parsed = outboundSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: parsed.error.errors[0]?.message || 'Invalid request body',
      details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      data: null,
    });
  }

  const { clinic_id, recipient, message, idempotency_key, conversation_id } = parsed.data;

  // 2. Pre-check for completed dispatch (Fast path for idempotent hits)
  try {
    const existingNotif = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, status, provider_message_id, created_at, sent_at
       FROM api.notifications
       WHERE clinic_id = $1::uuid AND idempotency_key = $2`,
      clinic_id,
      idempotency_key
    );

    if (existingNotif && existingNotif.length > 0) {
      const record = existingNotif[0];
      if (record.status === 'sent' && record.provider_message_id) {
        return res.status(200).json({
          ok: true,
          code: 'IDEMPOTENT_HIT',
          message: 'Message was previously dispatched successfully.',
          data: {
            delivery_status: 'sent',
            provider_message_id: record.provider_message_id,
            idempotency_key,
            dispatched_at: (record.sent_at || record.created_at)?.toISOString?.() || new Date(record.created_at).toISOString(),
          },
        });
      }

      if (record.status === 'processing') {
        return res.status(409).json({
          ok: false,
          code: 'IN_PROGRESS',
          message: 'A dispatch request with this idempotency key is currently in progress.',
          data: { idempotency_key },
        });
      }
    }
  } catch (err: any) {
    logger.warn('Failed to pre-check notification idempotency', {
      clinic_id,
      idempotency_key,
      error: err.message,
    });
  }

  // 3. Resolve Clinic WhatsApp Integration and Enforce Eligibility
  const integration = await whatsAppService.getClinicIntegration(clinic_id);

  if (!integration || !integration.phoneNumberId || !integration.accessToken) {
    return res.status(422).json({
      ok: false,
      code: 'INTEGRATION_UNCONFIGURED',
      message: 'Clinic does not have WhatsApp Cloud API credentials configured.',
      data: { delivery_status: 'failed' },
    });
  }

  if (!integration.enabled) {
    return res.status(409).json({
      ok: false,
      code: 'INTEGRATION_DISABLED',
      message: 'Live WhatsApp dispatch is disabled for this clinic (Safe Test Mode active). Outbound dispatch suppressed.',
      data: { delivery_status: 'logged_locally' },
    });
  }

  if (integration.status !== 'valid') {
    return res.status(422).json({
      ok: false,
      code: 'INTEGRATION_NOT_ELIGIBLE',
      message: `WhatsApp integration is not validated (current status: ${integration.status}). Outbound dispatch rejected.`,
      data: { status: integration.status, delivery_status: 'failed' },
    });
  }

  if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() <= Date.now()) {
    return res.status(422).json({
      ok: false,
      code: 'TOKEN_EXPIRED',
      message: 'WhatsApp access token has expired. Outbound dispatch rejected.',
      data: { delivery_status: 'failed', is_expired: true },
    });
  }

  // 4. Atomic Idempotency Reservation
  // Uses ON CONFLICT DO NOTHING RETURNING id to guarantee that concurrent requests
  // cannot both obtain execution lock for the same (clinic_id, idempotency_key).
  let notificationId: string | null = null;
  try {
    const notifRows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO api.notifications (
        clinic_id, conversation_id, kind, channel, recipient, template,
        status, idempotency_key, attempts, next_attempt_at, created_at
      ) VALUES (
        $1::uuid, $2, 'staff_alert'::api.notification_kind, 'whatsapp'::api.channel_type,
        $3, 'whatsapp_direct_send', 'processing'::api.delivery_status, $4, 1, NOW(), NOW()
      )
      ON CONFLICT (clinic_id, idempotency_key) DO NOTHING
      RETURNING id`,
      clinic_id,
      conversation_id || null,
      recipient,
      idempotency_key
    );

    if (notifRows && notifRows.length > 0) {
      notificationId = notifRows[0].id;
    } else {
      // Row exists: another request won the insert race or previously attempted this key
      const postConflictRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, status, provider_message_id, created_at, sent_at
         FROM api.notifications
         WHERE clinic_id = $1::uuid AND idempotency_key = $2`,
        clinic_id,
        idempotency_key
      );

      if (postConflictRows && postConflictRows.length > 0) {
        const record = postConflictRows[0];
        if (record.status === 'sent' && record.provider_message_id) {
          return res.status(200).json({
            ok: true,
            code: 'IDEMPOTENT_HIT',
            message: 'Message was previously dispatched successfully.',
            data: {
              delivery_status: 'sent',
              provider_message_id: record.provider_message_id,
              idempotency_key,
              dispatched_at: (record.sent_at || record.created_at)?.toISOString?.() || new Date(record.created_at).toISOString(),
            },
          });
        }

        if (record.status === 'processing') {
          return res.status(409).json({
            ok: false,
            code: 'IN_PROGRESS',
            message: 'A dispatch request with this idempotency key is currently in progress.',
            data: { idempotency_key },
          });
        }

        // If previously failed, atomically claim for retry
        const retryRows = await prisma.$queryRawUnsafe<any[]>(
          `UPDATE api.notifications
           SET status = 'processing'::api.delivery_status,
               attempts = api.notifications.attempts + 1,
               next_attempt_at = NOW()
           WHERE id = $1::uuid AND status = 'failed'::api.delivery_status
           RETURNING id`,
          record.id
        );
        if (retryRows && retryRows.length > 0) {
          notificationId = retryRows[0].id;
        } else {
          return res.status(409).json({
            ok: false,
            code: 'IN_PROGRESS',
            message: 'A dispatch request with this idempotency key is currently in progress.',
            data: { idempotency_key },
          });
        }
      }
    }
  } catch (err: any) {
    logger.warn('Could not record atomic notification state', { error: err.message });
  }

  // 5. Execute Outbound Send (Timeout: 8 seconds, database-derived credentials)
  const sendResult = await whatsAppService.sendMessage({
    clinicId: clinic_id,
    toPhone: recipient,
    body: message,
    timeoutMs: 8000,
  });

  // 6. Handle Result
  if (sendResult.success && sendResult.providerMessageId) {
    const wamid = sendResult.providerMessageId;
    const nowIso = new Date().toISOString();

    // Update notification record
    if (notificationId) {
      await prisma.$queryRawUnsafe(
        `UPDATE api.notifications
         SET status = 'sent'::api.delivery_status,
             provider_message_id = $2,
             sent_at = NOW()
         WHERE id = $1::uuid`,
        notificationId,
        wamid
      ).catch(() => {});
    }

    // Insert into api.messages if conversation_id provided
    if (conversation_id) {
      await prisma.$queryRawUnsafe(
        `INSERT INTO api.messages (
          clinic_id, conversation_id, direction, kind, body, provider_message_id, provider_payload, created_at
        ) VALUES (
          $1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind,
          $3, $4, $5::jsonb, NOW()
        )
        ON CONFLICT (conversation_id, provider_message_id) DO NOTHING`,
        clinic_id,
        conversation_id,
        message,
        wamid,
        JSON.stringify({
          sentBy: 'n8n_service',
          recipient,
          idempotencyKey: idempotency_key,
        })
      ).catch(() => {});
    }

    return res.status(200).json({
      ok: true,
      code: 'SENT',
      data: {
        delivery_status: 'sent',
        provider_message_id: wamid,
        idempotency_key,
        dispatched_at: nowIso,
      },
    });
  }

  // Handle send failures
  if (notificationId) {
    await prisma.$queryRawUnsafe(
      `UPDATE api.notifications
       SET status = 'failed'::api.delivery_status,
           failed_at = NOW(),
           error = $2::jsonb
       WHERE id = $1::uuid`,
      notificationId,
      JSON.stringify({
        message: sendResult.message,
        providerStatus: sendResult.providerStatus,
      })
    ).catch(() => {});
  }

  if (sendResult.providerStatus === 'rate_limited') {
    return res.status(429).json({
      ok: false,
      code: 'PROVIDER_RATE_LIMITED',
      message: sendResult.message,
      data: { retryable: true, idempotency_key },
    });
  }

  if (sendResult.providerStatus === 'auth_error') {
    return res.status(502).json({
      ok: false,
      code: 'PROVIDER_AUTH_ERROR',
      message: sendResult.message,
      data: { retryable: false, idempotency_key },
    });
  }

  return res.status(502).json({
    ok: false,
    code: 'PROVIDER_ERROR',
    message: sendResult.message,
    data: { retryable: false, idempotency_key },
  });
});
