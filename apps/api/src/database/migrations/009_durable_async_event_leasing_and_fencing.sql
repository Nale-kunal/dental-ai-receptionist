-- Migration: 009_durable_async_event_leasing_and_fencing.sql
-- Version: 1.8.0
-- Scope: Multi-tenant inbound event identity scoping, atomic worker leases,
--        monotonic fencing tokens, transactional outbox for WhatsApp delivery,
--        fenced idempotent appointment booking, and crash recovery.
--
-- DO NOT APPLY TO PRODUCTION WITHOUT USER AUTHORIZATION.
--
-- ============================================================================
-- PRE-MIGRATION SAFETY VERIFICATION (Run prior to Phase 1):
-- 1. Verify null clinic_id count is 0:
--    SELECT count(*) FROM api.inbound_events WHERE clinic_id IS NULL; (Verified: 0)
-- 2. Verify duplicate (clinic_id, provider, provider_event_id) count is 0:
--    SELECT clinic_id, provider, provider_event_id, count(*) FROM api.inbound_events
--    GROUP BY clinic_id, provider, provider_event_id HAVING count(*) > 1; (Verified: 0)
-- ============================================================================

-- ============================================================================
-- PHASE 1: ENUM VALUES COMMITTED IN SEPARATE DEDICATED TRANSACTION
-- PostgreSQL requires new enum values to be committed before they can be
-- referenced in index predicates, column defaults, or DDL expressions.
-- ============================================================================
BEGIN;

ALTER TYPE api.event_state ADD VALUE IF NOT EXISTS 'processing' AFTER 'received';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_state' AND typnamespace = 'api'::regnamespace) THEN
    CREATE TYPE api.outbox_state AS ENUM ('pending', 'claimed', 'dispatched', 'ambiguous', 'failed');
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- PHASE 2: DDL, TABLES, CONSTRAINTS, INDEXES, AND STORED PROCEDURES
-- ============================================================================
BEGIN;

-- 1. Multi-tenant Inbound Events Unique Constraint
ALTER TABLE api.inbound_events DROP CONSTRAINT IF EXISTS inbound_events_provider_provider_event_id_key;
ALTER TABLE api.inbound_events DROP CONSTRAINT IF EXISTS inbound_events_clinic_provider_event_key;
DROP INDEX IF EXISTS api.inbound_events_provider_event_idx;

ALTER TABLE api.inbound_events
  ADD CONSTRAINT inbound_events_clinic_provider_event_key UNIQUE (clinic_id, provider, provider_event_id);

CREATE INDEX IF NOT EXISTS inbound_events_clinic_provider_event_idx
  ON api.inbound_events (clinic_id, provider, provider_event_id);

-- 2. Add Leasing and Concurrency Columns to api.inbound_events
ALTER TABLE api.inbound_events
  ADD COLUMN IF NOT EXISTS lease_owner text NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS fencing_token bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS appointment_id uuid NULL REFERENCES api.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inbound_events_lease_sweep_idx
  ON api.inbound_events (state, lease_expires_at)
  WHERE state IN ('received', 'processing', 'failed');

-- 3. Extend api.appointments with inbound_event_id and Unique Partial Index
ALTER TABLE api.appointments
  ADD COLUMN IF NOT EXISTS inbound_event_id uuid NULL REFERENCES api.inbound_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_clinic_inbound_event_idx
  ON api.appointments (clinic_id, inbound_event_id)
  WHERE inbound_event_id IS NOT NULL;

-- 4. Create Transactional Outbox: api.outbox_messages
CREATE TABLE IF NOT EXISTS api.outbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES api.clinics(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES api.conversations(id) ON DELETE CASCADE,
  inbound_event_id uuid NOT NULL REFERENCES api.inbound_events(id) ON DELETE CASCADE,
  recipient_phone text NOT NULL,
  message_payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  state api.outbox_state NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text NULL,
  lease_expires_at timestamptz NULL,
  fencing_token bigint NOT NULL DEFAULT 0,
  provider_message_id text NULL,
  last_http_status integer NULL,
  last_error jsonb NULL,
  dispatched_at timestamptz NULL,
  reconciled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_messages_inbound_event_uniq UNIQUE (inbound_event_id)
);

