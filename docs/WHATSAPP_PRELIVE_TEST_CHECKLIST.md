# Controlled WhatsApp Live Testing Checklist: Demo Clinic

**Target Clinic**: Demo Dental Clinic (`00000000-0000-0000-0000-000000000001`)  
**Target Environment**: Neon PostgreSQL (`ep-green-fog-a45g086b`), Express API Server (`port 3001`), n8n Cloud (`kunalnale12345678.app.n8n.cloud`)  
**Rule**: Execute testing only when explicitly authorized. Do not print, log, or paste access tokens in chat or terminal logs.

---

## 1. Safe Credential Configuration Protocol (Zero-Leak)

To configure your own Meta WhatsApp Business Account number and token for Demo Dental Clinic without exposing credentials in chat:

### Option A: Using the Secure API Endpoint (Recommended)
Send a local authenticated `PUT` request to the Express API (port 3001) using your clinic admin JWT token:

```bash
# Obtain your JWT token via login or dashboard session
# Run from a secure private shell (do NOT post response in chat):
curl -X PUT http://localhost:3001/api/v1/receptionist/integration \
  -H "Authorization: Bearer <YOUR_CLINIC_ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumberId": "<YOUR_META_PHONE_NUMBER_ID>",
    "wabaId": "<YOUR_META_WABA_ID>",
    "accessToken": "<YOUR_META_PERMANENT_SYSTEM_USER_TOKEN>",
    "enabled": true
  }'
```

**Safe Verification**:
The endpoint automatically encrypts the access token with AES-256-GCM before saving and responds with masked information:
```json
{
  "ok": true,
  "data": {
    "clinicId": "00000000-0000-0000-0000-000000000001",
    "phoneNumberId": "<YOUR_META_PHONE_NUMBER_ID>",
    "enabled": true,
    "status": "valid",
    "hasToken": true,
    "maskedToken": "••••••••4321"
  }
}
```

---

## 2. Step-by-Step Controlled Test Sequence

### Test A — Clinic Configuration Verification
- [ ] Query `GET /api/v1/receptionist/integration` with clinic admin JWT.
- [ ] Confirm `phoneNumberId` matches your Meta Phone Number ID.
- [ ] Confirm `status === 'valid'` and `hasToken === true`.
- [ ] Confirm `maskedToken` shows only the last 4 digits.
- [ ] Run `SELECT api.get_clinic_by_phone_number_id('<YOUR_PHONE_NUMBER_ID>');` in PostgreSQL; verify it returns Demo Dental Clinic.

### Test B — Real Inbound Message Ingestion
- [ ] From an authorized test personal WhatsApp number, send a unique test message:
  `"Hello, what are your opening hours on Tuesday?"`
- [ ] In n8n Cloud execution history for `POST dental/inbound`:
  - [ ] Verify HTTP signature check passes (`x-hub-signature-256`).
  - [ ] Verify `phone_number_id` is extracted and resolves to Demo Dental Clinic (`00000000-0000-0000-0000-000000000001`).
- [ ] Query PostgreSQL `api.inbound_events`:
  - [ ] Confirm the Meta `wamid` is recorded exactly once.
- [ ] Query PostgreSQL `api.conversations` and `api.patients`:
  - [ ] Confirm patient is created or matched under Demo Clinic ID.
  - [ ] Confirm conversation is created under Demo Clinic ID.

### Test C — AI Context & Outbound WhatsApp Delivery
- [ ] Verify the AI reception model generates a reply using Demo Dental Clinic's business hours, services, and dentists.
- [ ] In n8n execution log:
  - [ ] Verify outbound Meta node calls `https://graph.facebook.com/v20.0/<YOUR_PHONE_NUMBER_ID>/messages`.
  - [ ] Verify outbound HTTP request uses Demo Clinic's decrypted Bearer token.
  - [ ] Verify response from Meta is HTTP 200 with an outbound `wamid`.
- [ ] On the test personal phone:
  - [ ] Observe WhatsApp reply delivered from your Demo Clinic WhatsApp Business number.

### Test D — Conversation Thread Continuity
- [ ] From the same test personal WhatsApp number, send a follow-up message:
  `"How much does a dental cleaning cost?"`
- [ ] Query PostgreSQL `api.conversations`:
  - [ ] Confirm `api.get_or_create_conversation` returned the **same existing `conversation_id`** with `existing: true`.
  - [ ] Verify no second open conversation was spawned.
- [ ] In `apps/web` Receptionist dashboard:
  - [ ] Verify the conversation appears in the inbox with full thread history.
  - [ ] Verify patient phone number and name appear correctly.

### Test E — Cross-Clinic Isolation Check
- [ ] Read-only query on PostgreSQL:
  ```sql
  SELECT id, name FROM api.clinics WHERE id != '00000000-0000-0000-0000-000000000001';
  ```
  - [ ] Confirm Oracle Clinic (`914fb00e-c834-4e44-9646-9d746f536d4e`) and Austin Dental Studio (`09ca7fdc-2e76-40f9-9f53-7796bbce6a08`) have zero messages, zero patients, and zero events associated with your test inbound number.
  - [ ] Confirm neither clinic can access or view Demo Clinic's integration credentials.

### Test F — Failure & Edge Case Handling
- [ ] **Unknown Number**: Verify sending a simulated webhook payload with an unmapped `phone_number_id` (`8888888888888888`) returns `NOT_FOUND` and halts without falling back to Demo Clinic.
- [ ] **Duplicate Retries**: Verify sending the same Meta `wamid` a second time returns `duplicate: true` via `api.register_inbound_event` without invoking the LLM or sending a duplicate reply.
- [ ] **Suspended Clinic**: Verify that if a clinic has `suspended_at IS NOT NULL`, `api.get_clinic_by_phone_number_id` returns `SUSPENDED` and aborts immediately.

---

## 3. Prerequisite Checklist for Production n8n Activation

Do NOT activate or publish the live n8n workflow until:
1. [x] Database migration 1.4.0 is applied and verified on Neon.
2. [x] Dedicated integration table `api.clinic_whatsapp_integrations` is active with Phone Number ID unique index.
3. [x] Stored procedures `api.get_clinic_by_phone_number_id` and sanitized `api.get_clinic_context` are deployed.
4. [x] Outbound `WhatsAppService` is deployed in `apps/api`.
5. [ ] The live n8n workflow on `kunalnale12345678.app.n8n.cloud` is opened in a private review session to confirm dynamic credential injection (`Bearer {{$json.clinic_token}}`) rather than a single static credential.
6. [ ] Demo Clinic credentials are encrypted and stored via `PUT /api/v1/receptionist/integration`.
