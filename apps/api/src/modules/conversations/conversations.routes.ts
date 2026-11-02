import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { authenticate, requireRole } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId, isValidUuid } from '../../middleware/authorization/tenantScope';
import { sendSuccess, sendUnauthorized, sendError } from '../../utils/response';
import { NotFoundError } from '../../middleware/errors/errorHandler';
import { DEFAULT_PAGE_SIZE } from '@dental/shared';
import { whatsAppService } from '../../services/whatsapp.service';
import { logger } from '../../config/logger';

export const conversationsRouter = Router();

// Periodic cleanup of expired tickets in shared PostgreSQL store
const ticketPurgeTimer = setInterval(async () => {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM api.stream_tickets WHERE expires_at < now() - interval '1 minute'`
    );
  } catch (err: any) {
    logger.warn('Background stream ticket purge encountered error', {
      error: err?.message || String(err),
    });
  }
}, 60000);
ticketPurgeTimer.unref();

export const conversationEvents = new EventEmitter();
conversationEvents.setMaxListeners(300);

/**
 * POST /api/v1/conversations/stream-ticket
 * Generates a short-lived (30s) single-use ticket for browser EventSource SSE connections.
 * Requires standard Bearer token in Authorization header.
 * Persisted in shared api.stream_tickets (PostgreSQL) for atomic cross-instance Render safety.
 */
conversationsRouter.post('/stream-ticket', authenticate, async (req, res, next) => {
  try {
    const user = req.user!;
    const jti = randomBytes(24).toString('hex');
    const ticket = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        clinicId: user.clinicId,
        tenantId: user.tenantId,
        roles: user.roles,
        purpose: 'sse_stream',
      },
      env.JWT_SECRET,
      { expiresIn: '30s', jwtid: jti }
    );

    // Atomically insert into shared PostgreSQL store with 30s TTL
    await prisma.$executeRawUnsafe(
      `INSERT INTO api.stream_tickets (jti, clinic_id, user_id, email, tenant_id, roles, expires_at)
       VALUES ($1, $2::uuid, $3, $4, $5, $6::text[], now() + interval '30 seconds')`,
      jti,
      user.clinicId,
      user.userId,
      user.email || null,
      user.tenantId || null,
      user.roles || []
    );

    sendSuccess(res, { ticket, expiresIn: 30 });
  } catch (err: any) {
    logger.error('Failed to create stream ticket in database', {
      error: err?.message || String(err),
      clinicId: req.user?.clinicId,
    });
    next(err);
  }
});

/**
 * Real-Time Server-Sent Events (SSE) Stream
 * Accepts either:
 * 1. Standard Authorization: Bearer <token> header (e.g. programmatic tests)
 * 2. Short-lived single-use ?ticket=<ticket> query parameter (browser EventSource)
 * Atomically consumes tickets from api.stream_tickets using DELETE ... RETURNING.
 * Guaranteed single-use across multiple Render instances with zero race condition vulnerabilities.
 * Strictly scoped by authenticated clinic_id for complete tenant isolation.
 */
conversationsRouter.get('/stream', async (req, res, next) => {
  // 1. Direct Bearer header check (programmatic clients)
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }

  // 2. Single-use stream ticket in query parameter (browser EventSource)
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket.trim() : undefined;
  if (ticket) {
    let decoded: any;
    try {
      decoded = jwt.verify(ticket, env.JWT_SECRET) as any;
    } catch {
      logger.warn('Stream ticket signature or JWT expiration check failed');
      return sendUnauthorized(res, 'Invalid or expired stream ticket');
    }

    if (!decoded || decoded.purpose !== 'sse_stream' || !decoded.jti) {
      logger.warn('Stream ticket rejected: invalid purpose or missing jti');
      return sendUnauthorized(res, 'Authentication required: valid ticket or Bearer token needed');
    }

    try {
      // Atomic consumption in shared PostgreSQL store:
      // DELETE ... WHERE jti = $1 AND expires_at > now() RETURNING ...
      // PostgreSQL row locks guarantee only one instance consumes the ticket.
      const consumed = await prisma.$queryRawUnsafe<any[]>(
        `DELETE FROM api.stream_tickets
         WHERE jti = $1 AND expires_at > now()
         RETURNING clinic_id, user_id, email, tenant_id, roles`,
        decoded.jti
      );

      if (consumed && consumed.length > 0) {
        const row = consumed[0];
        req.user = {
          userId: row.user_id,
          email: row.email,
          clinicId: row.clinic_id,
          tenantId: row.tenant_id,
          roles: row.roles || [],
        };
        return next();
      } else {
        logger.warn('Stream ticket rejected: already consumed or expired in database', {
          jti: decoded.jti,
          clinicId: decoded.clinicId,
        });
        return sendUnauthorized(res, 'Stream ticket has already been used or expired');
      }
    } catch (dbErr: any) {
      logger.error('Database failure during stream ticket consumption', {
        jti: decoded.jti,
        error: dbErr?.message || String(dbErr),
      });
      return sendError(res, 'INTERNAL_ERROR', 'Database service unavailable', 500);
    }
  }

  sendUnauthorized(res, 'Authentication required: valid ticket or Bearer token needed');
}, async (req, res) => {
  const clinicId = getAuthenticatedClinicId(req);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  // Send initial connection event
  const initialEvent = JSON.stringify({
    type: 'connected',
    clinicId,
    timestamp: new Date().toISOString(),
  });
  res.write(`event: connected\ndata: ${initialEvent}\n\n`);

  let lastCheckedAt = new Date();

  // Listener for events emitted in-process (e.g. staff replies)
  const onEvent = (payload: any) => {
    try {
      res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  const onDeleted = (payload: any) => {
    try {
      res.write(`event: conversation_deleted\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  conversationEvents.on(`message:${clinicId}`, onEvent);
  conversationEvents.on(`conversation:deleted:${clinicId}`, onDeleted);

  // Background polling check to detect inbound messages inserted by n8n or external webhooks
  const pollInterval = setInterval(async () => {
    try {
      const newMessages = await prisma.$queryRawUnsafe<any[]>(
        `SELECT m.id, m.conversation_id, m.clinic_id, m.direction, m.kind, m.body,
                m.media_url, m.media_mime_type, m.provider_message_id, m.provider_payload, m.created_at,
                c.channel, c.channel_conversation_id
         FROM api.messages m
         JOIN api.conversations c ON c.id = m.conversation_id AND c.clinic_id = m.clinic_id
         WHERE m.clinic_id = $1::uuid AND m.created_at > $2::timestamptz
         ORDER BY m.created_at ASC
         LIMIT 50`,
        clinicId,
        lastCheckedAt
      );

      if (newMessages.length > 0) {
        for (const m of newMessages) {
          const mDate = new Date(m.created_at);
          if (mDate > lastCheckedAt) {
            lastCheckedAt = mDate;
          }

          const isStaff = m.direction === 'outbound' && (
            m.provider_message_id?.startsWith('staff_reply:') ||
            m.provider_payload?.sentBy === 'clinic_staff'
          );

          const formattedMessage = {
            id: m.id,
            conversationId: m.conversation_id,
            direction: m.direction,
            kind: m.kind,
            body: m.body,
            content: m.body,
            mediaUrl: m.media_url,
            mediaMimeType: m.media_mime_type,
            providerMessageId: m.provider_message_id,
            providerPayload: m.provider_payload,
            isStaff,
            deliveryStatus: isStaff ? 'logged_locally' : 'sent',
            createdAt: mDate.toISOString(),
          };

          res.write(`event: message\ndata: ${JSON.stringify({
            conversationId: m.conversation_id,
            message: formattedMessage,
            lastMessageAt: mDate.toISOString(),
            lastMessageBody: m.body,
          })}\n\n`);
        }
      }
    } catch {
      // transient DB error; keep stream open
    }
  }, 2500);

  // Keep-alive heartbeat every 20s
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // client disconnected
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    conversationEvents.off(`message:${clinicId}`, onEvent);
    conversationEvents.off(`conversation:deleted:${clinicId}`, onDeleted);
    res.end();
  });
});