CREATE INDEX IF NOT EXISTS outbox_messages_sweep_idx
  ON api.outbox_messages (state, lease_expires_at)
  WHERE state IN ('pending', 'claimed', 'ambiguous');

CREATE INDEX IF NOT EXISTS outbox_messages_provider_id_idx
  ON api.outbox_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ============================================================================
-- 5. FUNCTION: api.register_inbound_event
-- Durably persists inbound events before Meta HTTP acknowledgment (<100ms).
-- ============================================================================
CREATE OR REPLACE FUNCTION api.register_inbound_event(
    p_clinic_id uuid,
    p_provider text,
    p_event_type text,
    p_provider_event_id text,
    p_payload_hash text,
    p_raw_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_event api.inbound_events%ROWTYPE;
  v_existing api.inbound_events%ROWTYPE;
BEGIN
  IF p_clinic_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CLINIC', 'message', 'clinic_id is required'); END IF;
  IF p_provider IS NULL OR trim(p_provider) = '' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PROVIDER', 'message', 'provider is required'); END IF;
  IF p_provider_event_id IS NULL OR trim(p_provider_event_id) = '' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_ID', 'message', 'provider_event_id is required'); END IF;

  INSERT INTO api.inbound_events (
    clinic_id, provider, event_type, provider_event_id,
    payload_hash, raw_payload, state, attempts, created_at
  ) VALUES (
    p_clinic_id, p_provider, p_event_type, p_provider_event_id,
    p_payload_hash, p_raw_payload, 'received', 0, now()
  )
  ON CONFLICT (clinic_id, provider, provider_event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('event_id', v_event.id, 'state', v_event.state, 'duplicate', false, 'is_retry', false));
  END IF;

  SELECT * INTO v_existing FROM api.inbound_events
  WHERE clinic_id = p_clinic_id AND provider = p_provider AND provider_event_id = p_provider_event_id
  FOR UPDATE;

  IF v_existing.state = 'processed'
     OR (v_existing.state = 'processing' AND v_existing.lease_expires_at > now())
     OR (v_existing.state = 'received' AND v_existing.created_at >= now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'OK',
      'data', jsonb_build_object('event_id', v_existing.id, 'state', v_existing.state, 'duplicate', true, 'is_retry', false));
  END IF;

  IF v_existing.state = 'dead_letter' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'DEAD_LETTER',
      'data', jsonb_build_object('event_id', v_existing.id, 'state', v_existing.state, 'duplicate', true, 'is_retry', false));
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('event_id', v_existing.id, 'state', v_existing.state, 'duplicate', false, 'is_retry', true));
END;
$$;

