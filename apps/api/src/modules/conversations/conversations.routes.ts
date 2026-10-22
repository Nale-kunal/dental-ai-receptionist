import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';
import { NotFoundError } from '../../middleware/errors/errorHandler';
import { DEFAULT_PAGE_SIZE } from '@dental/shared';
import { whatsAppService } from '../../services/whatsapp.service';

export const conversationsRouter = Router();
conversationsRouter.use(authenticate);

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

    // Insert message into api.messages
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

    const inserted = insertedRows[0];

    // Update conversation last_message_at
    await prisma.$queryRawUnsafe(
      `UPDATE api.conversations
       SET last_message_at = NOW()
       WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      conversationId,
      clinicId
    );

    // Optionally resolve pending handoff if requested
    let handoffResolved = false;
    if (resolveHandoff) {
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

    sendSuccess(res, {
      id: inserted.id,
      conversationId: inserted.conversation_id,
      direction: inserted.direction,
      kind: inserted.kind,
      body: inserted.body,
      content: inserted.body,
      deliveryStatus,
      providerStatus,
      providerMessage,
      createdAt: new Date(inserted.created_at).toISOString(),
      handoffResolved,
    }, 'Message sent successfully');
  } catch (e) { next(e); }
});
