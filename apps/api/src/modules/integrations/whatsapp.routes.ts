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
import { receptionistService } from '../../services/receptionist.service';

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

// ─── Meta WhatsApp Inbound Webhook Handlers ─────────────────────────────────

/**
 * GET Handler: Meta Webhook Verification Handshake
 * Responds to Meta verification challenge (hub.mode=subscribe) with hub.challenge.
 */
export async function handleWebhookVerification(req: Request, res: Response): Promise<void> {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && typeof challenge === 'string') {
    const configuredToken = process.env.META_WEBHOOK_VERIFY_TOKEN || env.META_WEBHOOK_VERIFY_TOKEN;

    // Check configured server verify token
    if (configuredToken && typeof token === 'string' && timingSafeEqualStr(token.trim(), configuredToken.trim())) {
      logger.info('Meta webhook verification handshake succeeded via server verify token');
      res.status(200).send(challenge);
      return;
    }

    // Also check if any clinic has this verify token in settings
    if (typeof token === 'string' && token.trim().length > 0) {
      try {
        const clinicMatch = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM api.clinics
           WHERE settings->>'meta_webhook_verify_token' = $1
              OR settings->'receptionist'->>'meta_webhook_verify_token' = $1
           LIMIT 1`,
          token.trim()
        );
        if (clinicMatch && clinicMatch.length > 0) {
          logger.info('Meta webhook verification handshake succeeded via clinic verify token', { clinicId: clinicMatch[0].id });
          res.status(200).send(challenge);
          return;
        }
      } catch (err: any) {
        logger.warn('Error querying clinic verify token during webhook handshake', { error: err.message });
      }
    }

    logger.warn('Meta webhook verification rejected: token mismatch', {
      mode,
      hasToken: Boolean(token),
      hasConfiguredToken: Boolean(configuredToken),
    });
    res.status(403).json({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Invalid verification token',
    });
    return;
  }

  res.status(400).json({
    ok: false,
    code: 'BAD_REQUEST',
    message: 'Invalid verification request parameters. Expected hub.mode=subscribe and hub.challenge.',
  });
}

/**
 * POST Handler: Meta WhatsApp Inbound Event Ingestion & Dispatch
 * - Validates signature if META_APP_SECRET is configured.
 * - Filters delivery status receipts, read receipts, and empty events.
 * - Resolves clinic by phone_number_id via api.get_clinic_by_phone_number_id.
 * - Atomically registers event in api.inbound_events for deduplication and durability.
 * - Immediately acknowledges Meta with HTTP 200 (prevents timeout and retries).
 * - Asynchronously executes ReceptionistService in background.
 */
export async function handleInboundWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = (req as any).rawBody
    ? (req as any).rawBody
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), 'utf-8');

  // 1. Signature Verification (if META_APP_SECRET is configured)
  const appSecret = process.env.META_APP_SECRET || (env as any).META_APP_SECRET;
  if (appSecret) {
    const signatureHeader = req.headers['x-hub-signature-256'];
    const signatureStr = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!signatureStr || !signatureStr.startsWith('sha256=')) {
      logger.warn('Meta webhook rejected: missing X-Hub-Signature-256 header');
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid signature header',
      });
      return;
    }

    const expectedHash = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    if (!timingSafeEqualStr(signatureStr.toLowerCase(), expectedHash.toLowerCase())) {
      logger.warn('Meta webhook rejected: signature mismatch');
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid HMAC signature',
      });
      return;
    }
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD', message: 'Request body must be a JSON object' });
    return;
  }

  // Filter out non-WhatsApp payloads
  if (body.object !== 'whatsapp_business_account' && !Array.isArray(body.entry)) {
    res.status(200).json({ ok: true, code: 'IGNORED_NON_WHATSAPP' });
    return;
  }

  const entry = Array.isArray(body.entry) ? body.entry[0] : null;
  const change = entry && Array.isArray(entry.changes) ? entry.changes[0] : null;
  const value = change && change.field === 'messages' ? change.value : null;

  if (!value) {
    res.status(200).json({ ok: true, code: 'NO_MESSAGE_FIELD' });
    return;
  }

  // 2. Handle Delivery Status Receipts (sent, delivered, read) without triggering AI
  if (Array.isArray(value.statuses) && value.statuses.length > 0) {
    const statusObj = value.statuses[0];
    const statusWamid = statusObj.id;
    const newStatus = statusObj.status; // 'sent' | 'delivered' | 'read' | 'failed'

    if (statusWamid) {
      try {
        if (newStatus === 'delivered' || newStatus === 'read') {
          await prisma.$queryRawUnsafe(
            `UPDATE api.notifications
             SET status = 'sent'::api.delivery_status
             WHERE provider_message_id = $1 AND status != 'sent'::api.delivery_status`,
            statusWamid
          );
        } else if (newStatus === 'failed') {
          await prisma.$queryRawUnsafe(
            `UPDATE api.notifications
             SET status = 'failed'::api.delivery_status, error = $2::jsonb
             WHERE provider_message_id = $1`,
            statusWamid,
            JSON.stringify(statusObj.errors || { message: 'WhatsApp message delivery failed' })
          );
        }
      } catch (err: any) {
        logger.warn('Error updating message status from Meta status webhook', { error: err.message, statusWamid });
      }
    }

    res.status(200).json({ ok: true, code: 'STATUS_ACK', status: newStatus });
    return;
  }

  // 3. Validate Incoming Messages
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    res.status(200).json({ ok: true, code: 'NO_MESSAGES' });
    return;
  }

  const msg = value.messages[0];
  const rawPhoneId = String(value.metadata?.phone_number_id || '').trim();
  const providerEventId = String(msg.id || '').trim();
  const senderPhone = String(msg.from || '').trim();
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const contact = contacts.find((c: any) => c && c.wa_id === senderPhone) || contacts[0] || null;
  const senderName = contact?.profile?.name || '';
  const messageText = msg.type === 'text' && msg.text?.body ? String(msg.text.body).trim() : '';

  if (!rawPhoneId) {
    logger.warn('Meta webhook missing metadata.phone_number_id');
    res.status(200).json({ ok: false, code: 'MISSING_PHONE_NUMBER_ID', message: 'phone_number_id is required' });
    return;
  }

  if (!providerEventId) {
    res.status(200).json({ ok: false, code: 'MISSING_MESSAGE_ID', message: 'messages[0].id is required' });
    return;
  }

  // 4. Resolve Clinic Mapping
  let clinicId: string | null = null;
  let resolution: any = null;
  try {
    const dbRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT (api.get_clinic_by_phone_number_id($1)->'data'->>'clinic_id')::text AS clinic_id,
              api.get_clinic_by_phone_number_id($1) AS resolution;`,
      rawPhoneId
    );
    clinicId = dbRes[0]?.clinic_id || null;
    resolution = dbRes[0]?.resolution || null;
  } catch (err: any) {
    logger.error('Failed to resolve clinic from phone_number_id', { error: err.message, phone_number_id: rawPhoneId });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!clinicId || !uuidRegex.test(clinicId)) {
    const unmappedCode = resolution?.code || 'NOT_FOUND';
    const unmappedMsg = resolution?.message || 'No clinic found for this phone number ID';
    logger.warn('Meta webhook unmapped phone number ID', { phone_number_id: rawPhoneId, code: unmappedCode });
    res.status(200).json({ ok: false, code: unmappedCode, message: unmappedMsg });
    return;
  }

  // 5. Durable Inbound Event Registration & Idempotency
  const rawPayloadStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const payloadHash = crypto.createHash('sha256').update(rawPayloadStr).digest('hex');

  let inboundEventId: string | undefined;
  let isDuplicate = false;

  try {
    const eventReg = await prisma.$queryRawUnsafe<any[]>(
      `SELECT api.register_inbound_event($1::uuid, 'meta_whatsapp', 'message', $2, $3, $4::jsonb) AS fn;`,
      clinicId,
      providerEventId,
      payloadHash,
      rawPayloadStr
    );
    const eventRes = eventReg[0]?.fn;
    if (eventRes?.data?.duplicate) {
      isDuplicate = true;
    }
    inboundEventId = eventRes?.data?.event_id;
  } catch (err: any) {
    logger.warn('api.register_inbound_event failed; falling back to direct Prisma insert', { error: err.message });
    try {
      const directInsert = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO api.inbound_events (clinic_id, provider, event_type, provider_event_id, payload_hash, raw_payload, state, created_at)
         VALUES ($1::uuid, 'meta_whatsapp', 'message', $2, $3, $4::jsonb, 'received'::api.event_state, NOW())
         ON CONFLICT (clinic_id, provider, provider_event_id) DO NOTHING
         RETURNING id`,
        clinicId,
        providerEventId,
        payloadHash,
        rawPayloadStr
      );
      if (directInsert && directInsert.length > 0) {
        inboundEventId = directInsert[0].id;
      } else {
        isDuplicate = true;
      }
    } catch (directErr: any) {
      logger.error('CRITICAL: Database failure persisting inbound event', { error: directErr.message });
      res.status(500).json({ ok: false, code: 'DATABASE_ERROR', message: 'Failed to persist event' });
      return;
    }
  }

  // If duplicate, acknowledge immediately without reprocessing
  if (isDuplicate) {
    logger.info('Duplicate WhatsApp webhook event received; safely acknowledging without re-processing', {
      clinicId,
      providerEventId,
    });
    res.status(200).json({ ok: true, code: 'DUPLICATE_EVENT', duplicate: true });
    return;
  }

  // 6. IMMEDIATE ACKNOWLEDGMENT: Respond 200 OK to Meta before running AI / appointment logic
  res.status(200).json({
    ok: true,
    code: 'EVENT_RECEIVED',
    provider_event_id: providerEventId,
    event_id: inboundEventId,
  });

  // 7. ASYNCHRONOUS PROCESSING: Run Receptionist Pipeline
  setImmediate(async () => {
    try {
      await receptionistService.processInboundMessage({
        clinicId: clinicId!,
        channel: 'whatsapp',
        senderPhone,
        senderName,
        messageText: messageText || 'Hello',
        providerEventId,
        inboundEventId,
        rawPayload: body,
      });
    } catch (procErr: any) {
      logger.error('Unhandled error during background receptionist processing', {
        error: procErr.message,
        stack: procErr.stack,
        clinicId,
        providerEventId,
      });
      if (inboundEventId) {
        try {
          await prisma.$queryRawUnsafe(
            `UPDATE api.inbound_events SET state = 'failed'::api.event_state, error = $2::jsonb, last_attempt_at = NOW() WHERE id = $1::uuid`,
            inboundEventId,
            JSON.stringify({ error: procErr.message })
          );
        } catch {
          // Ignore secondary DB error on failure recording
        }
      }
    }
  });
}

// ─── Register Webhook Routes ────────────────────────────────────────────────

// GET Webhook Verification
integrationsRouter.get('/whatsapp/webhook', handleWebhookVerification);
integrationsRouter.get('/whatsapp/inbound', handleWebhookVerification);
integrationsRouter.get('/webhook', handleWebhookVerification);
integrationsRouter.get('/', handleWebhookVerification);

// POST Inbound Message Ingestion
integrationsRouter.post('/whatsapp/webhook', handleInboundWebhook);
integrationsRouter.post('/whatsapp/inbound', handleInboundWebhook);
integrationsRouter.post('/webhook', handleInboundWebhook);
integrationsRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.object === 'whatsapp_business_account' || req.headers['x-hub-signature-256']) {
    return handleInboundWebhook(req, res);
  }
  next();
});