-- ============================================================================
-- 6. FUNCTION: api.claim_inbound_event
-- Atomically claims event with time-bounded lease and monotonic fencing token.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.claim_inbound_event(
    p_event_id uuid,
    p_worker_id text,
    p_lease_seconds int DEFAULT 60
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_event api.inbound_events%ROWTYPE;
  v_max_attempts int := 3;
BEGIN
  SELECT * INTO v_event FROM api.inbound_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND'); END IF;
  IF v_event.state = 'processed' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_PROCESSED'); END IF;
  IF v_event.state = 'dead_letter' THEN RETURN jsonb_build_object('ok', false, 'code', 'DEAD_LETTER'); END IF;

  IF v_event.state = 'processing' AND v_event.lease_expires_at > now() THEN
    IF v_event.lease_owner = p_worker_id THEN
      UPDATE api.inbound_events
      SET lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval, last_attempt_at = now()
      WHERE id = p_event_id RETURNING * INTO v_event;
      RETURN jsonb_build_object('ok', true, 'code', 'LEASE_RENEWED',
        'data', jsonb_build_object('event_id', v_event.id, 'fencing_token', v_event.fencing_token, 'lease_owner', v_event.lease_owner));
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_LOCKED', 'message', 'Lease owned by active worker');
    END IF;
  END IF;

  IF v_event.attempts >= v_max_attempts THEN
    UPDATE api.inbound_events
    SET state = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
        error = jsonb_build_object('reason', 'MAX_ATTEMPTS_EXCEEDED', 'attempts', v_event.attempts)
    WHERE id = p_event_id;
    RETURN jsonb_build_object('ok', false, 'code', 'DEAD_LETTER_LIMIT');
  END IF;

  UPDATE api.inbound_events
  SET state = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      fencing_token = v_event.fencing_token + 1,
      attempts = v_event.attempts + 1,
      last_attempt_at = now()
  WHERE id = p_event_id RETURNING * INTO v_event;

  RETURN jsonb_build_object('ok', true, 'code', 'CLAIM_ACQUIRED',
    'data', jsonb_build_object(
      'event_id', v_event.id, 'clinic_id', v_event.clinic_id,
      'provider', v_event.provider, 'provider_event_id', v_event.provider_event_id,
      'fencing_token', v_event.fencing_token, 'lease_owner', v_event.lease_owner,
      'lease_expires_at', v_event.lease_expires_at, 'attempts', v_event.attempts,
      'appointment_id', v_event.appointment_id
    ));
END;
$$;

-- ============================================================================
-- 7. FUNCTION: api.book_appointment (Fenced & Idempotent)
-- Enforces:
--   a) Fencing token validation inside the same transaction
--   b) Stale worker rejection
--   c) Idempotent reuse of already-booked appointment for this event
--   d) GiST exclusion slot reservation
-- ============================================================================
CREATE OR REPLACE FUNCTION api.book_appointment(
    p_clinic_id uuid,
    p_dentist_id uuid,
    p_patient_id uuid,
    p_service_id uuid,
    p_starts_at timestamptz,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_inbound_event_id uuid DEFAULT NULL,
    p_fencing_token bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_event api.inbound_events%ROWTYPE;
  v_existing_appt api.appointments%ROWTYPE;
  v_service api.services%ROWTYPE;
  v_dentist api.dentists%ROWTYPE;
  v_patient api.patients%ROWTYPE;
  v_duration int;
  v_buffer int;
  v_ends_at timestamptz;
  v_tz text;
  v_appt_id uuid;
  v_conf text;
BEGIN
  PERFORM api.assert_clinic_active(p_clinic_id);

  -- 1. Fencing and Lease Validation (when called from event workflow)
  IF p_inbound_event_id IS NOT NULL THEN
    SELECT * INTO v_event FROM api.inbound_events WHERE id = p_inbound_event_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND'); END IF;

    IF v_event.state <> 'processing' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_STATE', 'message', 'Event not in processing state');
    END IF;

    IF p_fencing_token IS NOT NULL AND v_event.fencing_token <> p_fencing_token THEN
      RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH', 'message', 'Worker lease is stale');
    END IF;

    IF v_event.lease_expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease has expired');
    END IF;

    -- 2. Idempotency Check: Was appointment already created for this inbound event?
    SELECT * INTO v_existing_appt
    FROM api.appointments
    WHERE clinic_id = p_clinic_id AND inbound_event_id = p_inbound_event_id AND status IN ('pending', 'confirmed');

    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'code', 'OK',
        'data', jsonb_build_object(
          'appointment_id', v_existing_appt.id,
          'confirmation_code', v_existing_appt.confirmation_code,
          'starts_at', v_existing_appt.starts_at,
          'ends_at', v_existing_appt.ends_at,
          'duration_minutes', v_existing_appt.duration_minutes,
          'buffer_minutes', v_existing_appt.buffer_minutes,
          'already_booked', true
        ));
    END IF;
  END IF;

  -- 3. Business rule validations
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

  v_conf := upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4)) || '-' ||
            upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4));

  -- 4. Atomic Insert with Exclusion Constraint
  BEGIN
    INSERT INTO api.appointments (
      clinic_id, dentist_id, patient_id, service_id, inbound_event_id,
      status, starts_at, ends_at, duration_minutes, buffer_minutes, confirmation_code, metadata
    ) VALUES (
      p_clinic_id, p_dentist_id, p_patient_id, p_service_id, p_inbound_event_id,
      'confirmed', p_starts_at, v_ends_at, v_duration, v_buffer, v_conf, p_metadata
    ) RETURNING id INTO v_appt_id;

    IF p_inbound_event_id IS NOT NULL THEN
      UPDATE api.inbound_events SET appointment_id = v_appt_id WHERE id = p_inbound_event_id;
    END IF;

  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT', 'message', 'slot no longer available');
    WHEN unique_violation THEN
      SELECT * INTO v_existing_appt FROM api.appointments
      WHERE clinic_id = p_clinic_id AND inbound_event_id = p_inbound_event_id;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'code', 'OK',
          'data', jsonb_build_object('appointment_id', v_existing_appt.id, 'confirmation_code', v_existing_appt.confirmation_code, 'already_booked', true));
      END IF;
      -- If unique code violation, regenerate
      v_conf := upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4)) || '-' ||
                upper(substring(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'X'), '/', 'Y') FROM 1 FOR 4));
      INSERT INTO api.appointments (clinic_id, dentist_id, patient_id, service_id, inbound_event_id, status, starts_at, ends_at, duration_minutes, buffer_minutes, confirmation_code, metadata)
      VALUES (p_clinic_id, p_dentist_id, p_patient_id, p_service_id, p_inbound_event_id, 'confirmed', p_starts_at, v_ends_at, v_duration, v_buffer, v_conf, p_metadata)
      RETURNING id INTO v_appt_id;
  END;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object(
      'appointment_id', v_appt_id, 'confirmation_code', v_conf,
      'starts_at', p_starts_at, 'ends_at', v_ends_at, 'duration_minutes', v_duration, 'buffer_minutes', v_buffer, 'already_booked', false));
