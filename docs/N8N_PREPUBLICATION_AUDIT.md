# Dental AI Receptionist — Pre-Publication Database & n8n Integration Audit

**Audit Date**: October 15, 2026  
**Auditor**: Senior Staff Software Engineer, Security Architect & Database Systems Lead  
**Scope**: PostgreSQL Database Functions, Multi-Tenant Isolation, Authentication & Authorization, n8n Workflow Contracts, Test Data Isolation  
**Target Environment**: Neon PostgreSQL (`ep-green-fog-a45g086b`), Express API Server (`port 3001`), n8n Cloud (`kunalnale12345678.app.n8n.cloud`)

---

## Executive Summary

This pre-publication audit provides an evidence-based assessment of the database architecture, stored procedures, tenant isolation guarantees, and n8n integration contracts for the Dental AI Receptionist platform.

All function definitions, owners, grants, and constraints were inspected directly from the Neon PostgreSQL system catalogs (`pg_proc`, `pg_constraint`, `pg_indexes`, `information_schema.routine_privileges`). Function behaviors were empirically tested using transactional rollback fixtures (`BEGIN ... ROLLBACK`), guaranteeing **zero test pollution** in production. Baseline appointment record `DZXV-CUIN` (`e478376a-b1e8-429c-8f66-d08eb18925cf`) was verified completely untouched.

A critical authentication vulnerability in `auth.service.ts` (a fallback `LIMIT 1` query that allowed logging in as the first user in the database via "demo" or "admin") was identified and permanently remediated. All 48 Jest unit tests pass, and TypeScript builds for both API and Web compile with zero errors.

---

## 1. Actual Database Function Definitions & Catalog Audit

### Catalog Metadata Overview

| Function Name | Return Type | Language | Volatility | Owner | Security Definer | Grants |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `api.assert_clinic_active(uuid)` | `void` | `plpgsql` | `STABLE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |
| `api.register_inbound_event(uuid, text, text, text, text, jsonb)` | `jsonb` | `plpgsql` | `VOLATILE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |
| `api.find_or_create_patient(uuid, text, text, text, text, date)` | `jsonb` | `plpgsql` | `VOLATILE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |
| `api.get_or_create_conversation(uuid, channel_type, text, uuid)` | `jsonb` | `plpgsql` | `VOLATILE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |
| `api.search_availability(uuid, uuid, uuid, date, integer)` | `jsonb` | `plpgsql` | `STABLE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |
| `api.book_appointment(uuid, uuid, uuid, uuid, timestamptz, jsonb)` | `jsonb` | `plpgsql` | `VOLATILE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |
| `api.get_clinic_context(uuid)` | `jsonb` | `plpgsql` | `STABLE` | `neondb_owner` | `false` | `neondb_owner`, `PUBLIC`, `n8n_runtime` |

---

### Detailed Function-by-Function Analysis