// All subsequent REST routes strictly enforce standard Bearer JWT authentication
conversationsRouter.use(authenticate);

/**
 * Delta synchronization endpoint
 * Used after reconnect, tab wake-up, or initial load to ensure zero missed messages.
 */
conversationsRouter.get('/sync', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const sinceParam = req.query.since as string | undefined;
    const conversationId = req.query.conversationId as string | undefined;

    const sinceDate = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 3600000);

    const conditions: string[] = ['m.clinic_id = $1::uuid', 'm.created_at >= $2::timestamptz'];
    const params: unknown[] = [clinicId, sinceDate];
    let idx = 3;

    if (conversationId) {
      conditions.push(`m.conversation_id = $${idx++}::uuid`);
      params.push(conversationId);
    }

    const messages = await prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.conversation_id, m.clinic_id, m.direction, m.kind, m.body,
              m.media_url, m.media_mime_type, m.provider_message_id, m.provider_payload, m.created_at
       FROM api.messages m
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at ASC
       LIMIT 200`,
      ...params
    );

    const mappedMessages = messages.map((m) => {
      const isStaff = m.direction === 'outbound' && (
        m.provider_message_id?.startsWith('staff_reply:') ||
        m.provider_payload?.sentBy === 'clinic_staff'
      );
      return {
        id: m.id,
        conversationId: m.conversation_id,
        direction: m.direction,
        kind: m.kind,
        body: m.body,
        content: m.body,
        mediaUrl: m.media_url,
        mediaMimeType: m.media_mime_type,
        providerMessageId: m.provider_message_id,
        providerPayload: m.provider_payload,
        isStaff,
        deliveryStatus: isStaff ? 'logged_locally' : 'sent',
        createdAt: new Date(m.created_at).toISOString(),
      };
    });

    sendSuccess(res, {
      messages: mappedMessages,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

function isPhoneNumber(val?: string | null): boolean {
  if (!val) return false;
  const clean = val.replace(/[\s\-\(\)\.]/g, '');
  return /^\+?\d{7,15}$/.test(clean);
}

function resolveContactIdentity(c: {
  patientName?: string | null;
  patientPhone?: string | null;
  channel_conversation_id?: string | null;
  channel?: string | null;
}) {
  const patientName = c.patientName?.trim() || null;
  const patientPhone = c.patientPhone?.trim() || null;
  const channelId = c.channel_conversation_id?.trim() || null;
  const isPhone = isPhoneNumber(channelId);

  // Resolution priority:
  // 1. Verified clinic-scoped patient name
  // 2. Verified patient phone number
  // 3. Channel phone number if conversational identifier is a phone number
  // 4. Fallback to 'Unknown contact' (never fabricate or show generic dummy labels)
  let displayName = patientName;
  if (!displayName) {
    if (patientPhone) {
      displayName = patientPhone;
    } else if (isPhone && channelId) {
      displayName = channelId;
    } else {
      displayName = 'Unknown contact';
    }
  }

  const phone = patientPhone || (isPhone ? channelId : '');

  return {
    displayName,
    phone,
    patientName,
    patientPhone,
  };
}

conversationsRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? 1)));
    const pageSize = Math.min(100, parseInt(String(req.query.pageSize ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * pageSize;
    const channel = req.query.channel as string | undefined;

    const conditions: string[] = ['c.clinic_id = $1::uuid'];
    const params: unknown[] = [clinicId];
    let idx = 2;

    if (channel) {
      conditions.push(`c.channel = $${idx++}::api.channel_type`);
      params.push(channel);
    }

    const where = conditions.join(' AND ');

    const countResult = await prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text as count FROM api.conversations c WHERE ${where}`,
      ...params
    );
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.clinic_id, c.patient_id, c.channel, c.channel_conversation_id,
              c.state, c.last_message_at, c.closed_at, c.created_at,
              COALESCE(p.full_name, p_match.full_name) as "patientName",
              COALESCE(p.phone, p_match.phone) as "patientPhone",
              COALESCE(p.email, p_match.email) as "patientEmail",
              (SELECT COUNT(*)::int FROM api.messages m WHERE m.conversation_id = c.id) as "messageCount",
              (SELECT m.body FROM api.messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as "lastMessageBody"
       FROM api.conversations c
       LEFT JOIN api.patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
       LEFT JOIN api.patients p_match ON c.patient_id IS NULL
                                     AND p_match.clinic_id = c.clinic_id
                                     AND (p_match.phone = c.channel_conversation_id OR p_match.whatsapp_id = c.channel_conversation_id)
       WHERE ${where}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      ...params,
      pageSize,
      offset
    );

    sendSuccess(res, {
      items: rows.map((c) => {
        const iden = resolveContactIdentity(c);
        return {
          id: c.id,
          clinicId: c.clinic_id,
          patientId: c.patient_id,
          channel: c.channel,
          patientName: iden.patientName,
          contactName: iden.displayName,
          patientPhone: iden.patientPhone,
          contactPhone: iden.phone,
          phone: iden.phone,
          lastMessageBody: c.lastMessageBody,
          lastMessageAt: c.last_message_at ? new Date(c.last_message_at).toISOString() : null,
          lastActivity: c.last_message_at ? new Date(c.last_message_at).toISOString() : new Date(c.created_at).toISOString(),
          closedAt: c.closed_at ? new Date(c.closed_at).toISOString() : null,
          createdAt: new Date(c.created_at).toISOString(),
          updatedAt: c.last_message_at ? new Date(c.last_message_at).toISOString() : new Date(c.created_at).toISOString(),
          messageCount: c.messageCount ?? 0,
          patient: (c.patient_id || iden.patientName) ? {
            id: c.patient_id,
            name: iden.patientName || iden.displayName,
            phone: iden.patientPhone || iden.phone,
            email: c.patientEmail,
          } : null,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e) { next(e); }
});

conversationsRouter.get('/:id', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);

    const convRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.clinic_id, c.patient_id, c.channel, c.channel_conversation_id,
              c.state, c.last_message_at, c.closed_at, c.created_at,
              COALESCE(p.full_name, p_match.full_name) as "patientName",
              COALESCE(p.phone, p_match.phone) as "patientPhone",
              COALESCE(p.email, p_match.email) as "patientEmail"
       FROM api.conversations c
       LEFT JOIN api.patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
       LEFT JOIN api.patients p_match ON c.patient_id IS NULL
                                     AND p_match.clinic_id = c.clinic_id
                                     AND (p_match.phone = c.channel_conversation_id OR p_match.whatsapp_id = c.channel_conversation_id)
       WHERE c.id = $1::uuid AND c.clinic_id = $2::uuid`,
      req.params.id,
      clinicId
    );

    if (!convRows || convRows.length === 0) throw new NotFoundError('Conversation');
    const conv = convRows[0];
    const iden = resolveContactIdentity(conv);

    const messages = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, conversation_id, clinic_id, direction, kind, body, media_url,
              media_mime_type, provider_message_id, provider_payload, created_at
       FROM api.messages
       WHERE conversation_id = $1::uuid AND clinic_id = $2::uuid
       ORDER BY created_at ASC
       LIMIT 300`,
      req.params.id,
      clinicId
    );

    const convPayload = {
      id: conv.id,
      clinicId: conv.clinic_id,
      patientId: conv.patient_id,
      channel: conv.channel,
      patientName: iden.patientName,
      contactName: iden.displayName,
      patientPhone: iden.patientPhone,
      contactPhone: iden.phone,
      phone: iden.phone,
      state: conv.state,
      lastMessageAt: conv.last_message_at ? new Date(conv.last_message_at).toISOString() : null,
      closedAt: conv.closed_at ? new Date(conv.closed_at).toISOString() : null,
      createdAt: new Date(conv.created_at).toISOString(),
      updatedAt: conv.last_message_at ? new Date(conv.last_message_at).toISOString() : new Date(conv.created_at).toISOString(),
      patient: (conv.patient_id || iden.patientName) ? {
        id: conv.patient_id,
        name: iden.patientName || iden.displayName,
        phone: iden.patientPhone || iden.phone,
        email: conv.patientEmail,
      } : null,
    };

    const mappedMessages = messages.map((m) => {
      const isStaff = m.direction === 'outbound' && (
        m.provider_message_id?.startsWith('staff_reply:') ||
        m.provider_payload?.sentBy === 'clinic_staff'
      );
      return {
        id: m.id,
        conversationId: m.conversation_id,
        direction: m.direction,
        kind: m.kind,
        body: m.body,
        content: m.body,
        mediaUrl: m.media_url,
        mediaMimeType: m.media_mime_type,
        providerMessageId: m.provider_message_id,
        providerPayload: m.provider_payload,
        isStaff,
        deliveryStatus: isStaff ? 'logged_locally' : 'sent',
        createdAt: new Date(m.created_at).toISOString(),
      };
    });

    sendSuccess(res, {
      ...convPayload,
      conversation: convPayload,
      messages: mappedMessages,
    });
  } catch (e) { next(e); }
});