END;
$$;

-- ============================================================================
-- 8. FUNCTION: api.enqueue_outbox_message
-- Transactionally inserts outbox record inside the business execution.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.enqueue_outbox_message(
    p_clinic_id uuid,
    p_conversation_id uuid,
    p_inbound_event_id uuid,
    p_recipient_phone text,
    p_payload jsonb,
    p_idempotency_key text
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_outbox api.outbox_messages%ROWTYPE;
BEGIN
  INSERT INTO api.outbox_messages (
    clinic_id, conversation_id, inbound_event_id, recipient_phone,
    message_payload, idempotency_key, state, created_at
  ) VALUES (
    p_clinic_id, p_conversation_id, p_inbound_event_id, p_recipient_phone,
    p_payload, p_idempotency_key, 'pending', now()
  )
  ON CONFLICT (inbound_event_id) DO UPDATE
    SET message_payload = EXCLUDED.message_payload
  RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state, 'provider_message_id', v_outbox.provider_message_id));
END;
$$;

-- ============================================================================
-- 9. FUNCTION: api.claim_outbox_message
-- Atomically claims outbox message with fencing token and lease.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.claim_outbox_message(
    p_outbox_id uuid,
    p_worker_id text,
    p_lease_seconds int DEFAULT 60
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_outbox api.outbox_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_outbox FROM api.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'OUTBOX_NOT_FOUND'); END IF;
  IF v_outbox.state = 'dispatched' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_DISPATCHED', 'provider_message_id', v_outbox.provider_message_id);
  END IF;

  IF v_outbox.state = 'claimed' AND v_outbox.lease_expires_at > now() THEN
    IF v_outbox.lease_owner <> p_worker_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OUTBOX_LOCKED', 'message', 'Claimed by other active worker');
    END IF;
  END IF;

  UPDATE api.outbox_messages
  SET state = 'claimed',
      lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      fencing_token = v_outbox.fencing_token + 1,
      attempts = v_outbox.attempts + 1
  WHERE id = p_outbox_id RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('ok', true, 'code', 'CLAIMED',
    'data', jsonb_build_object(
      'outbox_id', v_outbox.id, 'fencing_token', v_outbox.fencing_token,
      'recipient_phone', v_outbox.recipient_phone, 'payload', v_outbox.message_payload
    ));
END;
$$;