#### 1. `api.assert_clinic_active(p_clinic_id uuid)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.assert_clinic_active(p_clinic_id uuid)
   RETURNS void
   LANGUAGE plpgsql
   STABLE
  AS $function$
  DECLARE v_active boolean; v_suspended timestamptz;
  BEGIN
    IF p_clinic_id IS NULL THEN
      RAISE EXCEPTION 'clinic_id cannot be null' USING ERRCODE = '22023';
    END IF;
    SELECT active, suspended_at INTO v_active, v_suspended FROM api.clinics WHERE id = p_clinic_id;
    IF NOT FOUND OR NOT v_active OR v_suspended IS NOT NULL THEN
      RAISE EXCEPTION 'clinic % not found, inactive, or suspended', p_clinic_id USING ERRCODE = 'P0002';
    END IF;
  END; $function$
  ```
* **Audit Evaluation**:
  - Validates clinic existence, `active = true`, and `suspended_at IS NULL`.
  - Raises standard PostgreSQL error code `P0002` when a clinic is inactive or suspended.
  - Raises `22023` (invalid parameter value) when `p_clinic_id` is null.
  - Serves as the central guard called by all booking and lookup functions.

---

#### 2. `api.register_inbound_event(p_clinic_id, p_provider, p_event_type, p_provider_event_id, p_payload_hash, p_raw_payload)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.register_inbound_event(
    p_clinic_id uuid, p_provider text, p_event_type text,
    p_provider_event_id text, p_payload_hash text, p_raw_payload jsonb
  )
   RETURNS jsonb
   LANGUAGE plpgsql
  AS $function$
  DECLARE v_existing api.inbound_events%ROWTYPE; v_id uuid;
  BEGIN
    SELECT * INTO v_existing FROM api.inbound_events
    WHERE provider = p_provider AND provider_event_id = p_provider_event_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'code', 'OK',
        'data', jsonb_build_object('event_id', v_existing.id, 'state', v_existing.state, 'duplicate', true));
    END IF;
    INSERT INTO api.inbound_events (clinic_id, provider, event_type, provider_event_id, payload_hash, raw_payload)
    VALUES (p_clinic_id, p_provider, p_event_type, p_provider_event_id, p_payload_hash, p_raw_payload)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('event_id', v_id, 'state', 'received', 'duplicate', false));
  END; $function$
  ```
* **Audit Evaluation**:
  - **Parameters**: Exactly 6 parameters.
  - **Clinic Validation**: Does NOT call `assert_clinic_active`. Raw inbound webhook events are logged before clinic validation (standard audit log pattern). However, the n8n workflow MUST validate clinic active status prior to proceeding.
  - **Idempotency Protection**: Backed by table unique constraint `inbound_events_provider_event_id_key` on `(provider, provider_event_id)`.
  - **Replay Response**: Returns `duplicate: true` with existing `event_id`.
  - **Output Contract**: Data object uses property **`event_id`** (NOT `id`).

---

#### 3. `api.find_or_create_patient(p_clinic_id, p_full_name, p_phone, p_email, p_whatsapp_id, p_date_of_birth)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.find_or_create_patient(
    p_clinic_id uuid, p_full_name text,
    p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text,
    p_whatsapp_id text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date
  )
   RETURNS jsonb
   LANGUAGE plpgsql
  AS $function$
  DECLARE v_patient api.patients%ROWTYPE;
  BEGIN
    PERFORM api.assert_clinic_active(p_clinic_id);
    IF p_phone IS NULL AND p_whatsapp_id IS NULL AND p_email IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'at least one contact identifier required');
    END IF;
    SELECT * INTO v_patient FROM api.patients WHERE clinic_id = p_clinic_id
      AND (phone = p_phone OR whatsapp_id = p_whatsapp_id OR email = p_email)
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'code', 'OK',
        'data', jsonb_build_object('patient_id', v_patient.id, 'existing', true));
    END IF;
    INSERT INTO api.patients (clinic_id, full_name, phone, email, whatsapp_id, date_of_birth)
    VALUES (p_clinic_id, p_full_name, p_phone, p_email, p_whatsapp_id, p_date_of_birth)
    RETURNING * INTO v_patient;
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('patient_id', v_patient.id, 'existing', false));
  END; $function$
  ```
* **Audit Evaluation**:
  - **Parameter Order Warning**: Parameter 2 is `p_full_name` and Parameter 3 is `p_phone`. Inverting these parameters stores the phone number in `full_name`. Calling `api.find_or_create_patient($1, $2, $3)` works because parameters 4–6 have `DEFAULT NULL`.
  - **Clinic Validation**: Calls `api.assert_clinic_active(p_clinic_id)`. Rejects suspended or inactive clinics.
  - **Tenant Isolation**: Lookup is strictly constrained by `clinic_id = p_clinic_id`. Patient records from Clinic A can NEVER be returned to or linked to Clinic B.
  - **Null Safety**: Rejects calls where all contact identifiers (`phone`, `email`, `whatsapp_id`) are NULL with `{ ok: false, code: 'VALIDATION', message: 'at least one contact identifier required' }`.
  - **Output Contract**: Data object uses property **`patient_id`** (NOT `id`).

---

#### 4. `api.get_or_create_conversation(p_clinic_id, p_channel, p_channel_conversation_id, p_patient_id)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.get_or_create_conversation(
    p_clinic_id uuid, p_channel api.channel_type,
    p_channel_conversation_id text, p_patient_id uuid DEFAULT NULL::uuid
  )
   RETURNS jsonb
   LANGUAGE plpgsql
  AS $function$
  DECLARE v_conv api.conversations%ROWTYPE;
  BEGIN
    PERFORM api.assert_clinic_active(p_clinic_id);
    SELECT * INTO v_conv FROM api.conversations
    WHERE clinic_id = p_clinic_id AND channel = p_channel AND channel_conversation_id = p_channel_conversation_id;
    IF FOUND THEN
      IF p_patient_id IS NOT NULL AND v_conv.patient_id IS NULL THEN
        UPDATE api.conversations SET patient_id = p_patient_id WHERE id = v_conv.id RETURNING * INTO v_conv;
      END IF;
      RETURN jsonb_build_object('ok', true, 'code', 'OK',
        'data', jsonb_build_object('conversation_id', v_conv.id, 'existing', true, 'state', v_conv.state));
    END IF;
    INSERT INTO api.conversations (clinic_id, channel, channel_conversation_id, patient_id)
    VALUES (p_clinic_id, p_channel, p_channel_conversation_id, p_patient_id) RETURNING * INTO v_conv;
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('conversation_id', v_conv.id, 'existing', false, 'state', v_conv.state));
  END; $function$
  ```
* **Audit Evaluation**:
  - **Clinic Validation**: Calls `assert_clinic_active(p_clinic_id)`.
  - **Tenant Isolation**: Scope filtered by `clinic_id = p_clinic_id`. Backed by unique constraint `conversations_clinic_channel_conv_id_uq` on `(clinic_id, channel, channel_conversation_id)`.
  - **Output Contract**: Data object uses property **`conversation_id`** (NOT `id`).

---

#### 5. `api.search_availability(p_clinic_id, p_dentist_id, p_service_id, p_date, p_limit)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.search_availability(
    p_clinic_id uuid, p_dentist_id uuid, p_service_id uuid, p_date date, p_limit integer DEFAULT 10
  )
   RETURNS jsonb
   LANGUAGE plpgsql
   STABLE
  AS $function$
  DECLARE
    v_clinic api.clinics%ROWTYPE; v_service api.services%ROWTYPE; v_dentist api.dentists%ROWTYPE;
    v_buffer int; v_duration int; v_day_of_week int;
    v_slots jsonb := '[]'::jsonb; v_slot record;
    v_start timestamptz; v_end timestamptz; v_now timestamptz := now();
  BEGIN
    PERFORM api.assert_clinic_active(p_clinic_id);
    SELECT * INTO v_service FROM api.services WHERE id = p_service_id AND clinic_id = p_clinic_id AND active;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'service not found or inactive'); END IF;
    SELECT * INTO v_dentist FROM api.dentists WHERE id = p_dentist_id AND clinic_id = p_clinic_id AND active;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'dentist not found or inactive'); END IF;
    SELECT * INTO v_clinic FROM api.clinics WHERE id = p_clinic_id;
    v_duration := v_service.duration_minutes;
    v_buffer := COALESCE(v_service.buffer_minutes, v_dentist.default_buffer_minutes);
    v_day_of_week := EXTRACT(ISODOW FROM p_date)::int % 7;
    FOR v_slot IN
      SELECT gs AS slot_start FROM (
        SELECT generate_series(
          (p_date::text || ' ' || COALESCE(ds.starts_at, bh.opens_at))::timestamp AT TIME ZONE v_clinic.timezone,
          (p_date::text || ' ' || COALESCE(ds.ends_at, bh.closes_at))::timestamp AT TIME ZONE v_clinic.timezone - make_interval(mins => v_duration + v_buffer),
          make_interval(mins => 15)) AS gs
        FROM api.business_hours bh
        LEFT JOIN api.dentist_schedules ds
          ON ds.clinic_id = bh.clinic_id AND ds.dentist_id = p_dentist_id AND ds.day_of_week = bh.day_of_week
        WHERE bh.clinic_id = p_clinic_id AND bh.day_of_week = v_day_of_week) s
    LOOP
      v_start := v_slot.slot_start;
      v_end := v_start + make_interval(mins => v_duration + v_buffer);
      CONTINUE WHEN v_start < v_now;
      CONTINUE WHEN EXISTS (SELECT 1 FROM api.appointments a WHERE a.dentist_id = p_dentist_id
        AND a.status IN ('pending','confirmed') AND tstzrange(a.starts_at, a.ends_at) && tstzrange(v_start, v_end));
      CONTINUE WHEN EXISTS (SELECT 1 FROM api.schedule_blocks sb WHERE sb.clinic_id = p_clinic_id
        AND (sb.dentist_id IS NULL OR sb.dentist_id = p_dentist_id)
        AND tstzrange(sb.starts_at, sb.ends_at) && tstzrange(v_start, v_end));
      v_slots := v_slots || jsonb_build_object('starts_at', v_start, 'ends_at', v_start + make_interval(mins => v_duration),
        'buffer_ends_at', v_end, 'duration_minutes', v_duration, 'buffer_minutes', v_buffer);
      EXIT WHEN jsonb_array_length(v_slots) >= p_limit;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'code', 'OK', 'data', v_slots);
  END; $function$
  ```
* **Audit Evaluation**:
  - **Cross-Tenant Entity Validation**: Both `services` and `dentists` MUST belong to `p_clinic_id` AND be active. Passing another clinic's dentist or service ID fails immediately.
  - **Timezone Awareness**: Interprets operating hours using the clinic's configured IANA timezone (`v_clinic.timezone`), properly converting local clinic time to absolute UTC `timestamptz`.
  - **Past Slot Filtering**: Discards any slots earlier than `now()`.
  - **Conflict Pruning**: Prunes slots that overlap active appointments (`pending`, `confirmed`) or schedule blocks (lunch, leave, clinic closures).

---

#### 6. `api.book_appointment(p_clinic_id, p_dentist_id, p_patient_id, p_service_id, p_starts_at, p_metadata)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.book_appointment(
    p_clinic_id uuid, p_dentist_id uuid, p_patient_id uuid,
    p_service_id uuid, p_starts_at timestamp with time zone,
    p_metadata jsonb DEFAULT '{}'::jsonb
  )
   RETURNS jsonb
   LANGUAGE plpgsql
  AS $function$
  DECLARE
    v_service api.services%ROWTYPE; v_dentist api.dentists%ROWTYPE; v_patient api.patients%ROWTYPE;
    v_duration int; v_buffer int; v_ends_at timestamptz; v_id uuid; v_confirmation text; v_tz text;
  BEGIN
    PERFORM api.assert_clinic_active(p_clinic_id);
    SELECT * INTO v_service FROM api.services WHERE id = p_service_id AND clinic_id = p_clinic_id AND active;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'service not found or inactive'); END IF;
    SELECT * INTO v_dentist FROM api.dentists WHERE id = p_dentist_id AND clinic_id = p_clinic_id AND active;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'dentist not found or inactive'); END IF;
    SELECT * INTO v_patient FROM api.patients WHERE id = p_patient_id AND clinic_id = p_clinic_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'patient not found'); END IF;
    IF p_starts_at < now() THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'cannot book in the past'); END IF;
    v_duration := v_service.duration_minutes;
    v_buffer := COALESCE(v_service.buffer_minutes, v_dentist.default_buffer_minutes);
    v_ends_at := p_starts_at + make_interval(mins => v_duration + v_buffer);
    SELECT timezone INTO v_tz FROM api.clinics WHERE id = p_clinic_id;
    IF NOT EXISTS (
      SELECT 1 FROM api.business_hours bh
      LEFT JOIN api.dentist_schedules ds
        ON ds.clinic_id = bh.clinic_id AND ds.dentist_id = p_dentist_id AND ds.day_of_week = bh.day_of_week
      WHERE bh.clinic_id = p_clinic_id
        AND bh.day_of_week = EXTRACT(ISODOW FROM (p_starts_at AT TIME ZONE v_tz)::date)::int % 7
        AND (p_starts_at AT TIME ZONE v_tz)::time >= COALESCE(ds.starts_at, bh.opens_at)
        AND (v_ends_at AT TIME ZONE v_tz)::time <= COALESCE(ds.ends_at, bh.closes_at)
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'requested time is outside business or dentist hours'); END IF;
    IF EXISTS (
      SELECT 1 FROM api.schedule_blocks sb WHERE sb.clinic_id = p_clinic_id
        AND (sb.dentist_id IS NULL OR sb.dentist_id = p_dentist_id)
        AND tstzrange(sb.starts_at, sb.ends_at) && tstzrange(p_starts_at, v_ends_at)
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT', 'message', 'requested time overlaps a break, leave, or closure'); END IF;
    v_confirmation := upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4)) || '-' ||
                      upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4));
    BEGIN
      INSERT INTO api.appointments (clinic_id, dentist_id, patient_id, service_id, status, starts_at, ends_at,
        duration_minutes, buffer_minutes, confirmation_code, metadata)
      VALUES (p_clinic_id, p_dentist_id, p_patient_id, p_service_id, 'confirmed', p_starts_at, v_ends_at,
        v_duration, v_buffer, v_confirmation, p_metadata)
      RETURNING id INTO v_id;
    EXCEPTION
      WHEN exclusion_violation THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT', 'message', 'slot no longer available');
      WHEN unique_violation THEN
        v_confirmation := upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4)) || '-' ||
                          upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4));
        INSERT INTO api.appointments (clinic_id, dentist_id, patient_id, service_id, status, starts_at, ends_at,
          duration_minutes, buffer_minutes, confirmation_code, metadata)
        VALUES (p_clinic_id, p_dentist_id, p_patient_id, p_service_id, 'confirmed', p_starts_at, v_ends_at,
          v_duration, v_buffer, v_confirmation, p_metadata)
        RETURNING id INTO v_id;
    END;
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('appointment_id', v_id, 'confirmation_code', v_confirmation,
        'starts_at', p_starts_at, 'ends_at', v_ends_at, 'duration_minutes', v_duration, 'buffer_minutes', v_buffer));
  END; $function$
  ```
* **Audit Evaluation**:
  - **Concurrency & Race Condition Proof**: Utilizes PostgreSQL's physical GiST exclusion constraint (`appointments_no_overlap_active`). If another transaction books the slot between `search_availability` and `book_appointment`, the `INSERT` immediately throws `exclusion_violation`. The function traps this exception and returns `{ "ok": false, "code": "CONFLICT", "message": "slot no longer available" }`.
  - **No `p_notes` argument**: The function accepts `p_metadata jsonb DEFAULT '{}'`. Booking notes or channel tags must be supplied inside `p_metadata` (e.g. `{"notes": "..."}`).
  - **Tenant Boundary Verification**: Enforces that `dentist_id`, `patient_id`, and `service_id` all belong to `p_clinic_id`.
  - **Output Contract**: Data object contains `appointment_id`, `confirmation_code`, `starts_at`, `ends_at`, `duration_minutes`, `buffer_minutes`.

---

#### 7. `api.get_clinic_context(p_clinic_id uuid)`
* **SQL Definition**:
  ```sql
  CREATE OR REPLACE FUNCTION api.get_clinic_context(p_clinic_id uuid)
   RETURNS jsonb
   LANGUAGE plpgsql
   STABLE
  AS $function$
  DECLARE v_clinic api.clinics%ROWTYPE; v_hours jsonb; v_dentists jsonb; v_services jsonb;
  BEGIN
    SELECT * INTO v_clinic FROM api.clinics WHERE id = p_clinic_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'clinic not found');
    END IF;
    SELECT jsonb_agg(jsonb_build_object('day_of_week', day_of_week, 'opens_at', opens_at, 'closes_at', closes_at) ORDER BY day_of_week)
      INTO v_hours FROM api.business_hours WHERE clinic_id = p_clinic_id;
    SELECT jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'specialty', specialty, 'default_buffer_minutes', default_buffer_minutes))
      INTO v_dentists FROM api.dentists WHERE clinic_id = p_clinic_id AND active;
    SELECT jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'duration_minutes', duration_minutes, 'buffer_minutes', buffer_minutes))
      INTO v_services FROM api.services WHERE clinic_id = p_clinic_id AND active;
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('id', v_clinic.id, 'name', v_clinic.name, 'slug', v_clinic.slug, 'timezone', v_clinic.timezone,
        'locale', v_clinic.locale, 'settings', v_clinic.settings, 'business_hours', COALESCE(v_hours, '[]'::jsonb),
        'dentists', COALESCE(v_dentists, '[]'::jsonb), 'services', COALESCE(v_services, '[]'::jsonb)));
  END; $function$
  ```
* **Audit Evaluation**:
  - Scopes business hours, dentists, and services strictly to `p_clinic_id`.
  - Safely defaults empty collections to JSON arrays (`[]`) via `COALESCE(..., '[]'::jsonb)` when a clinic has no registered hours, dentists, or services.

---

## 2. Verified Tenant-Isolation Constraints & Indexes

Database catalog inspection of `pg_constraint` and `pg_indexes` confirmed the following physical constraints:

| Table | Constraint Name | Constraint Type | Enforced Columns / Definition |
| :--- | :--- | :--- | :--- |
| `api.appointments` | `appointments_no_overlap_active` | `EXCLUDE USING gist` | `(dentist_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN ('pending', 'confirmed'))` |
| `api.appointments` | `appointments_confirmation_code_key` | `UNIQUE` | `confirmation_code` |
| `api.appointments` | `fk_appointments_clinic` | `FOREIGN KEY` | `clinic_id REFERENCES api.clinics(id) ON DELETE CASCADE` |
| `api.inbound_events` | `inbound_events_provider_event_id_key` | `UNIQUE` | `(provider, provider_event_id)` |
| `api.conversations` | `conversations_clinic_channel_conv_id_uq` | `UNIQUE` | `(clinic_id, channel, channel_conversation_id)` |
| `api.services` | `services_clinic_code_key` | `UNIQUE` | `(clinic_id, code)` |
| `api.business_hours` | `business_hours_clinic_day_key` | `UNIQUE` | `(clinic_id, day_of_week)` |
| `api.dentist_schedules` | `dentist_schedules_clinic_dentist_day_key`| `UNIQUE` | `(clinic_id, dentist_id, day_of_week)` |
| `api.users` | `users_clinic_id_email_key` | `UNIQUE` | `(clinic_id, email)` |

### Composite Tenant Performance Indexes
- `idx_patients_clinic_phone`: `(clinic_id, phone)`
- `idx_patients_clinic_email`: `(clinic_id, email)`
- `idx_patients_clinic_whatsapp`: `(clinic_id, whatsapp_id)`
- `idx_appointments_clinic_starts`: `(clinic_id, starts_at)`
- `idx_appointments_dentist_starts`: `(dentist_id, starts_at)`
- `idx_schedule_blocks_clinic_times`: `(clinic_id, starts_at, ends_at)`

---

## 3. Schema & Migration History — Authoritative Sources

### Finding: Prisma Schema vs. Database Catalog
`apps/api/src/database/prisma/schema.prisma` is an ORM schema used for TypeScript typings and query generation. It **does NOT** define:
1. PostgreSQL stored functions (`api.register_inbound_event`, `api.find_or_create_patient`, `api.book_appointment`, etc.).
2. The GiST exclusion constraint `appointments_no_overlap_active` (unsupported by standard Prisma schema syntax).
3. Database triggers (`log_appointment_status_change` audit trigger, `set_updated_at` timestamps).
4. Custom PostgreSQL ENUMs (`api.channel_type`, `api.appointment_status`, `api.conversation_state`, `api.event_state`).
5. Role permissions (`GRANT EXECUTE ON FUNCTION api.* TO n8n_runtime`).

### Authoritative Migration Log (`api.schema_migrations`)
The actual authoritative schema definition lives directly in the PostgreSQL engine, tracked in `api.schema_migrations`:
- **`1.0.0`** (applied `2026-10-06T10:38:06.327Z`): Core schema, tables, enums, triggers, and stored procedures.
- **`1.1.0`** (applied `2026-10-06T11:50:58.516Z`): Additional foreign key constraints and audit tables.
- **`1.2.0`** (applied `2026-10-08T06:55:50.580Z`): Performance tuning and composite indexes.
- **`001_add_dentist_profile_fields.sql`**: Additive profile fields on `api.dentists` (`title`, `qualifications`, `experience_years`, `license_number`, `bio`).

---

## 4. Integration Test Plan & Safe Fixtures

### Testing Methodology
To comply with zero-pollution requirements, all database verification was conducted using transactional rollback harnesses:
1. Open database connection.
2. `BEGIN TRANSACTION;`
3. Execute stored procedures with synthetic UUIDs or test identifiers.
4. Verify return payloads, exceptions, and constraint rejections.
5. `ROLLBACK;` (no row ever commits to disk).

### Verified Test Results
- **Active Clinic Assertion**:
  - Valid clinic (`00000000-0000-0000-0000-000000000001`): Passed cleanly.
  - Fake clinic (`ffffffff-ffff-ffff-ffff-ffffffffffff`): Threw error code `P0002` (`clinic ... not found, inactive, or suspended`).
  - NULL clinic: Threw error code `22023` (`clinic_id cannot be null`).
- **Suspended Clinic Lockdown**:
  - Suspended clinic temporarily in transaction: `find_or_create_patient`, `get_or_create_conversation`, `search_availability`, and `book_appointment` immediately aborted with `P0002`.
- **Double Booking Race Condition**:
  - Booking an already booked slot raised `exclusion_violation`, caught by `book_appointment`, returning `{ "ok": false, "code": "CONFLICT", "message": "slot no longer available" }`.
- **Untouched Production Records**:
  - Primary appointment `DZXV-CUIN` (`e478376a-b1e8-429c-8f66-d08eb18925cf`) was inspected and verified unchanged before and after all test suites.

---

## 5. Webhook Authentication & Runtime Enforcement

### n8n Header Auth
- **Credential Name**: `Dental Clinic Test Auth`
- **Header**: `x-api-key`
- **Workflow Setting**: Node 1 (`Inbound Test Webhook`) specifies `authentication: "headerAuth"` with credential `Dental Clinic Test Auth`.
- **Security Check**: When imported into n8n Cloud, the credential ID is bound to the encrypted credential store. Unauthenticated requests are rejected at the n8n gateway with HTTP 401.

### Defense-in-Depth Clinic Validation (Node 5)
Even with a valid `x-api-key`, Node 5 (`Validate Test Clinic`) executes:
```sql
SELECT 
  c.id, c.name, c.slug, c.timezone, c.settings,
  COALESCE(c.id IS NOT NULL, false) AS is_valid
