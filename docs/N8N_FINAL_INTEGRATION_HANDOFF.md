# n8n Final Integration Handoff — Verified System Contracts

> [!IMPORTANT]
> **Preservation Rule Notice**: As instructed in the architectural guidelines, the live n8n workflow has NOT been modified, republished, or activated during this application stabilization phase. This handoff document specifies the verified backend and database contracts for the subsequent workflow synchronization task.

---

## 1. Webhook Ingestion & Inbound Authentication Endpoints

| Workflow Path | Method | Authentication | Payload / Verification |
| :--- | :--- | :--- | :--- |
| `POST dental/inbound` | `POST` | Meta HMAC-SHA256 (`x-hub-signature-256`) | Meta WhatsApp Cloud Webhook Envelope |
| `POST dental/internal-test`| `POST` | Header Auth (`x-internal-test-key`) | Simulated Inbound Event Payload |
| `GET dental/inbound` | `GET` | Webhook Verification (`hub.challenge`) | Meta Verification Token Validation |

---

## 2. Core PostgreSQL Database Functions (Neon Production Schema)

All functions reside under the `api` schema in Neon PostgreSQL and enforce tenant isolation via `p_clinic_id`.

### A. `api.register_inbound_event`
- **Signature**:
  ```sql
  api.register_inbound_event(
    p_clinic_id uuid,
    p_provider text,
    p_event_type text,
    p_provider_event_id text,
    p_payload_hash text,
    p_raw_payload jsonb
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "event_id": "uuid",
      "state": "received",
      "duplicate": false
    }
  }
  ```
- **Behavior**: If `p_provider` and `p_provider_event_id` already exist in `api.inbound_events`, returns `duplicate: true`, preventing redundant AI processing.

---

### B. `api.find_or_create_patient`
- **Signature**:
  ```sql
  api.find_or_create_patient(
    p_clinic_id uuid,
    p_full_name text,
    p_phone text DEFAULT NULL::text,
    p_email text DEFAULT NULL::text,
    p_whatsapp_id text DEFAULT NULL::text,
    p_date_of_birth date DEFAULT NULL::date
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "patient_id": "uuid",
      "existing": true
    }
  }
  ```
- **Tenant Scope**: Searches matching `phone`, `whatsapp_id`, or `email` strictly scoped to `p_clinic_id`. The same phone number belonging to a different clinic creates an isolated patient row.

---

### C. `api.get_or_create_conversation` (Persistent Conversation Continuity & Lifecycle)
- **Signature**:
  ```sql
  api.get_or_create_conversation(
    p_clinic_id uuid,
    p_channel api.channel_type,
    p_channel_conversation_id text,
    p_patient_id uuid DEFAULT NULL::uuid,
    p_inactivity_interval interval DEFAULT NULL::interval,
    p_force_new boolean DEFAULT false
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "conversation_id": "3ebc8316-1a15-424c-9c89-414bbd89fd2a",
      "existing": true,
      "state": {},
      "patient_id": "8a0f7c3f-88c2-417a-9194-b93afea154f6",
      "channel": "whatsapp",
      "channel_conversation_id": "+155501208298",
      "last_message_at": "2026-10-16T13:07:12.140Z",
      "created_at": "2026-10-16T13:07:12.140Z"
    }
  }
  ```