-- ============================================================================
-- 10. FUNCTION: api.record_outbox_dispatched
-- Records confirmed Meta delivery; atomically marks inbound_event processed.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.record_outbox_dispatched(
    p_outbox_id uuid,
    p_fencing_token bigint,
    p_provider_message_id text,
    p_http_status int DEFAULT 200
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_outbox api.outbox_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_outbox FROM api.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'OUTBOX_NOT_FOUND'); END IF;

  IF v_outbox.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH');
  END IF;

  UPDATE api.outbox_messages
  SET state = 'dispatched',
      provider_message_id = p_provider_message_id,
      last_http_status = p_http_status,
      dispatched_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE id = p_outbox_id RETURNING * INTO v_outbox;

  UPDATE api.inbound_events
  SET state = 'processed', processed_at = now(), lease_owner = NULL, lease_expires_at = NULL
  WHERE id = v_outbox.inbound_event_id;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state, 'provider_message_id', v_outbox.provider_message_id));
END;
$$;

-- ============================================================================
-- 11. FUNCTION: api.record_outbox_ambiguous
-- Handles socket drops / HTTP timeouts during dispatch to Meta.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.record_outbox_ambiguous(
    p_outbox_id uuid,
    p_fencing_token bigint,
    p_error jsonb,
    p_http_status int DEFAULT 504
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_outbox api.outbox_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_outbox FROM api.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'OUTBOX_NOT_FOUND'); END IF;

  IF v_outbox.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH');
  END IF;

  UPDATE api.outbox_messages
  SET state = 'ambiguous',
      last_http_status = p_http_status,
      last_error = p_error,
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE id = p_outbox_id RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state));
END;
$$;

-- ============================================================================
-- 12. FUNCTION: api.record_outbox_failure
-- ============================================================================
CREATE OR REPLACE FUNCTION api.record_outbox_failure(
    p_outbox_id uuid,
    p_fencing_token bigint,
    p_error jsonb,
    p_http_status int DEFAULT 400,
    p_is_terminal boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_outbox api.outbox_messages%ROWTYPE;
  v_next_state api.outbox_state;
BEGIN
  SELECT * INTO v_outbox FROM api.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'OUTBOX_NOT_FOUND'); END IF;

  IF v_outbox.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH');
  END IF;

  IF p_is_terminal OR v_outbox.attempts >= 3 THEN
    v_next_state := 'failed';
  ELSE
    v_next_state := 'pending';
  END IF;

  UPDATE api.outbox_messages
  SET state = v_next_state,
      last_http_status = p_http_status,
      last_error = p_error,
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE id = p_outbox_id RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state));
END;
$$;