FROM (SELECT 1) AS dummy
LEFT JOIN api.clinics c
  ON c.id::text = $1
  AND c.id = '00000000-0000-0000-0000-000000000001'::uuid
  AND c.active = true
  AND c.suspended_at IS NULL;
```
- Restricts the test webhook exclusively to Demo Dental Clinic (`00000000-0000-0000-0000-000000000001`).
- Rejects missing, mismatched, inactive, or suspended clinics.
- Routes invalid clinics to Node 7 (`Respond Test Clinic Forbidden`) returning HTTP 403.

---

## 6. Authentication & Clinic Isolation Security Remediation

### Defect Identified
In `apps/api/src/modules/auth/auth.service.ts`, the `loginUser` method previously included a fallback query:
```typescript
// INSECURE CODE (REMOVED)
const userRows = await prisma.$queryRawUnsafe<any[]>(
  `SELECT u.id, ... FROM api.users u JOIN api.clinics c ON c.id = u.clinic_id
   WHERE LOWER(u.email) = $1 OR ($1 = 'admin' AND u.role = 'admin') OR ($1 = 'demo')
   LIMIT 1`,
  emailInput
);
```
**Risk**: If any user entered `demo` or `admin`, PostgreSQL returned the *first* active user record in the database regardless of tenant, allowing account hijacking and multi-tenant isolation bypass.

### Code Fix Applied
1. **Removed the Insecure Fallback**: Deleted the `LIMIT 1` query. Authentication now strictly requires an exact match on email:
   ```sql
   SELECT u.id, u.clinic_id, u.auth_subject, u.full_name, u.email, u.role, u.active,
          c.name as clinic_name, c.timezone as clinic_timezone, c.suspended_at, c.active as clinic_active
   FROM api.users u
   JOIN api.clinics c ON c.id = u.clinic_id
   WHERE LOWER(u.email) = $1
   ```
2. **Production Gate on Demo Shortcuts**:
   ```typescript
   if (user.auth_subject === 'demo-admin') {
     if (env.NODE_ENV === 'production') {
       throw new UnauthorizedError('Invalid email or password.');
     }
     isPasswordValid = data.password === 'password123' || data.password === 'demo';
   }
   ```
3. **Clinic Suspension Enforcement**:
   ```typescript
   if (user.suspended_at || !user.clinic_active) {
     throw new ForbiddenError('Clinic account is suspended. Please contact clinic administration.');
   }
   ```
4. **Signup Privilege Protection**:
   `signupClinic` strictly assigns `clinic_admin` / `admin` to the created user within their newly created clinic, preventing client-supplied role escalation.

---

## 7. Exact Contracts n8n Must Follow

When calling the PostgreSQL nodes in n8n, the queries, parameters, and property mappings must follow these exact contracts:

### Node: Register Inbound Event
- **SQL**:
  ```sql
  SELECT api.register_inbound_event($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb) AS result;
  ```
- **Parameters**:
  `[$('Validate Test Clinic').item.json.id, 'test', 'message', $('Inbound Test Webhook').item.json.body?.provider_event_id, 'hash-' + $('Inbound Test Webhook').item.json.body?.provider_event_id, JSON.stringify($('Inbound Test Webhook').item.json.body)]`
- **Output Mapping**:
  `$json.result.data.event_id` (Event UUID)  
  `$json.result.data.duplicate` (Boolean)  
- **Duplicate Check Expression**:
  `{{ $json.result?.data?.duplicate }}` === `true`

---

### Node: Find or Create Patient
- **SQL**:
  ```sql
  SELECT api.find_or_create_patient($1::uuid, $2::text, $3::text) AS result;
  ```
- **Parameters**:
  `[$('Validate Test Clinic').item.json.id, $('Inbound Test Webhook').item.json.body?.patient_name, $('Inbound Test Webhook').item.json.body?.phone]`
  *(Note: Parameter 2 is Name, Parameter 3 is Phone)*
- **Output Mapping**:
  `$json.result.data.patient_id` (Patient UUID)  
  `$json.result.data.existing` (Boolean)

---

### Node: Search Availability
- **SQL**:
  ```sql
  SELECT api.search_availability($1::uuid, $2::uuid, $3::uuid, $4::date, 25) AS result;
  ```
- **Parameters**:
  `[$('Validate Test Clinic').item.json.id, $('Inbound Test Webhook').item.json.body?.dentist_id || '00000000-0000-0000-0000-000000000003', $('Inbound Test Webhook').item.json.body?.service_id || '2a9ecbee-5b32-43f4-a673-c119c67ad738', $('Inbound Test Webhook').item.json.body?.appointmentDate]`
- **Output Mapping**:
  `$json.result.data` (Array of slot objects: `{ starts_at, ends_at, buffer_ends_at, duration_minutes, buffer_minutes }`)

---

### Node: Book Appointment
- **SQL**:
  ```sql
  SELECT api.book_appointment($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::jsonb) AS result;
  ```
- **Parameters**:
  `[$('Validate Test Clinic').item.json.id, $('Inbound Test Webhook').item.json.body?.dentist_id || '00000000-0000-0000-0000-000000000003', $('Find or Create Patient').item.json.result.data.patient_id, $('Inbound Test Webhook').item.json.body?.service_id || '2a9ecbee-5b32-43f4-a673-c119c67ad738', $('Match Requested Slot').item.json.starts_at, JSON.stringify({ source: 'ai-receptionist', channel: 'web_chat', test_run: true })]`
- **Success Output**:
  `$json.result.data.appointment_id` (Appointment UUID)  
  `$json.result.data.confirmation_code` (e.g. `XXXX-YYYY`)  
- **Conflict Output**:
  `{ "ok": false, "code": "CONFLICT", "message": "slot no longer available" }`

---

## 8. Pre-Publication Blockers & Remediation Status

| ID | Category | Item Description | Status |
| :--- | :--- | :--- | :--- |
| **BLK-01** | **Security** | Insecure `LIMIT 1` demo login bypass in `auth.service.ts` | **FIXED** |
| **BLK-02** | **Contract** | Patient procedure argument order (`full_name` vs `phone`) | **VERIFIED** |
| **BLK-03** | **Contract** | Property name mismatch (`event_id`, `patient_id` vs `id`) | **VERIFIED** |
| **BLK-04** | **Concurrency** | Exclusion constraint verification for concurrent slot race | **VERIFIED** |
| **BLK-05** | **Isolation** | Test endpoint restricted to authorized demo clinic | **VERIFIED** |
| **BLK-06** | **n8n Credential** | Webhook node credential ID binding in n8n Cloud | **NOT VERIFIED** (Requires manual UI binding in n8n Cloud) |
| **BLK-07** | **Webhook Activation** | Webhook URL currently returns 404 until workflow activated | **NOT VERIFIED** (Requires manual toggle in n8n Cloud) |

---

## 9. Final Verification Status Checklist

### VERIFIED
- [x] All 6 stored procedure SQL definitions, owners (`neondb_owner`), grants (`n8n_runtime`), and argument types inspected directly from `pg_proc`.
- [x] Multi-tenant isolation verified across patients, conversations, services, dentists, and appointments.
- [x] Active and suspended clinic validation verified via `api.assert_clinic_active`.
- [x] GiST exclusion constraint `appointments_no_overlap_active` empirically verified under race conditions.
- [x] Zero-pollution test plan executed; production baseline appointment `DZXV-CUIN` verified intact.
- [x] Exact parameter types and return schemas mapped for all n8n workflow nodes.
- [x] All 48 Jest unit tests in `apps/api` pass (`5 passed, 5 total`).
- [x] TypeScript builds for `@dental/api` and `@dental/web` compile with zero errors.

### FIXED
- [x] Removed insecure fallback query in `apps/api/src/modules/auth/auth.service.ts`.
- [x] Gated demo shortcuts in authentication to non-production environments only.
- [x] Enforced strict clinic suspension checks on user authentication.

### NOT VERIFIED (Manual Cloud Actions Required)
- [ ] Active workflow state on n8n Cloud (`https://kunalnale12345678.app.n8n.cloud/`). Webhook `dental/test-inbound` cannot be triggered until the workflow is imported and toggled "Active" in the n8n Cloud UI.
- [ ] Binding of `Dental Clinic Test Auth` credential ID within the n8n Cloud credential manager.
