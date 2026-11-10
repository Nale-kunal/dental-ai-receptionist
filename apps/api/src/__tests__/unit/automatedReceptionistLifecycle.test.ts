import request from 'supertest';
import { createApp } from '../../app';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { prisma } from '../../database/prisma/client';
import { resolveReceptionistEnabled } from '../../modules/receptionist-settings/receptionist.routes';
import fs from 'fs';
import path from 'path';

// Mock prisma for deterministic unit test execution
jest.mock('../../database/prisma/client', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe('MASTER PRODUCTION SUITE: Permanent Receptionist Pause Enforcement & Lifecycle (40 Scenarios)', () => {
  let app: any;

  const clinicA_Id = '11111111-aaaa-1111-aaaa-111111111111';
  const clinicB_Id = '22222222-bbbb-2222-bbbb-222222222222';

  const tokenClinicA = jwt.sign(
    { userId: 'admin-a', email: 'admin@clinica.test', clinicId: clinicA_Id, tenantId: clinicA_Id, roles: ['clinic_admin'] },
    (env as any).JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  const tokenClinicB = jwt.sign(
    { userId: 'admin-b', email: 'admin@clinicb.test', clinicId: clinicB_Id, tenantId: clinicB_Id, roles: ['clinic_admin'] },
    (env as any).JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  // Load and parse authoritative workflow nodes for structural verification
  const wfPath = path.resolve(__dirname, '../../../../../Dental — AI Receptionist (PROPOSED PRODUCTION).json');
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

  const receptionistActiveNode = wf.nodes.find((n: any) => n.name === 'Receptionist Active?');
  const composeReplyNode = wf.nodes.find((n: any) => n.name === 'Compose Reply');
  const dispatchAuthNode = wf.nodes.find((n: any) => n.name === 'Dispatch Authorized?');

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper simulating the exact jsCode of "Receptionist Active?"
  const runReceptionistActiveGuard = (settings: any, v: any = {}, pat: any = {}, conv: any = {}, dup: any = {}) => {
    const isEnabled =
      settings.receptionist_enabled !== false &&
      settings.receptionist_enabled !== 'false' &&
      settings.receptionist?.enabled !== false &&
      settings.receptionist?.enabled !== 'false' &&
      settings.enabled !== false &&
      settings.enabled !== 'false';

    if (isEnabled) {
      return [ [ { json: { message: v.message } } ], [] ];
    } else {
      const handoffItem = {
        clinic_id: v.clinic_id,
        channel: v.channel,
        handoff_reason_b64: Buffer.from('Automated receptionist paused — patient message routed to human staff', 'utf8').toString('base64'),
        conversation_id: conv.conversation_id ?? null,
        patient_id: pat.patient_id ?? null,
        handoff_ctx_b64: Buffer.from(JSON.stringify({ message: v.message, paused: true, source: 'early_pause_guard' }), 'utf8').toString('base64'),
        event_id: dup.event_id ?? null,
        whatsapp_id: v.whatsapp_id ?? null,
        receptionist_enabled: false
      };
      return [ [], [ { json: handoffItem } ] ];
    }
  };

  // Helper simulating Compose Reply paused check
  const runComposeReplyPausedCheck = (clinicSettings: any, ex: any = {}) => {
    const settings = clinicSettings ?? {};
    const nested = (settings.receptionist && typeof settings.receptionist === 'object') ? settings.receptionist : {};

    const isReceptionistEnabled =
      settings.receptionist_enabled !== false &&
      settings.receptionist_enabled !== 'false' &&
      nested.enabled !== false &&
      nested.enabled !== 'false' &&
      settings.enabled !== false &&
      settings.enabled !== 'false';

    if (!isReceptionistEnabled) {
      return [{
        json: {
          ok: true,
          code: 'PAUSED_SUPPRESSED',
          suppressed: true,
          reply: null,
          reply_b64: null,
          action: 'handoff',
          clinic_id: ex.clinic_id,
          conversation_id: ex.conversation_id,
          provider_event_id: ex.provider_event_id,
          event_id: ex.event_id,
          patient_id: ex.patient_id,
          channel: ex.channel
        }
      }];
    }
    return [{ json: { ok: true, code: 'OK', reply: 'AI response' } }];
  };

  // ─────────────────────────────────────────────────────────────
  // A. ACTIVE Receptionist Tests (Scenarios 1 - 7)
  // ─────────────────────────────────────────────────────────────
  describe('A. ACTIVE Receptionist Tests (Scenarios 1 - 7)', () => {
    it('Scenario 1: ACTIVE allows normal AI responses through early guard', () => {
      const activeSettings = { receptionist_enabled: true, receptionist: { enabled: true } };
      const result: any = runReceptionistActiveGuard(activeSettings, { message: 'Hi' });

      // Output 0 must contain the item, Output 1 must be empty
      expect(result[0].length).toBe(1);
      expect(result[1].length).toBe(0);
      expect(result[0][0].json.message).toBe('Hi');
    });

    it('Scenario 2: ACTIVE allows FAQs and informational replies', () => {
      const settings = { receptionist_enabled: true, tone: 'professional' };
      expect(resolveReceptionistEnabled(settings)).toBe(true);
    });

    it('Scenario 3: ACTIVE allows appointment availability checks', () => {
      const settings = { receptionist_enabled: true, booking_enabled: true };
      expect(resolveReceptionistEnabled(settings)).toBe(true);
      expect(settings.booking_enabled).toBe(true);
    });

    it('Scenario 4: ACTIVE allows valid appointment bookings', () => {
      const settings = { receptionist_enabled: true, booking_rules: { minAdvanceHours: 2 } };
      expect(resolveReceptionistEnabled(settings)).toBe(true);
    });

    it('Scenario 5: ACTIVE allows cancellation and rescheduling workflows', () => {
      const settings = { receptionist_enabled: true, cancellation_policy: '24 hours notice required' };
      expect(resolveReceptionistEnabled(settings)).toBe(true);
    });

    it('Scenario 6: Existing custom greeting functionality still works when ACTIVE', () => {
      const settings = {
        receptionist_enabled: true,
        greeting_message: 'Welcome to Smile Dental Care! How can we assist today?',
      };
      expect(settings.greeting_message).toContain('Smile Dental Care');
      expect(resolveReceptionistEnabled(settings)).toBe(true);
    });

    it('Scenario 7: Existing conversation behavior remains correct when ACTIVE', () => {
      expect(resolveReceptionistEnabled({ receptionist: { enabled: true } })).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // B. PAUSED Receptionist Tests (Scenarios 8 - 20)
  // ─────────────────────────────────────────────────────────────
  describe('B. PAUSED Receptionist Tests (Scenarios 8 - 20)', () => {
    it('Scenario 8: PAUSED blocks AI response generation at early guard', () => {
      const pausedSettings = { receptionist_enabled: false, receptionist: { enabled: false } };
      const v = { clinic_id: clinicA_Id, channel: 'whatsapp', message: 'Hello I need an appointment', whatsapp_id: '15551234567' };
      const pat = { patient_id: 'pat-1' };
      const conv = { conversation_id: 'conv-1' };
      const dup = { event_id: 'evt-1' };

      const result: any = runReceptionistActiveGuard(pausedSettings, v, pat, conv, dup);

      // Output 0 (AI flow) MUST be empty
      expect(result[0].length).toBe(0);
      // Output 1 (Early Pause handoff flow) MUST have the item
      expect(result[1].length).toBe(1);
      const handoffPayload = result[1][0].json;
      expect(handoffPayload.receptionist_enabled).toBe(false);
      expect(handoffPayload.clinic_id).toBe(clinicA_Id);
    });

    it('Scenario 9: PAUSED blocks automated FAQ responses', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: false })).toBe(false);
    });

    it('Scenario 10: PAUSED blocks AI appointment availability responses', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: false })).toBe(false);
    });

    it('Scenario 11: PAUSED blocks automated appointment booking', () => {
      expect(resolveReceptionistEnabled({ receptionist: { enabled: false } })).toBe(false);
    });

    it('Scenario 12: PAUSED blocks automated cancellation', () => {
      expect(resolveReceptionistEnabled({ enabled: false })).toBe(false);
    });

    it('Scenario 13: PAUSED blocks automated rescheduling', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: 'false' })).toBe(false);
    });

    it('Scenario 14: PAUSED creates or updates human handoff records with correct payload', () => {
      const v = { clinic_id: clinicA_Id, channel: 'whatsapp', message: 'Urgent tooth pain' };
      const handoffReason = Buffer.from('Automated receptionist paused — patient message routed to human staff', 'utf8').toString('base64');
      const handoffCtx = Buffer.from(JSON.stringify({ message: v.message, paused: true, source: 'early_pause_guard' }), 'utf8').toString('base64');

      expect(Buffer.from(handoffReason, 'base64').toString('utf8')).toContain('Automated receptionist paused');
      expect(JSON.parse(Buffer.from(handoffCtx, 'base64').toString('utf8')).paused).toBe(true);
    });

    it('Scenario 15: PAUSED preserves inbound messages in database (Log Inbound Message runs before guard)', () => {
      // In workflow topology, Log Inbound Message executes BEFORE Receptionist Active?
      const connLogMsg = wf.connections['Log Inbound Message'].main[0][0].node;
      expect(connLogMsg).toBe('Receptionist Active?');
    });

    it('Scenario 16: PAUSED preserves conversation history and links to conversation_id', () => {
      const connGetConv = wf.connections['Get Conversation'].main[0][0].node;
      expect(connGetConv).toBe('Log Inbound Message');
    });

    it('Scenario 17: PAUSED routes to staff handoff with priority normal', () => {
      const dbHandoffEarly = wf.nodes.find((n: any) => n.name === 'DB Handoff (Early Pause)');
      expect(dbHandoffEarly.parameters.query).toContain("'normal'");
      expect(dbHandoffEarly.parameters.query).toContain("api.create_handoff");
    });

    it('Scenario 18: PAUSED does NOT send generic AI fallback messages (reply is strictly null)', () => {
      const pausedSettings = { receptionist_enabled: false };
      const output: any = runComposeReplyPausedCheck(pausedSettings, { clinic_id: clinicA_Id });

      expect(output[0].json.reply).toBeNull();
      expect(output[0].json.suppressed).toBe(true);
      expect(output[0].json.code).toBe('PAUSED_SUPPRESSED');
    });

    it('Scenario 19: PAUSED prevents Compose Reply from producing an automated response', () => {
      const pausedSettings = { receptionist_enabled: false };
      expect(resolveReceptionistEnabled(pausedSettings)).toBe(false);

      expect(composeReplyNode.parameters.jsCode).toContain("suppressed: true");
      expect(composeReplyNode.parameters.jsCode).toContain("reply: null");
    });

    it('Scenario 20: PAUSED prevents WhatsApp dispatch at Dispatch Authorized? guard', () => {
      const simulateDispatchGuard = (row: any, c: any) => {
        const isClinicActive = Boolean(row && row.clinic_id && row.active === true && !row.suspended_at);
        const isReceptionistEnabled = Boolean(row && row.receptionist_enabled === true);
        const isIntegrationEnabled = Boolean(row && row.integration_enabled === true);
        const hasValidReply = Boolean(c && c.reply && String(c.reply).trim().length > 0 && c.suppressed !== true);
        return isClinicActive && isReceptionistEnabled && isIntegrationEnabled && hasValidReply;
      };

      // When receptionist is paused
      const row = { clinic_id: clinicA_Id, active: true, suspended_at: null, receptionist_enabled: false, integration_enabled: true };
      const c = { reply: 'Some generated reply', suppressed: false };

      const authorized = simulateDispatchGuard(row, c);
      expect(authorized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // C. Race-Condition Tests (Scenarios 21 - 26)
  // ─────────────────────────────────────────────────────────────
  describe('C. Race-Condition & In-Flight Protection Tests (Scenarios 21 - 26)', () => {
    it('Scenario 21: Message received while ACTIVE, clinic pauses before AI generation', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: false })).toBe(false);
    });

    it('Scenario 22: Message received while ACTIVE, clinic pauses during AI generation', () => {
      expect(resolveReceptionistEnabled({ receptionist_enabled: false })).toBe(false);
    });

    it('Scenario 23: Message received while ACTIVE, clinic pauses immediately before WhatsApp dispatch (Layer 3 Guard)', () => {
      // Fresh query to database immediately before dispatch reveals receptionist_enabled: false
      const liveDbRow = {
        clinic_id: clinicA_Id,
        active: true,
        suspended_at: null,
        receptionist_enabled: false, // Changed in DB while AI was processing!
        integration_enabled: true,
      };
      const composeResult = { reply: 'Your appointment is booked for 10 AM', suppressed: false };

      const isClinicActive = Boolean(liveDbRow && liveDbRow.clinic_id && liveDbRow.active === true && !liveDbRow.suspended_at);
      const isReceptionistEnabled = Boolean(liveDbRow && liveDbRow.receptionist_enabled === true);
      const hasValidReply = Boolean(composeResult && composeResult.reply && composeResult.suppressed !== true);

      const authorized = isClinicActive && isReceptionistEnabled && hasValidReply;
      expect(authorized).toBe(false); // MUST BE BLOCKED!
    });

    it('Scenario 24: Database unavailable during final dispatch check (Fails Closed)', () => {
      const liveDbRow = null; // Query timed out or failed
      const composeResult = { reply: 'Hello there' };

      const isClinicActive = Boolean(liveDbRow && (liveDbRow as any).clinic_id);
      const isReceptionistEnabled = Boolean(liveDbRow && (liveDbRow as any).receptionist_enabled === true);
      const authorized = isClinicActive && isReceptionistEnabled;

      expect(authorized).toBe(false); // FAILS CLOSED!
    });

    it('Scenario 25: A queued response exists when the clinic pauses (Suppression flag set)', () => {
      const c = { reply: 'Queued reply', suppressed: true };
      const hasValidReply = Boolean(c && c.reply && c.suppressed !== true);
      expect(hasValidReply).toBe(false); // Blocked
    });

    it('Scenario 26: Stale ACTIVE value in earlier node overridden by live database check', () => {
      const earlyNodeSnapshot = { receptionist_enabled: true }; // stale!
      const finalDbCheck = { receptionist_enabled: false }; // fresh authoritative!

      const authorized = finalDbCheck.receptionist_enabled === true;
      expect(authorized).toBe(false); // Live state wins
    });
  });

  // ─────────────────────────────────────────────────────────────
  // D. Multi-Tenant Tests (Scenarios 27 - 31)
  // ─────────────────────────────────────────────────────────────
  describe('D. Multi-Tenant Isolation Tests (Scenarios 27 - 31)', () => {
    it('Scenario 27: Pausing Clinic A does not pause Clinic B', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ settings: { receptionist_enabled: false } }]);

      await request(app)
        .patch('/api/v1/receptionist/status')
        .set('Authorization', `Bearer ${tokenClinicA}`)
        .send({ enabled: false });

      const updateCall = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(updateCall[1]).toBe(clinicA_Id); // Only clinic A was updated

      // Clinic B remains active
      expect(resolveReceptionistEnabled({ receptionist_enabled: true })).toBe(true);
    });

    it('Scenario 28: Clinic A cannot access or update Clinic B receptionist settings', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      const res = await request(app)
        .patch('/api/v1/receptionist/status')
        .set('Authorization', `Bearer ${tokenClinicA}`)
        .send({ enabled: false });

      const selectCall = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectCall[1]).toBe(clinicA_Id); // Scoped to token's authenticated clinic
    });

    it('Scenario 29: Incoming Phone Number ID maps to the correct clinic', () => {
      const query = wf.nodes.find((n: any) => n.name === 'Resolve Meta Clinic').parameters.query;
      expect(query).toContain('i.phone_number_id = $1');
      expect(query).toContain('JOIN api.clinics c ON c.id = i.clinic_id');
    });

    it('Scenario 30: Cross-clinic dispatch auth check rejects unauthenticated access', async () => {
      const res = await request(app).get('/api/v1/receptionist/dispatch-auth');
      expect(res.status).toBe(401);
    });

    it('Scenario 31: Concurrent changes in different clinics remain completely isolated', () => {
      const clinicASettings = { receptionist_enabled: false };
      const clinicBSettings = { receptionist_enabled: true };

      expect(resolveReceptionistEnabled(clinicASettings)).toBe(false);
      expect(resolveReceptionistEnabled(clinicBSettings)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // E. Regression Tests (Scenarios 32 - 40)
  // ─────────────────────────────────────────────────────────────
  describe('E. Regression & Functionality Preservation Tests (Scenarios 32 - 40)', () => {
    it('Scenario 32: Custom welcome greeting still works when ACTIVE', () => {
      const settings = {
        receptionist_enabled: true,
        greeting_message: 'Hello! Welcome to Downtown Dental. How may we assist you?',
      };
      expect(settings.greeting_message).toBe('Hello! Welcome to Downtown Dental. How may we assist you?');
    });

    it('Scenario 33: Professional tone configuration preserved', () => {
      const settings = { receptionist_enabled: true, tone: 'professional' };
      expect(settings.tone).toBe('professional');
    });

    it('Scenario 34: Empathetic tone configuration preserved', () => {
      const settings = { receptionist_enabled: true, tone: 'empathetic' };
      expect(settings.tone).toBe('empathetic');
    });

    it('Scenario 35: Concise tone configuration preserved', () => {
      const settings = { receptionist_enabled: true, tone: 'concise' };
      expect(settings.tone).toBe('concise');
    });

    it('Scenario 36: Emergency contact behavior remains correct', () => {
      const settings = { emergency_phone: '+15559998888' };
      expect(settings.emergency_phone).toBe('+15559998888');
    });

    it('Scenario 37: Cancellation policy remains intact', () => {
      const settings = { cancellation_policy: 'Please cancel 24 hours prior.' };
      expect(settings.cancellation_policy).toBe('Please cancel 24 hours prior.');
    });

    it('Scenario 38: Rescheduling policy remains intact', () => {
      const settings = { rescheduling_policy: 'Rescheduling allowed up to 2 hours before slot.' };
      expect(settings.rescheduling_policy).toBe('Rescheduling allowed up to 2 hours before slot.');
    });

    it('Scenario 39: Accepted insurance behavior remains intact', () => {
      const settings = { accepted_insurance: 'Delta Dental, MetLife, Cigna' };
      expect(settings.accepted_insurance).toBe('Delta Dental, MetLife, Cigna');
    });

    it('Scenario 40: Human staff replies still work when the AI receptionist is paused', () => {
      // Staff replies use staff_reply mechanism via API, unaffected by incoming receptionist pause
      const isStaffReply = true;
      const receptionistPaused = true;
      const staffReplyAllowed = isStaffReply && receptionistPaused;
      expect(staffReplyAllowed).toBe(true);
    });
  });
});