-- ============================================================================
-- 13. FUNCTION: api.claim_stale_inbound_events
-- Recovery worker: Discovers and atomically claims stalled/crashed events.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.claim_stale_inbound_events(
    p_worker_id text,
    p_lease_seconds int DEFAULT 60,
    p_limit int DEFAULT 5
)
RETURNS TABLE (
  event_id uuid,
  clinic_id uuid,
  provider text,
  provider_event_id text,
  fencing_token bigint,
  raw_payload jsonb
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT id
    FROM api.inbound_events
    WHERE (
      (state = 'processing' AND lease_expires_at <= now())
      OR (state = 'received' AND created_at <= now() - interval '30 seconds')
      OR (state = 'failed' AND last_attempt_at <= now() - interval '60 seconds')
    )
    AND attempts < 3
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE api.inbound_events e
  SET state = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      fencing_token = e.fencing_token + 1,
      attempts = e.attempts + 1,
      last_attempt_at = now()
  FROM stale
  WHERE e.id = stale.id
  RETURNING e.id, e.clinic_id, e.provider, e.provider_event_id, e.fencing_token, e.raw_payload;
END;
$$;

-- ============================================================================
-- 14. FUNCTION: api.claim_stale_outbox_messages
-- Recovery dispatcher: Discovers and claims stalled/ambiguous outbox messages.
-- ============================================================================
CREATE OR REPLACE FUNCTION api.claim_stale_outbox_messages(
    p_worker_id text,
    p_lease_seconds int DEFAULT 60,
    p_limit int DEFAULT 5
)
RETURNS TABLE (
  outbox_id uuid,
  clinic_id uuid,
  conversation_id uuid,
  inbound_event_id uuid,
  recipient_phone text,
  message_payload jsonb,
  fencing_token bigint
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT id
    FROM api.outbox_messages
    WHERE (
      (state = 'pending' AND created_at <= now() - interval '10 seconds')
      OR (state = 'claimed' AND lease_expires_at <= now())
      OR (state = 'ambiguous' AND created_at <= now() - interval '30 seconds')
    )
    AND attempts < 3
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE api.outbox_messages o
  SET state = 'claimed',
      lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      fencing_token = o.fencing_token + 1,
      attempts = o.attempts + 1
  FROM stale
  WHERE o.id = stale.id
  RETURNING o.id, o.clinic_id, o.conversation_id, o.inbound_event_id, o.recipient_phone, o.message_payload, o.fencing_token;
END;
$$;

-- ============================================================================
-- 15. FUNCTIONS: api.complete_inbound_event & api.fail_inbound_event
-- ============================================================================
CREATE OR REPLACE FUNCTION api.complete_inbound_event(
    p_event_id uuid,
    p_fencing_token bigint,
    p_error jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_event api.inbound_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM api.inbound_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND'); END IF;

  IF v_event.state <> 'processing' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_STATE');
  END IF;

  IF v_event.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH');
  END IF;

  IF v_event.lease_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LEASE_EXPIRED');
  END IF;

  UPDATE api.inbound_events
  SET state = 'processed', processed_at = now(), lease_owner = NULL, lease_expires_at = NULL, error = NULL
  WHERE id = p_event_id RETURNING * INTO v_event;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('event_id', v_event.id, 'state', v_event.state, 'processed_at', v_event.processed_at));
END;
$$;

CREATE OR REPLACE FUNCTION api.fail_inbound_event(
    p_event_id uuid,
    p_fencing_token bigint,
    p_error jsonb
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_event api.inbound_events%ROWTYPE;
  v_next_state api.event_state;
BEGIN
  SELECT * INTO v_event FROM api.inbound_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND'); END IF;

  IF v_event.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH');
  END IF;

  IF v_event.lease_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LEASE_EXPIRED');
  END IF;

  IF v_event.attempts >= 3 THEN
    v_next_state := 'dead_letter';
  ELSE
    v_next_state := 'failed';
  END IF;

  UPDATE api.inbound_events
  SET state = v_next_state, lease_owner = NULL, lease_expires_at = NULL, error = p_error
  WHERE id = p_event_id RETURNING * INTO v_event;

  RETURN jsonb_build_object('ok', true, 'code', 'OK',
    'data', jsonb_build_object('event_id', v_event.id, 'state', v_event.state));
END;
$$;

COMMIT;

-- ============================================================================
-- SAFE ROLLBACK SCRIPT (For reference only):
-- ============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS api.outbox_messages;
-- DROP INDEX IF EXISTS api.appointments_clinic_inbound_event_idx;
-- ALTER TABLE api.appointments DROP COLUMN IF EXISTS inbound_event_id;
-- DROP INDEX IF EXISTS api.inbound_events_lease_sweep_idx;
-- ALTER TABLE api.inbound_events DROP COLUMN IF EXISTS lease_owner;
-- ALTER TABLE api.inbound_events DROP COLUMN IF EXISTS lease_expires_at;
-- ALTER TABLE api.inbound_events DROP COLUMN IF EXISTS fencing_token;
-- ALTER TABLE api.inbound_events DROP COLUMN IF EXISTS appointment_id;
-- ALTER TABLE api.inbound_events DROP CONSTRAINT IF EXISTS inbound_events_clinic_provider_event_key;
-- ALTER TABLE api.inbound_events ADD CONSTRAINT inbound_events_provider_provider_event_id_key UNIQUE (provider, provider_event_id);
-- DROP TYPE IF EXISTS api.outbox_state;
-- COMMIT;