- **Lifecycle & Continuity Rules**:
  1. **Thread Continuation (Default)**: When `p_channel_conversation_id` (the patient's normalized WhatsApp number or phone) contacts the clinic, the function searches for an active open conversation (`closed_at IS NULL`). If found, it reuses the existing `conversation_id` (`existing: true`).
  2. **Multi-Tenant Scoping**: Uniqueness and lookup are strictly scoped to `p_clinic_id`. A patient messaging Clinic A and Clinic B receives two isolated, distinct threads.
  3. **Concurrency & Race Condition Safety**: Atomic PL/pgSQL implementation catches concurrent inserts (`unique_violation`) and gracefully returns the single active conversation ID to both callers without crashing.
  4. **Inactivity Policy**: If `p_inactivity_interval` is specified or configured in `clinics.settings->'receptionist'->>'inactivity_timeout_hours'`, a conversation whose `last_message_at` exceeds the threshold is archived with `closed_at = NOW()` and `close_reason = 'inactivity_timeout'`, and a new thread is created.
  5. **Explicit New Thread**: When `p_force_new = true`, the previous thread is archived and a fresh thread is initiated.
  6. **Patient Linking**: Automatically associates `p_patient_id` when identified without breaking thread continuity.

---

### D. `api.record_message` (Inbound & Outbound Thread Persistence)
- **Signature**:
  ```sql
  api.record_message(
    p_clinic_id uuid,
    p_conversation_id uuid,
    p_direction api.message_direction,  -- 'inbound' or 'outbound'
    p_kind api.message_kind,            -- 'patient_text', 'system_event', etc.
    p_body text,
    p_provider_message_id text DEFAULT NULL::text,
    p_provider_payload jsonb DEFAULT NULL::jsonb,
    p_media_url text DEFAULT NULL::text,
    p_media_mime_type text DEFAULT NULL::text
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "message_id": "uuid",
      "conversation_id": "uuid",
      "direction": "inbound",
      "duplicate": false,
      "created_at": "2026-10-16T13:08:00.000Z"
    }
  }
  ```
- **n8n Usage**:
  - **Inbound Node**: Call `api.record_message` with `p_direction = 'inbound'` and `p_provider_message_id = $json.entry[0].changes[0].value.messages[0].id` (Meta wamid). If `duplicate === true`, n8n halts redundant message processing immediately.
  - **Outbound AI Node**: Call `api.record_message` with `p_direction = 'outbound'`, `p_body = $json.ai_reply`, and `p_conversation_id = $('Get or Create Conversation').item.json.result.data.conversation_id`.

---

### E. `api.get_conversation_context` (AI Receptionist Context Window)
- **Signature**:
  ```sql
  api.get_conversation_context(
    p_clinic_id uuid,
    p_conversation_id uuid,
    p_limit integer DEFAULT 20
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "conversation_id": "uuid",
      "patient_name": "Sarah Connor",
      "patient_phone": "+15550123456",
      "channel": "whatsapp",
      "messages": [
        {
          "id": "uuid",
          "direction": "inbound",
          "body": "Hi, I have a toothache",
          "created_at": "2026-10-16T10:00:00Z"
        },
        {
          "id": "uuid",
          "direction": "outbound",
          "body": "Hello Sarah! We can see you today at 2 PM.",
          "created_at": "2026-10-16T10:01:00Z"
        }
      ]
    }
  }
  ```
- **n8n AI Node Mapping**: Feed `messages` directly into the LLM chat history block so the AI retains full context of previous interactions when returning patients message today, tomorrow, or next week.

---

### F. `api.search_availability`
- **Signature**:
  ```sql
  api.search_availability(
    p_clinic_id uuid,
    p_dentist_id uuid,
    p_service_id uuid,
    p_date date,
    p_limit integer DEFAULT 10
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": [
      {
        "starts_at": "2026-10-20T14:00:00Z",
        "ends_at": "2026-10-20T14:45:00Z",
        "buffer_ends_at": "2026-10-20T14:55:00Z",
        "duration_minutes": 45,
        "buffer_minutes": 10
      }
    ]
  }
  ```
- **Availability Precedence**:
  1. Checks `api.assert_clinic_active(p_clinic_id)`.
  2. Intersects `api.business_hours` with `api.dentist_schedules`. If clinic is closed on `p_date` or schedule is unconfigured, returns `[]`.
  3. Skips slots colliding with whole-clinic schedule blocks or practitioner leave in `api.schedule_blocks`.
  4. Skips slots colliding with confirmed appointments in `api.appointments`.

---

### G. `api.book_appointment`
- **Signature**:
  ```sql
  api.book_appointment(
    p_clinic_id uuid,
    p_dentist_id uuid,
    p_patient_id uuid,
    p_service_id uuid,
    p_starts_at timestamp with time zone,
    p_metadata jsonb DEFAULT '{}'::jsonb
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "appointment_id": "uuid",
      "confirmation_code": "DZXV-CUIN",
      "starts_at": "2026-10-20T14:00:00Z",
      "ends_at": "2026-10-20T14:55:00Z",
      "duration_minutes": 45,
      "buffer_minutes": 10
    }
  }
  ```
- **Error Responses**:
  - Double-booking / Race condition: `{ "ok": false, "code": "CONFLICT", "message": "slot no longer available" }`
  - Outside operating hours: `{ "ok": false, "code": "VALIDATION", "message": "requested time is outside business or dentist hours" }`
  - Past date: `{ "ok": false, "code": "VALIDATION", "message": "cannot book in the past" }`

---

### H. `api.cancel_appointment`
- **Signature**:
  ```sql
  api.cancel_appointment(
    p_clinic_id uuid,
    p_appointment_id uuid,
    p_reason text DEFAULT NULL::text,
    p_changed_by text DEFAULT 'system'::text
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "appointment_id": "uuid",
      "status": "cancelled"
    }
  }
  ```

---

### I. `api.reschedule_appointment`
- **Signature**:
  ```sql
  api.reschedule_appointment(
    p_clinic_id uuid,
    p_appointment_id uuid,
    p_new_starts_at timestamp with time zone,
    p_reason text DEFAULT NULL::text,
    p_changed_by text DEFAULT 'system'::text
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "old_appointment_id": "uuid",
      "new_appointment_id": "uuid",
      "new_confirmation_code": "DZXV-CUIN",
      "new_starts_at": "2026-10-22T15:00:00Z"
    }
  }
  ```
- **Behavior**: Preserves the patient's existing confirmation code by transferring it to the new appointment and archiving the old appointment with `rescheduled` status and linked `rescheduled_from` pointer.

---

### J. `api.get_appointment`
- **Signature**:
  ```sql
  api.get_appointment(
    p_clinic_id uuid,
    p_patient_id uuid,
    p_appointment_id uuid DEFAULT NULL::uuid,
    p_confirmation_code text DEFAULT NULL::text
  ) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "id": "uuid",
      "status": "confirmed",
      "starts_at": "2026-10-20T14:00:00Z",
      "ends_at": "2026-10-20T14:45:00Z",
      "confirmation_code": "DZXV-CUIN",
      "patient_id": "uuid",
      "dentist_id": "uuid",
      "service_id": "uuid"
    }
  }
  ```

---

### K. `api.get_clinic_context`
- **Signature**:
  ```sql
  api.get_clinic_context(p_clinic_id uuid) RETURNS jsonb
  ```
- **Return Shape**:
  ```json
  {
    "ok": true,
    "code": "OK",
    "data": {
      "id": "uuid",
      "name": "Austin Dental Studio",
      "slug": "austin-dental-studio",
      "timezone": "America/Chicago",
      "locale": "en-US",
      "settings": {
        "country": "US",
        "currency": "USD",
        "state": "TX",
        "city": "Austin",
        "address": "123 Dental Way",
        "receptionist": {
          "enabled": true,
          "tone": "warm_professional",
          "welcomeMessage": "Welcome to Austin Dental Studio! How may we help you today?"
        }
      },
      "business_hours": [
        { "day_of_week": 1, "opens_at": "08:30:00", "closes_at": "16:30:00" },
        { "day_of_week": 2, "opens_at": "08:30:00", "closes_at": "16:30:00" }
      ],
      "dentists": [
        {
          "id": "uuid",
          "display_name": "Dr. Jane Austin",
          "specialty": "General Dentistry",
          "default_buffer_minutes": 10
        }
      ],
      "services": [
        {
          "id": "uuid",
          "code": "EXAM-XR",
          "name": "Full Oral Exam & X-Ray",
          "duration_minutes": 45,
          "buffer_minutes": 10,
          "price": 185.50,
          "currency": "USD",
          "pricing_model": "starting_from",
          "category": "Diagnostic",
          "description": "Comprehensive dental examination with intraoral imaging."
        }
      ]
    }
  }
  ```

---

## 3. Pricing & Currency Semantics for the AI Receptionist

When patients inquire about costs on WhatsApp:
1. **`pricing_model === 'fixed'`**: The receptionist states the exact fee: e.g., `"The cost is $150.00."`
2. **`pricing_model === 'starting_from'`**: The receptionist clarifies that pricing starts at the base rate: e.g., `"Pricing starts from $185.50, depending on specific diagnostic requirements."`
3. **`pricing_model === 'quote_required'`** (where `price === null`): The receptionist explains that an in-person assessment is necessary: e.g., `"This procedure requires a personalized clinical consultation before a detailed quote can be provided."`
4. **Currency**: Must match the clinic's currency field (`USD`, `GBP`, `EUR`, `AUD`, `CAD`, `INR`).

---

## 4. Required n8n Workflow Updates (Subsequent Step)

1. **Service Query Enhancement**:
   - In n8n node `"Get Clinic Context"`, ensure the node consumes the updated `services` array including `price`, `currency`, and `pricing_model`.
2. **AI Prompt Injection**:
   - Pass the clinic's `currency` and `pricing_model` into the LLM system prompt for patient quote queries.
3. **Unconfigured Schedule Handling**:
   - If `business_hours.length === 0`, the receptionist responds gracefully: `"Our online booking schedule is currently being finalized. Please contact the front desk directly for available dates."`

---

## 5. Unverified Contracts & Blockers

- Live WhatsApp message sending via Meta Graph API was tested locally with signature verification, but actual delivery to an active phone requires live Meta credentials in n8n.
- n8n Cloud workflow modifications remain deferred to the next dedicated workflow editing phase.
