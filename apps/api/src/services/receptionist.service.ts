/**
 * Dental AI Receptionist Service
 *
 * Fully autonomous, resilient, clinic-scoped conversational engine:
 * - Direct execution path inside the API service (eliminates single point of failure on external orchestrators).
 * - Multi-tenant isolation: strictly loads clinic context, business hours, services, and settings from database.
 * - Authoritative fail-closed receptionist enabled / pause guard: routes to staff handoff immediately when paused.
 * - Semantic intent extraction with deterministic fallback for greetings, FAQs, and appointment actions.
 * - Dynamic tone adjustment (professional, empathetic, concise).
 * - Outbound delivery guard: dispatches live WhatsApp messages only when integration is enabled and valid,
 *   otherwise safely logs to chart (Safe Test Mode).
 * - Real-time SSE event emission to synchronize web dashboard instantly.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../database/prisma/client';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { whatsAppService } from './whatsapp.service';
import { resolveReceptionistEnabled } from '../modules/receptionist-settings/receptionist.routes';
import { conversationEvents } from '../modules/conversations/conversations.routes';

export interface ProcessInboundMessageParams {
  clinicId: string;
  channel: 'whatsapp' | 'web_chat' | 'sms' | 'voice';
  senderPhone: string;
  senderName?: string;
  messageText: string;
  providerEventId: string;
  inboundEventId?: string;
  rawPayload?: any;
}

export interface ReceptionistProcessResult {
  ok: boolean;
  code: string;
  action: string;
  reply: string | null;
  patientId?: string;
  conversationId?: string;
  outboundMessageId?: string;
  providerMessageId?: string;
  deliveryStatus: 'sent' | 'logged_locally' | 'suppressed' | 'failed';
  suppressed?: boolean;
  reason?: string;
}

export class ReceptionistService {
  /**
   * Main entry point to process an incoming patient message
   */
  async processInboundMessage(params: ProcessInboundMessageParams): Promise<ReceptionistProcessResult> {
    const { clinicId, channel, senderPhone, senderName, messageText, providerEventId, inboundEventId, rawPayload } = params;

    const trimmedMsg = (messageText || '').trim();

    logger.info('Processing inbound message for receptionist', {
      clinicId,
      channel,
      senderPhone: senderPhone ? `${senderPhone.slice(0, 4)}...${senderPhone.slice(-3)}` : 'unknown',
      providerEventId,
    });

    // 1. Fetch Authoritative Clinic Context & Settings
    const clinicRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, slug, timezone, locale, active, suspended_at, settings
       FROM api.clinics WHERE id = $1::uuid`,
      clinicId
    );

    if (!clinicRows || clinicRows.length === 0) {
      logger.warn('Clinic not found for inbound message processing', { clinicId });
      return {
        ok: false,
        code: 'CLINIC_NOT_FOUND',
        action: 'reject',
        reply: null,
        deliveryStatus: 'failed',
        reason: 'Clinic not found',
      };
    }

    const clinic = clinicRows[0];
    const isClinicActive = Boolean(clinic.active === true && !clinic.suspended_at);
    if (!isClinicActive) {
      logger.warn('Inbound message received for inactive or suspended clinic', { clinicId });
      return {
        ok: false,
        code: 'CLINIC_INACTIVE',
        action: 'reject',
        reply: null,
        deliveryStatus: 'suppressed',
        reason: 'Clinic is inactive or suspended',
      };
    }

    const settings = clinic.settings || {};
    const receptionistEnabled = resolveReceptionistEnabled(settings);

    // 2. Resolve or Create Patient
    let patientId: string | null = null;
    try {
      const patientRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT api.find_or_create_patient($1::uuid, $2, NULLIF($3, ''), NULL, NULLIF($4, '')) AS fn;`,
        clinicId,
        senderName || 'Patient',
        senderPhone,
        senderPhone
      );
      patientId = patientRes[0]?.fn?.data?.patient_id || null;
    } catch (err: any) {
      logger.warn('Could not resolve or create patient via find_or_create_patient', { error: err.message, clinicId });
    }

    // 3. Resolve or Create Conversation
    let conversationId: string | null = null;
    try {
      const convRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT api.get_or_create_conversation($1::uuid, $2::api.channel_type, $3::text, $4::uuid, '24 hours'::interval, false) AS fn;`,
        clinicId,
        channel,
        senderPhone,
        patientId
      );
      conversationId = convRes[0]?.fn?.data?.conversation_id || null;
    } catch (err: any) {
      logger.warn('Could not get or create conversation', { error: err.message, clinicId });
    }

    // Fallback if conversation stored proc fails
    if (!conversationId) {
      const existingConv = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM api.conversations WHERE clinic_id = $1::uuid AND channel_conversation_id = $2 LIMIT 1`,
        clinicId,
        senderPhone
      );
      if (existingConv && existingConv.length > 0) {
        conversationId = existingConv[0].id;
      } else {
        const newConv = await prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO api.conversations (clinic_id, patient_id, channel, channel_conversation_id, state, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::api.channel_type, $4, '{}'::jsonb, NOW(), NOW())
           RETURNING id`,
          clinicId,
          patientId,
          channel,
          senderPhone
        );
        conversationId = newConv[0]?.id || null;
      }
    }

    // 4. Persist Inbound Message to api.messages
    if (conversationId) {
      try {
        await prisma.$queryRawUnsafe(
          `INSERT INTO api.messages (
            clinic_id, conversation_id, direction, kind, body, provider_message_id, provider_payload, created_at
          ) VALUES (
            $1::uuid, $2::uuid, 'inbound'::api.message_direction, 'patient_text'::api.message_kind,
            $3, $4, $5::jsonb, NOW()
          )
          ON CONFLICT (conversation_id, provider_message_id) DO NOTHING`,
          clinicId,
          conversationId,
          trimmedMsg,
          providerEventId,
          JSON.stringify(rawPayload || { senderPhone, senderName })
        );

        // Update last_message_at
        await prisma.$queryRawUnsafe(
          `UPDATE api.conversations SET last_message_at = NOW() WHERE id = $1::uuid`,
          conversationId
        );
      } catch (err: any) {
        logger.warn('Error recording inbound message in api.messages', { error: err.message });
      }
    }

    // 5. PAUSED GUARD: Fail-closed check
    if (!receptionistEnabled) {
      logger.info('Receptionist is PAUSED for clinic. Routing to staff handoff.', { clinicId });

      if (conversationId) {
        // Create staff handoff record
        const handoffReason = 'Automated receptionist paused — patient message routed to human staff';
        const handoffCtx = JSON.stringify({ message: trimmedMsg, paused: true, source: 'early_pause_guard' });

        try {
          await prisma.$queryRawUnsafe(
            `INSERT INTO api.handoffs (
              clinic_id, conversation_id, patient_id, reason, priority, status, context, created_at
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $4, 'normal'::api.handoff_priority, 'pending'::api.handoff_status, $5::jsonb, NOW()
            )`,
            clinicId,
            conversationId,
            patientId,
            handoffReason,
            handoffCtx
          );
        } catch (err: any) {
          logger.warn('Error creating staff handoff for paused receptionist', { error: err.message });
        }
      }

      // Mark inbound event as processed
      if (inboundEventId) {
        try {
          await prisma.$queryRawUnsafe(
            `UPDATE api.inbound_events SET state = 'processed'::api.event_state, processed_at = NOW() WHERE id = $1::uuid`,
            inboundEventId
          );
        } catch {
          // ignore
        }
      }

      return {
        ok: true,
        code: 'RECEPTIONIST_PAUSED',
        action: 'handoff',
        reply: null,
        patientId: patientId || undefined,
        conversationId: conversationId || undefined,
        deliveryStatus: 'suppressed',
        suppressed: true,
        reason: 'receptionist_paused',
      };
    }

    // 6. Receptionist is ACTIVE: Resolve Services, Business Hours, and Intent
    let servicesRows: any[] = [];
    try {
      servicesRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, name, code, price, currency, duration_minutes, description
         FROM api.services WHERE clinic_id = $1::uuid AND active = true ORDER BY name ASC`,
        clinicId
      );
    } catch {
      servicesRows = [];
    }

    let hoursRows: any[] = [];
    try {
      hoursRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT day_of_week, opens_at, closes_at
         FROM api.business_hours WHERE clinic_id = $1::uuid ORDER BY day_of_week ASC`,
        clinicId
      );
    } catch {
      hoursRows = [];
    }

    let dentistsRows: any[] = [];
    try {
      dentistsRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, first_name, last_name, display_name, title, specialties
         FROM api.dentists WHERE clinic_id = $1::uuid AND active = true`,
        clinicId
      );
    } catch {
      dentistsRows = [];
    }

    // 7. Extract Intent & Entities (Deterministic + Gemini if configured)
    const intentResult = await this.extractIntent(trimmedMsg, {
      clinicName: clinic.name,
      services: servicesRows,
      dentists: dentistsRows,
    });

    // 8. Compose Clinic-Specific Reply
    const composedReply = this.composeReply({
      intent: intentResult.intent,
      message: trimmedMsg,
      clinic,
      settings,
      services: servicesRows,
      hours: hoursRows,
      dentists: dentistsRows,
    });

    // 9. Check Outbound Dispatch Authorization & Send Message
    const integration = await whatsAppService.getClinicIntegration(clinicId);
    const isIntegrationActive = Boolean(integration && integration.enabled && integration.status === 'valid');

    let deliveryStatus: 'sent' | 'logged_locally' | 'failed' = 'logged_locally';
    let providerMsgId: string = `receptionist_reply:${uuidv4()}`;

    if (channel === 'whatsapp' && senderPhone && composedReply) {
      if (isIntegrationActive) {
        // Live Mode: Dispatch via Meta WhatsApp Cloud API
        const sendResult = await whatsAppService.sendMessage({
          clinicId,
          toPhone: senderPhone,
          body: composedReply,
        });

        deliveryStatus = sendResult.deliveryStatus;
        if (sendResult.providerMessageId) {
          providerMsgId = sendResult.providerMessageId;
        }
      } else {
        // Safe Test Mode: Suppress external dispatch, record in patient chart
        deliveryStatus = 'logged_locally';
        logger.info('Safe test mode active: Outbound reply recorded in patient chart without external send', {
          clinicId,
          integrationStatus: integration?.status || 'unconfigured',
        });
      }
    }

    // 10. Record Outbound Reply in api.messages
    let outboundMessageId: string | undefined;
    if (conversationId && composedReply) {
      try {
        const outMsgRows = await prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO api.messages (
            clinic_id, conversation_id, direction, kind, body, provider_message_id, provider_payload, created_at
          ) VALUES (
            $1::uuid, $2::uuid, 'outbound'::api.message_direction, 'patient_text'::api.message_kind,
            $3, $4, $5::jsonb, NOW()
          ) RETURNING id`,
          clinicId,
          conversationId,
          composedReply,
          providerMsgId,
          JSON.stringify({
            sentBy: 'ai_receptionist',
            intent: intentResult.intent,
            deliveryStatus,
            recipient: senderPhone,
          })
        );
        outboundMessageId = outMsgRows[0]?.id;

        // Update conversation last_message_at
        await prisma.$queryRawUnsafe(
          `UPDATE api.conversations SET last_message_at = NOW() WHERE id = $1::uuid`,
          conversationId
        );

        // Emit real-time SSE event to live-updating browser clients
        const formattedMsg = {
          id: outboundMessageId,
          conversationId,
          direction: 'outbound',
          kind: 'patient_text',
          body: composedReply,
          content: composedReply,
          providerMessageId: providerMsgId,
          isStaff: false,
          deliveryStatus,
          createdAt: new Date().toISOString(),
        };

        conversationEvents.emit(`message:${clinicId}`, {
          conversationId,
          message: formattedMsg,
          lastMessageAt: new Date().toISOString(),
          lastMessageBody: composedReply,
        });
      } catch (err: any) {
        logger.warn('Failed to insert outbound reply message into api.messages', { error: err.message });
      }
    }

    // 11. Mark Inbound Event as Processed
    if (inboundEventId) {
      try {
        await prisma.$queryRawUnsafe(
          `UPDATE api.inbound_events SET state = 'processed'::api.event_state, processed_at = NOW() WHERE id = $1::uuid`,
          inboundEventId
        );
      } catch {
        // Safe catch for mocked or non-existent rows
      }
    }

    return {
      ok: true,
      code: 'OK',
      action: intentResult.intent,
      reply: composedReply,
      patientId: patientId || undefined,
      conversationId: conversationId || undefined,
      outboundMessageId,
      providerMessageId: providerMsgId,
      deliveryStatus,
    };
  }

  /**
   * Deterministic + Gemini intent classification
   */
  private async extractIntent(
    message: string,
    context: { clinicName: string; services: any[]; dentists: any[] }
  ): Promise<{ intent: string; confidence: number }> {
    const text = (message || '').trim().toLowerCase();

    // 1. Deterministic social & quick regex classifiers
    const pureGreetingRegex = /^(hi|hii+|hello|hey|heyy+|good morning|good afternoon|good evening|morning|afternoon|evening|greetings|hiya|howdy)[!.]*$/i;
    const pureThanksRegex = /^(thanks|thank you|thx|thank you so much)[!.]*$/i;
    const pureGoodbyeRegex = /^(bye|goodbye|see you|cya|have a good day)[!.]*$/i;

    if (pureGreetingRegex.test(text)) return { intent: 'greeting', confidence: 1.0 };
    if (pureThanksRegex.test(text)) return { intent: 'thanks', confidence: 1.0 };
    if (pureGoodbyeRegex.test(text)) return { intent: 'goodbye', confidence: 1.0 };

    if (/human|agent|receptionist|staff|real person|speak with someone/i.test(text)) {
      return { intent: 'handoff', confidence: 0.95 };
    }

    if (/cancel/i.test(text)) {
      return { intent: 'cancel_appointment', confidence: 0.9 };
    }

    if (/reschedule|move|change.*time/i.test(text)) {
      return { intent: 'reschedule_appointment', confidence: 0.9 };
    }

    if (/available|opening|when.*open|slot/i.test(text)) {
      return { intent: 'check_availability', confidence: 0.9 };
    }

    if (/book|appointment|schedule|cleaning|checkup|filling/i.test(text)) {
      return { intent: 'book_appointment', confidence: 0.85 };
    }

    if (/hour|open|close|timing/i.test(text)) {
      return { intent: 'faq_hours', confidence: 0.9 };
    }

    if (/price|cost|how much|fee/i.test(text)) {
      return { intent: 'faq_pricing', confidence: 0.9 };
    }

    if (/insurance|coverage|copay|medicaid|cigna|delta/i.test(text)) {
      return { intent: 'faq_insurance', confidence: 0.9 };
    }

    if (/emergency|pain|broken tooth|severe|bleeding/i.test(text)) {
      return { intent: 'faq_emergency', confidence: 0.95 };
    }

    // 2. If Gemini API Key is provided, call Gemini for complex classification
    const geminiKey = process.env.GEMINI_API_KEY || (env as any).GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        const prompt = `Classify this dental patient message into one intent (greeting, check_availability, book_appointment, lookup_appointment, cancel_appointment, reschedule_appointment, faq_hours, faq_services, faq_pricing, faq_insurance, faq_emergency, handoff, unclear): "${message}". Return JSON only: {"intent": string, "confidence": number}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data: any = await res.json();
          const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (parsed.intent) {
              return { intent: parsed.intent, confidence: parsed.confidence || 0.8 };
            }
          }
        }
      } catch {
        // Graceful fallback to deterministic
      }
    }

    return { intent: 'clarify', confidence: 0.5 };
  }

  /**
   * Composes clinic-specific reply following preferences, tone, and services
   */
  private composeReply(ctx: {
    intent: string;
    message: string;
    clinic: any;
    settings: any;
    services: any[];
    hours: any[];
    dentists: any[];
  }): string {
    const { intent, clinic, settings, services, hours } = ctx;
    const clinicName = clinic.name || 'our clinic';
    const s = settings || {};
    const r = (s.receptionist && typeof s.receptionist === 'object') ? s.receptionist : {};

    const greetingMsg = s.greeting_message || r.welcomeMessage || r.greeting_message ||
      `Hello! Welcome to ${clinicName}. How can I assist you today?`;

    const emergencyPhone = s.emergency_phone || r.emergency_phone || r.emergencyPhone;
    const acceptedInsurance = s.accepted_insurance || r.accepted_insurance || r.acceptedInsurance;
    const cancellationPolicy = s.cancellation_policy || r.cancellation_policy || r.cancellationPolicy;
    const reschedulingPolicy = s.rescheduling_policy || r.rescheduling_policy || r.reschedulingPolicy;

    let baseReply = '';

    switch (intent) {
      case 'greeting':
        baseReply = greetingMsg;
        break;

      case 'thanks':
        baseReply = `You're very welcome! Please let us know if there is anything else ${clinicName} can do for you.`;
        break;

      case 'goodbye':
        baseReply = `Goodbye! Have a wonderful day, and we look forward to seeing you at ${clinicName}.`;
        break;

      case 'faq_hours': {
        if (hours && hours.length > 0) {
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const schedule = hours.map((h: any) => `${days[h.day_of_week]}: ${h.opens_at?.slice(0, 5)} - ${h.closes_at?.slice(0, 5)}`).join(', ');
          baseReply = `${clinicName}'s hours of operation are: ${schedule}.`;
        } else {
          baseReply = `${clinicName} is generally open Monday through Friday, 9:00 AM to 5:00 PM.`;
        }
        break;
      }

      case 'faq_services': {
        if (services && services.length > 0) {
          const serviceNames = services.map((x: any) => x.name).join(', ');
          baseReply = `At ${clinicName}, we offer: ${serviceNames}. Would you like to schedule an appointment for any of these?`;
        } else {
          baseReply = `We offer comprehensive dental examinations, hygiene cleanings, fillings, and general oral health care.`;
        }
        break;
      }

      case 'faq_pricing': {
        if (services && services.length > 0) {
          const pricingList = services.slice(0, 3).map((x: any) => `${x.name} ($${x.price})`).join(', ');
          baseReply = `Our typical rates include: ${pricingList}. Please contact us for specific treatment plans and insurance coverage.`;
        } else {
          baseReply = `Our treatment pricing depends on the specific dental procedure and insurance coverage. We would be happy to discuss details with you!`;
        }
        break;
      }

      case 'faq_insurance': {
        if (acceptedInsurance) {
          baseReply = `Our clinic accepts the following insurance plans: ${acceptedInsurance}. We also accept credit/debit cards and cash.`;
        } else {
          baseReply = `We accept most major dental PPO insurance plans. Please provide your provider name so we can verify your coverage.`;
        }
        break;
      }

      case 'faq_emergency': {
        if (emergencyPhone) {
          baseReply = `If you are experiencing a severe dental emergency, please call our emergency hotline immediately at ${emergencyPhone}. If it is a life-threatening medical emergency, please call 911.`;
        } else {
          baseReply = `If you have severe dental pain or an emergency, please visit our clinic during opening hours or call us directly. If you are experiencing difficulty breathing or severe swelling, please seek urgent emergency medical care immediately.`;
        }
        break;
      }

      case 'cancel_appointment': {
        const policyNote = cancellationPolicy ? ` Please note our cancellation policy: ${cancellationPolicy}.` : '';
        baseReply = `I can help you cancel your appointment.${policyNote} Could you please provide your appointment confirmation code or full name?`;
        break;
      }

      case 'reschedule_appointment': {
        const policyNote = reschedulingPolicy ? ` (${reschedulingPolicy})` : '';
        baseReply = `I would be happy to help you reschedule your appointment.${policyNote} What new day and time would work best for you?`;
        break;
      }

      case 'check_availability':
      case 'book_appointment': {
        baseReply = `I would be delighted to assist you with booking an appointment at ${clinicName}. Which service are you looking for (e.g., Routine Cleaning, Exam, Filling), and what day or time works best for you?`;
        break;
      }

      case 'handoff':
        baseReply = `I am connecting you with our human team right now. A member of our staff will assist you shortly.`;
        break;

      case 'clarify':
      default:
        baseReply = `I would be glad to help you. I can assist with scheduling appointments, checking clinic hours, pricing, insurance, or connecting you with our front desk team. How can I help you today?`;
        break;
    }

    // Apply Tone
    const tone = (s.tone || r.tone || 'professional').toLowerCase();
    return this.applyTone(baseReply, tone, intent);
  }

  /**
   * Applies the clinic's configured tone (professional, empathetic, concise)
   */
  private applyTone(text: string, tone: string, action: string): string {
    if (!text || action === 'greeting' || action === 'handoff') return text;

    if (tone === 'concise') {
      let s = text;
      s = s.replace(/^(I would be delighted to assist you with |I would be happy to help you |I would be glad to help you[.] )/i, '');
      s = s.replace(/What new day and time would work best for you\?/i, 'Which day and time works for you?');
      return s.trim();
    }

    if (tone === 'empathetic') {
      if (action === 'faq_emergency') {
        return `We are so sorry to hear you are dealing with dental discomfort. ${text}`;
      }
      return `We are here to take great care of you! ${text}`;
    }

    return text;
  }
}

export const receptionistService = new ReceptionistService();
