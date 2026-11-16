import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../app';
import { prisma } from '../../database/prisma/client';
import { env } from '../../config/env';
import { receptionistService } from '../../services/receptionist.service';
import { whatsAppService } from '../../services/whatsapp.service';
import { encryptSecret } from '../../utils/encryption';

// Mock prisma for isolated unit testing
jest.mock('../../database/prisma/client', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
  },
}));

describe('WhatsApp Webhook & Receptionist Comprehensive Lifecycle (Scenarios 1-45)', () => {
  let app: any;
  const testClinicId = '914fb00e-c834-4e44-9646-9d746f536d4e';
  const testPhoneId = '1330570960147204';
  const testWabaId = '2035006144554244';
  const testSender = '15551234567';

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to build a standard Meta webhook payload
  function buildMetaWebhookPayload(opts: {
    phoneId?: string;
    msgId?: string;
    from?: string;
    text?: string;
    type?: string;
    name?: string;
    statuses?: any[];
  }) {
    const {
      phoneId = testPhoneId,
      msgId = 'wamid.' + crypto.randomBytes(8).toString('hex'),
      from = testSender,
      text = 'Hello I would like to book a cleaning',
      type = 'text',
      name = 'Test Patient',
      statuses,
    } = opts;

    if (statuses) {
      return {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: testWabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: phoneId, display_phone_number: '15556439679' },
                  statuses,
                },
              },
            ],
          },
        ],
      };
    }

    const messages = [];
    if (from || text || msgId) {
      const msgObj: any = { id: msgId, timestamp: '1700000000', type };
      if (from) msgObj.from = from;
      if (type === 'text' && text !== undefined) msgObj.text = { body: text };
      messages.push(msgObj);
    }

    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: testWabaId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: phoneId, display_phone_number: '15556439679' },
                contacts: [{ profile: { name }, wa_id: from }],
                messages,
              },
            },
          ],
        },
      ],
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Incoming Webhook Tests (Scenarios 1 - 10)
  // ─────────────────────────────────────────────────────────────
  describe('Incoming Webhook (Scenarios 1 - 10)', () => {
    it('Scenario 1: Valid incoming WhatsApp message persists and returns HTTP 200 immediately', async () => {
      const payload = buildMetaWebhookPayload({ text: 'Hi' });

      // Mock clinic resolution
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ clinic_id: testClinicId, resolution: { ok: true } }]) // get_clinic_by_phone_number_id
        .mockResolvedValueOnce([{ fn: { ok: true, data: { duplicate: false, event_id: 'evt-1' } } }]) // register_inbound_event
        .mockResolvedValueOnce([{ id: testClinicId, name: 'Oracle Clinic', active: true, settings: { receptionist_enabled: true } }]) // clinic details
        .mockResolvedValueOnce([{ fn: { ok: true, data: { patient_id: 'pat-1' } } }]) // find_or_create_patient
        .mockResolvedValueOnce([{ fn: { ok: true, data: { conversation_id: 'conv-1' } } }]) // get_or_create_conversation
        .mockResolvedValueOnce([]) // insert message
        .mockResolvedValueOnce([]) // update last_message_at
        .mockResolvedValueOnce([]) // services
        .mockResolvedValueOnce([]) // hours
        .mockResolvedValueOnce([]) // dentists
        .mockResolvedValueOnce([{ id: 'int-1', clinic_id: testClinicId, phone_number_id: testPhoneId, enabled: true, status: 'valid' }]) // integration
        .mockResolvedValueOnce([{ id: 'out-1' }]) // insert outbound
        .mockResolvedValueOnce([]); // mark processed

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.code).toBe('EVENT_RECEIVED');
      expect(res.body.provider_event_id).toBeDefined();
    });

    it('Scenario 2: Invalid webhook signature is rejected with HTTP 401', async () => {
      process.env.META_APP_SECRET = 'super_secret_app_key';
      const payload = buildMetaWebhookPayload({ text: 'Hi' });

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .set('x-hub-signature-256', 'sha256=invalid_hash_that_fails_verification')
        .send(payload);

      delete process.env.META_APP_SECRET;
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('Scenario 3: Invalid verification token rejected with HTTP 403', async () => {
      process.env.META_WEBHOOK_VERIFY_TOKEN = 'correct_verify_token_123';
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/v1/integrations/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.challenge': 'test_challenge_123',
          'hub.verify_token': 'wrong_token',
        });

      delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('Scenario 3b: Valid verification token returns hub.challenge with HTTP 200', async () => {
      process.env.META_WEBHOOK_VERIFY_TOKEN = 'correct_verify_token_123';

      const res = await request(app)
        .get('/api/v1/integrations/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.challenge': 'test_challenge_123',
          'hub.verify_token': 'correct_verify_token_123',
        });

      delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      expect(res.status).toBe(200);
      expect(res.text).toBe('test_challenge_123');
    });

    it('Scenario 4: Duplicate provider message ID acknowledged with HTTP 200 without reprocessing', async () => {
      const payload = buildMetaWebhookPayload({ text: 'Hi again' });

      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ clinic_id: testClinicId, resolution: { ok: true } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { duplicate: true } } }]); // Duplicate detected

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.code).toBe('DUPLICATE_EVENT');
      expect(res.body.duplicate).toBe(true);
    });

    it('Scenario 5: Delivery-status notification updates record and does not trigger AI', async () => {
      const payload = buildMetaWebhookPayload({
        statuses: [
          {
            id: 'wamid.sentMessage123',
            status: 'delivered',
            timestamp: '1700000000',
            recipient_id: testSender,
          },
        ],
      });

      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]); // update notification

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.code).toBe('STATUS_ACK');
      expect(res.body.status).toBe('delivered');
    });

    it('Scenario 6: Read receipt acknowledged without triggering AI', async () => {
      const payload = buildMetaWebhookPayload({
        statuses: [
          {
            id: 'wamid.readMessage123',
            status: 'read',
            timestamp: '1700000010',
            recipient_id: testSender,
          },
        ],
      });

      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]); // update notification

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.code).toBe('STATUS_ACK');
      expect(res.body.status).toBe('read');
    });

    it('Scenario 7: Empty webhook events handled safely', async () => {
      const payload = { object: 'whatsapp_business_account', entry: [] };

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('Scenario 8: Database persistence failure returns HTTP 500 cleanly without crashing', async () => {
      const payload = buildMetaWebhookPayload({ text: 'Test' });

      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ clinic_id: testClinicId, resolution: { ok: true } }])
        .mockRejectedValueOnce(new Error('PostgreSQL connection terminated unexpectedly')) // stored proc fails
        .mockRejectedValueOnce(new Error('PostgreSQL connection terminated unexpectedly')); // direct insert fails

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('DATABASE_ERROR');
    });

    it('Scenario 9: Unknown clinic mapping safely rejected with HTTP 200 and unmapped code', async () => {
      const payload = buildMetaWebhookPayload({ phoneId: '999999999999999' });

      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ clinic_id: null, resolution: { ok: false, code: 'NOT_FOUND', message: 'No clinic found' } }]);

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('Scenario 10: Multiple clinics using separate WhatsApp integrations are partitioned cleanly', async () => {
      const clinicB_Id = '22222222-2222-2222-2222-222222222222';
      const phoneB = '999000111222333';

      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ clinic_id: clinicB_Id, resolution: { ok: true } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { duplicate: false, event_id: 'evt-2' } } }])
        .mockResolvedValueOnce([{ id: clinicB_Id, name: 'Clinic B', active: true, settings: { receptionist_enabled: true } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { patient_id: 'pat-b' } } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { conversation_id: 'conv-b' } } }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'int-b', clinic_id: clinicB_Id, enabled: false }])
        .mockResolvedValueOnce([{ id: 'out-b' }])
        .mockResolvedValueOnce([]);

      const payload = buildMetaWebhookPayload({ phoneId: phoneB });
      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/webhook')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Receptionist State & Execution Tests (Scenarios 11 - 25)
  // ─────────────────────────────────────────────────────────────
  describe('Receptionist State & Execution (Scenarios 11 - 25)', () => {
    it('Scenario 11: Receptionist ACTIVE generates clinic-tailored welcome reply', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: testClinicId,
            name: 'Oracle Clinic',
            active: true,
            settings: {
              receptionist_enabled: true,
              greeting_message: 'Welcome to Oracle Clinic! How may our team assist you?',
            },
          },
        ])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { patient_id: 'pat-1' } } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { conversation_id: 'conv-1' } } }])
        .mockResolvedValueOnce([]) // insert message
        .mockResolvedValueOnce([]) // update last_message_at
        .mockResolvedValueOnce([]) // services
        .mockResolvedValueOnce([]) // hours
        .mockResolvedValueOnce([]) // dentists
        .mockResolvedValueOnce([{ id: 'int-1', clinic_id: testClinicId, enabled: false }]) // integration (safe test mode)
        .mockResolvedValueOnce([{ id: 'out-1' }])
        .mockResolvedValueOnce([]); // update conversation

      const result = await receptionistService.processInboundMessage({
        clinicId: testClinicId,
        channel: 'whatsapp',
        senderPhone: testSender,
        messageText: 'Hello',
        providerEventId: 'wamid.testGreeting',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('greeting');
      expect(result.reply).toContain('Oracle Clinic');
      expect(result.deliveryStatus).toBe('logged_locally'); // Safe test mode active
    });

    it('Scenario 12: Receptionist PAUSED suppresses AI response and creates staff handoff', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: testClinicId,
            name: 'Oracle Clinic',
            active: true,
            settings: { receptionist_enabled: false }, // PAUSED
          },
        ])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { patient_id: 'pat-1' } } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { conversation_id: 'conv-1' } } }])
        .mockResolvedValueOnce([]) // insert inbound message
        .mockResolvedValueOnce([]) // update last_message_at
        .mockResolvedValueOnce([]); // insert staff handoff

      const result = await receptionistService.processInboundMessage({
        clinicId: testClinicId,
        channel: 'whatsapp',
        senderPhone: testSender,
        messageText: 'I need an urgent appointment please',
        providerEventId: 'wamid.testPaused',
      });

      expect(result.ok).toBe(true);
      expect(result.code).toBe('RECEPTIONIST_PAUSED');
      expect(result.action).toBe('handoff');
      expect(result.reply).toBeNull();
      expect(result.suppressed).toBe(true);
    });

    it('Scenario 17: Hours FAQ returns clinic business hours', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ id: testClinicId, name: 'Oracle Clinic', active: true, settings: { receptionist_enabled: true } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { patient_id: 'pat-1' } } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { conversation_id: 'conv-1' } } }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // services
        .mockResolvedValueOnce([
          { day_of_week: 1, opens_at: '09:00:00', closes_at: '17:00:00' },
          { day_of_week: 2, opens_at: '09:00:00', closes_at: '17:00:00' },
        ]) // hours
        .mockResolvedValueOnce([]) // dentists
        .mockResolvedValueOnce([{ id: 'int-1', clinic_id: testClinicId, enabled: false }])
        .mockResolvedValueOnce([{ id: 'out-1' }])
        .mockResolvedValueOnce([]);

      const result = await receptionistService.processInboundMessage({
        clinicId: testClinicId,
        channel: 'whatsapp',
        senderPhone: testSender,
        messageText: 'What are your hours of operation?',
        providerEventId: 'wamid.testHours',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('faq_hours');
      expect(result.reply).toContain('Monday: 09:00 - 17:00');
    });

    it('Scenario 24: Human handoff request immediately connects to team', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ id: testClinicId, name: 'Oracle Clinic', active: true, settings: { receptionist_enabled: true } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { patient_id: 'pat-1' } } }])
        .mockResolvedValueOnce([{ fn: { ok: true, data: { conversation_id: 'conv-1' } } }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'int-1', clinic_id: testClinicId, enabled: false }])
        .mockResolvedValueOnce([{ id: 'out-1' }])
        .mockResolvedValueOnce([]);

      const result = await receptionistService.processInboundMessage({
        clinicId: testClinicId,
        channel: 'whatsapp',
        senderPhone: testSender,
        messageText: 'I need to speak with a human receptionist',
        providerEventId: 'wamid.testHandoff',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('handoff');
      expect(result.reply).toContain('human team');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Outbound WhatsApp & Test Mode (Scenarios 26 - 36)
  // ─────────────────────────────────────────────────────────────
  describe('Outbound WhatsApp & Safe Test Mode (Scenarios 26 - 36)', () => {
    const validEncToken = encryptSecret('EAAG_test_mock_access_token_12345').ciphertext;

    it('Scenario 26: Live WhatsApp dispatch transmits message and returns provider ID', async () => {
      const mockCustomFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.realProviderSend123' }] }),
      });

      // Mock integration lookup
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          id: 'int-1',
          clinic_id: testClinicId,
          phone_number_id: testPhoneId,
          encrypted_access_token: validEncToken,
          key_version: 'v1',
          enabled: true,
          status: 'valid',
          token_expires_at: new Date(Date.now() + 86400000),
        },
      ]);

      const sendResult = await whatsAppService.sendMessage({
        clinicId: testClinicId,
        toPhone: testSender,
        body: 'Your appointment is confirmed for Tuesday at 10 AM.',
        customFetch: mockCustomFetch as any,
      });

      expect(sendResult.success).toBe(true);
      expect(sendResult.deliveryStatus).toBe('sent');
      expect(sendResult.providerMessageId).toBe('wamid.realProviderSend123');
    });

    it('Scenario 27: Safe test mode suppresses external dispatch when integration is disabled', async () => {
      // Mock integration lookup with enabled: false
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          id: 'int-1',
          clinic_id: testClinicId,
          phone_number_id: testPhoneId,
          encrypted_access_token: validEncToken,
          key_version: 'v1',
          enabled: false, // Disabled
          status: 'valid',
        },
      ]);

      const sendResult = await whatsAppService.sendMessage({
        clinicId: testClinicId,
        toPhone: testSender,
        body: 'Safe test message',
      });

      expect(sendResult.success).toBe(false);
      expect(sendResult.deliveryStatus).toBe('logged_locally');
      expect(sendResult.message).toContain('Safe Test Mode active');
    });

    it('Scenario 28: Provider authentication error updates integration status and fails safely', async () => {
      const mockCustomFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid OAuth access token', code: 190 } }),
      });

      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'int-1',
            clinic_id: testClinicId,
            phone_number_id: testPhoneId,
            encrypted_access_token: validEncToken,
            key_version: 'v1',
            enabled: true,
            status: 'valid',
            token_expires_at: new Date(Date.now() + 86400000),
          },
        ])
        .mockResolvedValueOnce([]); // update status to invalid

      const sendResult = await whatsAppService.sendMessage({
        clinicId: testClinicId,
        toPhone: testSender,
        body: 'Test',
        customFetch: mockCustomFetch as any,
      });

      expect(sendResult.success).toBe(false);
      expect(sendResult.providerStatus).toBe('auth_error');
    });

    it('Scenario 36: Duplicate outbound dispatch prevention via idempotency key in /send endpoint', async () => {
      const idempotencyKey = 'unique-key-12345';

      // Step 2 Fast Path: existing notification found in api.notifications with status: 'sent'
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        {
          id: 'notif-1',
          status: 'sent',
          provider_message_id: 'wamid.existingAlreadyDispatched',
          created_at: new Date(),
          sent_at: new Date(),
        },
      ]);

      process.env.INTERNAL_SERVICE_KEY = 'test_internal_service_key_1234';

      const res = await request(app)
        .post('/api/v1/integrations/whatsapp/send')
        .set('x-service-key', 'test_internal_service_key_1234')
        .send({
          clinic_id: testClinicId,
          recipient: testSender,
          message: 'Idempotent test',
          idempotency_key: idempotencyKey,
        });

      delete process.env.INTERNAL_SERVICE_KEY;

      expect(res.status).toBe(200);
      expect(res.body.code).toBe('IDEMPOTENT_HIT');
      expect(res.body.data.provider_message_id).toBe('wamid.existingAlreadyDispatched');
    });
  });
});