const getOrCreateSchema = z.object({
  channel: z.enum(['whatsapp', 'web_chat', 'sms', 'voice', 'email', 'instagram']),
  channelConversationId: z.string().trim().min(1, 'channelConversationId is required'),
  patientId: z.string().uuid().optional(),
  inactivityInterval: z.string().optional(),
  forceNew: z.boolean().optional(),
});

conversationsRouter.post('/get-or-create', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const parsed = getOrCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid conversation payload',
        },
      });
    }

    const { channel, channelConversationId, patientId, inactivityInterval, forceNew } = parsed.data;

    const resultRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid, $5::interval, $6::boolean) as result;`,
      clinicId,
      channel,
      channelConversationId,
      patientId || null,
      inactivityInterval || null,
      forceNew || false
    );

    const result = resultRows[0]?.result;
    if (!result?.ok) {
      return res.status(400).json(result);
    }

    return sendSuccess(res, result.data, result.data.existing ? 'Existing conversation resumed' : 'New conversation created');
  } catch (e) {
    next(e);
  }
});

conversationsRouter.patch('/:id/close', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const conversationId = req.params.id;
    const reason = req.body?.reason || 'staff_action';

    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE api.conversations
       SET closed_at = NOW(),
           state = state || jsonb_build_object('close_reason', $3::text, 'closed_by', $4::text)
       WHERE id = $1::uuid AND clinic_id = $2::uuid AND closed_at IS NULL
       RETURNING id, clinic_id, state, closed_at`,
      conversationId,
      clinicId,
      reason,
      req.user?.userId || 'staff'
    );

    if (!updated || updated.length === 0) {
      throw new NotFoundError('Active conversation');
    }

    return sendSuccess(res, updated[0], 'Conversation closed successfully');
  } catch (e) {
    next(e);
  }
});

const postMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message body cannot be empty').max(4000, 'Message body is too long'),
  resolveHandoff: z.boolean().optional(),
});

conversationsRouter.post('/:id/messages', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const conversationId = req.params.id;

    const parsed = postMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message || 'Invalid message data',
        },
      });
    }

    const { body, resolveHandoff } = parsed.data;

    // Verify conversation belongs to this clinic
    const convRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT c.id, c.clinic_id, c.patient_id, c.channel, c.channel_conversation_id,
              c.state, p.full_name as "patientName", p.phone as "patientPhone", p.whatsapp_id as "patientWhatsappId"
       FROM api.conversations c
       LEFT JOIN api.patients p ON p.id = c.patient_id
       WHERE c.id = $1::uuid AND c.clinic_id = $2::uuid`,
      conversationId,
      clinicId
    );

    if (!convRows || convRows.length === 0) {
      throw new NotFoundError('Conversation');
    }

    const conv = convRows[0];
    const recipientPhone = conv.patientPhone || conv.patientWhatsappId || conv.channel_conversation_id;

    let deliveryStatus: 'sent' | 'logged_locally' | 'failed' = 'logged_locally';
    let providerStatus: string = 'not_configured';
    let providerMessage = 'Message recorded in conversation history.';
    let providerMsgId = `staff_reply:${randomUUID()}`;

    if (conv.channel === 'whatsapp' && recipientPhone) {
      const sendResult = await whatsAppService.sendMessage({
        clinicId,
        toPhone: recipientPhone,
        body,
      });

      deliveryStatus = sendResult.deliveryStatus;
      providerStatus = sendResult.providerStatus;
      providerMessage = sendResult.message;
      if (sendResult.providerMessageId) {
        providerMsgId = sendResult.providerMessageId;
      }
    }

    const payload = {
      sentBy: 'clinic_staff',
      senderId: req.user?.userId,
      senderEmail: req.user?.email,
      channel: conv.channel,
      deliveryStatus,
      providerStatus,
      recipient: recipientPhone,
    };

    // Insert message into api.messages with concurrency-safe handling
    let inserted: any = null;
    let conversationDeletedConcurrently = false;
    let deliveryHistoryPreserved = false;

    try {
      const insertedRows = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO api.messages (
          clinic_id, conversation_id, direction, kind, body, provider_message_id, provider_payload, created_at
        ) VALUES (
          $1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind, $3, $4, $5::jsonb, NOW()
        ) RETURNING id, conversation_id, direction, kind, body, provider_message_id, created_at`,
        clinicId,
        conversationId,
        body,
        providerMsgId,
        JSON.stringify(payload)
      );

      inserted = insertedRows[0];

      // Update conversation last_message_at
      await prisma.$queryRawUnsafe(
        `UPDATE api.conversations
         SET last_message_at = NOW()
         WHERE id = $1::uuid AND clinic_id = $2::uuid`,
        conversationId,
        clinicId
      );
    } catch (dbErr: any) {
      // Check if conversation was deleted concurrently (foreign key violation)
      const isFkViolation =
        dbErr?.code === '23503' ||
        String(dbErr?.message).includes('messages_conversation_id_fkey') ||
        String(dbErr?.message).includes('foreign key');

      if (isFkViolation) {
        conversationDeletedConcurrently = true;
        logger.warn('Conversation deleted concurrently during outbound message dispatch', {
          conversationId,
          clinicId,
          deliveryStatus,
          providerMsgId,
        });

        // Only persist delivery record if message was actually dispatched externally to the patient
        if (deliveryStatus === 'sent' && conv.channel === 'whatsapp') {
          const fallbackNotificationId = randomUUID();
          const notifVariables = JSON.stringify({
            body,
            recipient: recipientPhone,
            channel: 'whatsapp',
            providerStatus,
            orphanReason: 'conversation_deleted_concurrently',
          });

          try {
            await prisma.$queryRawUnsafe(
              `INSERT INTO api.notifications (
                id, clinic_id, patient_id, conversation_id, kind, channel, recipient, template,
                variables, status, idempotency_key, provider_message_id, attempts, next_attempt_at, sent_at, created_at
              ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, NULL, 'staff_alert'::api.notification_kind, 'whatsapp'::api.channel_type,
                $4, 'staff_reply_orphan', $5::jsonb, 'sent'::api.delivery_status, $6, $7, 1, NOW(), NOW(), NOW()
              )`,
              fallbackNotificationId,
              clinicId,
              conv.patient_id || null,
              recipientPhone || 'unknown',
              notifVariables,
              `orphan_staff_reply:${providerMsgId}`,
              providerMsgId
            );
            deliveryHistoryPreserved = true;
          } catch (notifErr: any) {
            logger.error('CRITICAL: Failed to preserve outbound WhatsApp delivery record in api.notifications', {
              error: notifErr?.message || String(notifErr),
              clinicId,
              recipientPhone,
              providerMsgId,
            });
            deliveryHistoryPreserved = false;
          }

          inserted = {
            id: fallbackNotificationId,
            conversation_id: conversationId,
            direction: 'outbound',
            kind: 'patient_text',
            body,
            provider_message_id: providerMsgId,
            created_at: new Date().toISOString(),
          };
        } else {
          // No external message was transmitted; conversation is closed
          deliveryStatus = 'failed';
          providerMessage = 'Conversation was deleted before message could be persisted. Message was not delivered.';
        }
      } else {
        throw dbErr;
      }
    }

    // Optionally resolve pending handoff if requested and conversation is still active
    let handoffResolved = false;
    if (resolveHandoff && !conversationDeletedConcurrently) {
      const pendingHandoffs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM api.handoffs WHERE conversation_id = $1::uuid AND clinic_id = $2::uuid AND status = 'pending'`,
        conversationId,
        clinicId
      );
      if (pendingHandoffs.length > 0) {
        const handoffId = pendingHandoffs[0].id;
        await prisma.$queryRawUnsafe(
          `SELECT api.resolve_handoff($1::uuid, $2::uuid, $3::uuid, $4)`,
          clinicId,
          handoffId,
          req.user?.userId || null,
          'Replied by clinic staff'
        );
        handoffResolved = true;
      }
    }

    const resultPayload = {
      id: inserted ? inserted.id : null,
      conversationId: conversationId,
      direction: inserted ? inserted.direction : 'outbound',
      kind: inserted ? inserted.kind : 'patient_text',
      body,
      content: body,
      deliveryStatus,
      providerStatus,
      providerMessage: conversationDeletedConcurrently
        ? (deliveryStatus === 'sent'
            ? 'Message was delivered to patient via WhatsApp, but the conversation was deleted concurrently.'
            : 'Conversation was deleted before message could be sent.')
        : providerMessage,
      providerMessageId: providerMsgId,
      isStaff: true,
      createdAt: inserted
        ? (typeof inserted.created_at === 'string' ? inserted.created_at : new Date(inserted.created_at).toISOString())
        : new Date().toISOString(),
      handoffResolved,
      conversationDeletedConcurrently,
      deliveryHistoryPreserved,
    };

    if (!conversationDeletedConcurrently) {
      conversationEvents.emit(`message:${clinicId}`, {
        conversationId,
        message: resultPayload,
        lastMessageAt: resultPayload.createdAt,
        lastMessageBody: resultPayload.body,
      });
    }

    sendSuccess(
      res,
      resultPayload,
      conversationDeletedConcurrently
        ? (deliveryStatus === 'sent'
            ? 'Message sent via WhatsApp (conversation was deleted concurrently)'
            : 'Conversation deleted concurrently (message was not sent)')
        : 'Message sent successfully'
    );
  } catch (e) { next(e); }
});

const MAX_BULK_DELETE_LIMIT = 100;

/**
 * Shared controller for bulk deleting conversations.
 * Atomically deletes a selected set of conversations and their message transcripts from PostgreSQL.
 * Strict clinic/tenant isolation: every single ID in conversationIds must belong to the authenticated clinic.
 * If any ID is missing, invalid, or belongs to another clinic, the entire operation is rejected with 404 without partial deletion.
 * Preserves all patient demographic records, booked appointments, and independent clinic history.
 * Preserves appointment-linked notifications by disassociating conversation_id.
 * Dependent handoffs, conversation-specific notifications, and message transcripts are safely cleaned up.
 * Broadcasts a consolidated SSE conversation_deleted event to active clinic sessions.
 */
const handleBulkDelete = async (req: any, res: any, next: any) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const { conversationIds } = req.body || {};

    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return sendError(res, 'VALIDATION', 'conversationIds array must contain at least one conversation ID', 400);
    }

    if (conversationIds.length > MAX_BULK_DELETE_LIMIT) {
      return sendError(
        res,
        'VALIDATION',
        `Cannot delete more than ${MAX_BULK_DELETE_LIMIT} conversations in a single request`,
        400
      );
    }

    for (const id of conversationIds) {
      if (typeof id !== 'string' || !isValidUuid(id)) {
        return sendError(res, 'VALIDATION', `Invalid conversation ID format: ${id}`, 400);
      }
    }

    // Deterministically sort unique IDs in memory to enforce guaranteed ascending row-lock acquisition
    const sortedIds = Array.from(new Set(conversationIds as string[])).sort();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock and verify all selected conversations belong to this clinic in strict ascending ID order
      const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM api.conversations
         WHERE id = ANY($1::uuid[]) AND clinic_id = $2::uuid
         ORDER BY id ASC
         FOR UPDATE`,
        sortedIds,
        clinicId
      );

      // If any ID is missing or belongs to a different clinic, reject the entire request atomically
      if (existing.length !== sortedIds.length) {
        return { error: 'NOT_FOUND' as const, message: 'One or more conversations not found or inaccessible' };
      }

      // 2. Delete dependent staff handoff records belonging to these conversations
      await tx.$executeRawUnsafe(
        `DELETE FROM api.handoffs
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid`,
        sortedIds,
        clinicId
      );

      // 3. Dissociate appointment-linked notifications (preserve delivery, timestamps & audit trails)
      await tx.$executeRawUnsafe(
        `UPDATE api.notifications
         SET conversation_id = NULL
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid AND appointment_id IS NOT NULL`,
        sortedIds,
        clinicId
      );

      // 4. Delete conversation-specific notifications (where appointment_id is NULL)
      await tx.$executeRawUnsafe(
        `DELETE FROM api.notifications
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid AND appointment_id IS NULL`,
        sortedIds,
        clinicId
      );

      // 5. Delete messages transcript associated with these conversations
      await tx.$executeRawUnsafe(
        `DELETE FROM api.messages
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid`,
        sortedIds,
        clinicId
      );

      // 6. Delete the conversations permanently
      const deletedRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `DELETE FROM api.conversations
         WHERE id = ANY($1::uuid[]) AND clinic_id = $2::uuid
         RETURNING id`,
        sortedIds,
        clinicId
      );

      return { deletedRows };
    });

    if ('error' in result && result.error) {
      return sendError(res, result.error, result.message, 404);
    }

    const deletedIds = result.deletedRows.map((r) => r.id);

    // Broadcast consolidated bulk deletion event to active SSE clients
    conversationEvents.emit(`conversation:deleted:${clinicId}`, {
      conversationIds: deletedIds,
      deletedCount: deletedIds.length,
      ...(deletedIds.length === 1 ? { conversationId: deletedIds[0] } : {}),
    });

    sendSuccess(
      res,
      {
        deletedCount: deletedIds.length,
        deletedIds,
      },
      `Successfully deleted ${deletedIds.length} conversation${deletedIds.length === 1 ? '' : 's'}`
    );
  } catch (err: any) {
    logger.error('Failed to bulk delete conversations', {
      error: err?.message || String(err),
      clinicId: req.user?.clinicId,
    });
    next(err);
  }
};

/**
 * Shared controller for deleting all conversations for a clinic.
 * Atomically deletes ALL conversations belonging to the authenticated clinic.
 * Requires explicit confirm: true payload to prevent accidental invocation.
 * Strict clinic isolation: never deletes conversations belonging to other clinics.
 * Preserves all patient records, booked appointments, and independent clinic history.
 * Preserves appointment-linked notifications by disassociating conversation_id.
 * Concurrency control: locks clinic record and existing conversations to serialize concurrent deletions.
 * Broadcasts a single clinic-scoped SSE event to update active browser sessions.
 */
const handleDeleteAll = async (req: any, res: any, next: any) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const { confirm } = req.body || {};

    if (confirm !== true) {
      return sendError(
        res,
        'VALIDATION',
        'Explicit confirmation (confirm: true) is required to delete all clinic conversations',
        400
      );
    }

    const deletedIds = await prisma.$transaction(async (tx) => {
      // 1. Concurrency control: Acquire exclusive clinic lock to serialize concurrent clinic-wide deletions
      await tx.$queryRawUnsafe(
        `SELECT id FROM api.clinics WHERE id = $1::uuid FOR UPDATE`,
        clinicId
      );

      // 2. Lock and retrieve all existing conversations for this clinic in deterministic ascending order
      const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM api.conversations WHERE clinic_id = $1::uuid ORDER BY id ASC FOR UPDATE`,
        clinicId
      );

      if (existing.length === 0) {
        return [];
      }

      const allIds = existing.map((r) => r.id);

      // 3. Delete dependent staff handoff records belonging to all conversations of this clinic
      await tx.$executeRawUnsafe(
        `DELETE FROM api.handoffs
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid`,
        allIds,
        clinicId
      );

      // 4. Dissociate appointment-linked notifications (preserve delivery, timestamps & audit trails)
      await tx.$executeRawUnsafe(
        `UPDATE api.notifications
         SET conversation_id = NULL
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid AND appointment_id IS NOT NULL`,
        allIds,
        clinicId
      );

      // 5. Delete conversation-specific notifications (where appointment_id is NULL)
      await tx.$executeRawUnsafe(
        `DELETE FROM api.notifications
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid AND appointment_id IS NULL`,
        allIds,
        clinicId
      );

      // 6. Delete messages transcript associated with all conversations of this clinic
      await tx.$executeRawUnsafe(
        `DELETE FROM api.messages
         WHERE conversation_id = ANY($1::uuid[]) AND clinic_id = $2::uuid`,
        allIds,
        clinicId
      );

      // 7. Delete all conversations for this clinic permanently
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `DELETE FROM api.conversations
         WHERE id = ANY($1::uuid[]) AND clinic_id = $2::uuid
         RETURNING id`,
        allIds,
        clinicId
      );

      return rows.map((r) => r.id);
    });

    // Broadcast a single clinic-scoped bulk deletion event to active SSE clients
    conversationEvents.emit(`conversation:deleted:${clinicId}`, {
      all: true,
      deletedCount: deletedIds.length,
      deletedIds,
    });

    sendSuccess(
      res,
      {
        deletedCount: deletedIds.length,
        deletedIds,
      },
      `Successfully deleted all (${deletedIds.length}) conversations for this clinic`
    );
  } catch (err: any) {
    logger.error('Failed to delete all clinic conversations', {
      error: err?.message || String(err),
      clinicId: req.user?.clinicId,
    });
    next(err);
  }
};

/**
 * Shared controller for deleting a single conversation.
 * Permanently deletes a conversation and its message transcript from PostgreSQL.
 * Strict clinic/tenant isolation is enforced in the database query itself:
 * WHERE id = $1::uuid AND clinic_id = $2::uuid.
 * Preserves all patient records, booked appointments, and independent clinic history.
 * Preserves appointment-linked notifications by disassociating conversation_id.
 * Permanently deletes conversation-owned handoffs, notifications, and message transcripts.
 * Emits real-time SSE event to notify other clients in the same clinic.
 */
const handleDeleteSingle = async (req: any, res: any, next: any) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const conversationId = req.params.id;

    if (!isValidUuid(conversationId)) {
      return sendError(res, 'VALIDATION', 'Invalid conversation ID format', 400);
    }

    const deleted = await prisma.$transaction(async (tx) => {
      // 1. Lock conversation
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM api.conversations WHERE id = $1::uuid AND clinic_id = $2::uuid FOR UPDATE`,
        conversationId,
        clinicId
      );

      if (locked.length === 0) {
        return null;
      }

      // 2. Delete dependent staff handoff records belonging to this conversation
      await tx.$executeRawUnsafe(
        `DELETE FROM api.handoffs WHERE conversation_id = $1::uuid AND clinic_id = $2::uuid`,
        conversationId,
        clinicId
      );

      // 3. Dissociate appointment-linked notifications (preserve delivery, timestamps & audit trails)
      await tx.$executeRawUnsafe(
        `UPDATE api.notifications
         SET conversation_id = NULL
         WHERE conversation_id = $1::uuid AND clinic_id = $2::uuid AND appointment_id IS NOT NULL`,
        conversationId,
        clinicId
      );

      // 4. Delete conversation-specific notifications
      await tx.$executeRawUnsafe(
        `DELETE FROM api.notifications
         WHERE conversation_id = $1::uuid AND clinic_id = $2::uuid AND appointment_id IS NULL`,
        conversationId,
        clinicId
      );

      // 5. Delete messages transcript associated with this conversation
      await tx.$executeRawUnsafe(
        `DELETE FROM api.messages WHERE conversation_id = $1::uuid AND clinic_id = $2::uuid`,
        conversationId,
        clinicId
      );

      // 6. Delete the conversation permanently with strict clinic/tenant isolation
      const rows = await tx.$queryRawUnsafe<any[]>(
        `DELETE FROM api.conversations WHERE id = $1::uuid AND clinic_id = $2::uuid RETURNING id`,
        conversationId,
        clinicId
      );
      return rows;
    });

    if (!deleted || deleted.length === 0) {
      return sendError(res, 'NOT_FOUND', 'Conversation not found', 404);
    }

    // Broadcast conversation deletion to active SSE clients in this clinic
    conversationEvents.emit(`conversation:deleted:${clinicId}`, {
      conversationId,
    });

    sendSuccess(res, { id: conversationId, deleted: true }, 'Conversation deleted successfully');
  } catch (err: any) {
    logger.error('Failed to delete conversation', {
      error: err?.message || String(err),
      clinicId: req.user?.clinicId,
      conversationId: req.params.id,
    });
    next(err);
  }
};

// Route registrations: direct controller assignment with RBAC middleware
// 1. Bulk delete endpoints (POST and DELETE aliases with identical RBAC and handler)
conversationsRouter.post('/bulk-delete', requireRole('admin', 'clinic_admin'), handleBulkDelete);
conversationsRouter.delete('/bulk-delete', requireRole('admin', 'clinic_admin'), handleBulkDelete);

// 2. Delete-all endpoints (POST and DELETE aliases with explicit confirm: true and RBAC)
conversationsRouter.post('/delete-all', requireRole('admin', 'clinic_admin'), handleDeleteAll);
conversationsRouter.delete('/delete-all', requireRole('admin', 'clinic_admin'), handleDeleteAll);

// 3. Single conversation delete: DELETE /:id with RBAC
conversationsRouter.delete('/:id', requireRole('admin', 'clinic_admin'), handleDeleteSingle);

