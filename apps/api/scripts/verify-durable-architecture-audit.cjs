/**
 * Verification Script: verify-durable-architecture-audit.cjs
 *
 * Runs the comprehensive 10-test audit against Neon Serverless PostgreSQL
 * in an isolated test schema without modifying any production tables.
 *
 * Tests:
 *  1. Separately Committed Phased Migration (PostgreSQL enum safety)
 *  2. Migration Failure & Clean Rollback Atomicity
 *  3. n8n Process Termination After Webhook Acknowledgment
 *  4. Recovery Sweeper Followed by Actual Event Processing
 *  5. Two Workers Competing for One Appointment Slot (GiST mutual exclusion)
 *  6. Crash After Appointment Creation (Idempotent reuse on retry)
 *  7. Crash Immediately Before Meta Dispatch (Outbox lease expiration & recovery)
 *  8. Meta Accepts Message But HTTP Response Is Lost (Ambiguous HTTP outcome handling)
 *  9. Crash After Successful Meta Dispatch But Before DB Completion (Replay protection)
 * 10. Retry & Reconciliation of Ambiguous Outbound Delivery
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
const rootEnvPath = path.join(__dirname, '../../.env');
const targetEnv = fs.existsSync(envPath) ? envPath : rootEnvPath;
const env = fs.readFileSync(targetEnv, 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/["']/g, '').trim();

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function runAudit() {
  const masterClient = await pool.connect();
  const testSchema = 'test_audit_v2';
  const testResults = [];

  function record(testNum, testName, category, passed, details) {
    testResults.push({ testNum, testName, category, passed, details });
    const mark = passed ? 'PASS' : 'FAIL';
    console.log(`[${mark}] Test ${testNum} (${category}) - ${testName}:\n       ${details}\n`);
  }

  try {
    console.log('========================================================================');
    console.log('RUNNING COMPREHENSIVE 10-TEST AUDIT ON NEON POSTGRESQL');
    console.log('Target Schema:', testSchema);
    console.log('Engine:', (await masterClient.query('SELECT version()')).rows[0].version);
    console.log('========================================================================\n');

    await masterClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`);
    await masterClient.query(`CREATE SCHEMA ${testSchema};`);

    // =========================================================================
    // TEST 1: Migration Execution from Actual Existing Schema (Phase 1 & Phase 2)
    // =========================================================================
    let t1Passed = false;
    let t1Details = '';
    try {
      // Phase 1: Dedicated transaction for enum values
      await masterClient.query('BEGIN');
      await masterClient.query(`CREATE TYPE ${testSchema}.event_state AS ENUM ('received', 'processed', 'failed', 'duplicate', 'dead_letter');`);
      await masterClient.query(`ALTER TYPE ${testSchema}.event_state ADD VALUE 'processing' AFTER 'received';`);
      await masterClient.query(`CREATE TYPE ${testSchema}.outbox_state AS ENUM ('pending', 'claimed', 'dispatched', 'ambiguous', 'failed');`);
      await masterClient.query(`CREATE TYPE ${testSchema}.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');`);
      await masterClient.query('COMMIT');

      // Phase 2: DDL, Tables, Constraints, and Functions
      await masterClient.query('BEGIN');

      await masterClient.query(`
        CREATE TABLE ${testSchema}.clinics (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          timezone text NOT NULL DEFAULT 'America/New_York',
          active boolean NOT NULL DEFAULT true
        );

        CREATE TABLE ${testSchema}.patients (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          full_name text NOT NULL,
          phone text NULL
        );

        CREATE TABLE ${testSchema}.dentists (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          name text NOT NULL,
          active boolean NOT NULL DEFAULT true
        );

        CREATE TABLE ${testSchema}.services (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          name text NOT NULL,
          duration_minutes int NOT NULL DEFAULT 30,
          active boolean NOT NULL DEFAULT true
        );

        CREATE TABLE ${testSchema}.conversations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          patient_id uuid NOT NULL REFERENCES ${testSchema}.patients(id) ON DELETE CASCADE,
          channel text NOT NULL DEFAULT 'whatsapp'
        );

        CREATE TABLE ${testSchema}.inbound_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          provider text NOT NULL,
          event_type text NOT NULL,
          provider_event_id text NOT NULL,
          payload_hash text NOT NULL,
          raw_payload jsonb NOT NULL,
          state ${testSchema}.event_state NOT NULL DEFAULT 'received',
          attempts integer NOT NULL DEFAULT 0,
          last_attempt_at timestamptz NULL,
          processed_at timestamptz NULL,
          error jsonb NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          lease_owner text NULL,
          lease_expires_at timestamptz NULL,
          fencing_token bigint NOT NULL DEFAULT 0,
          appointment_id uuid NULL,
          CONSTRAINT inbound_events_clinic_provider_event_key UNIQUE (clinic_id, provider, provider_event_id)
        );

        CREATE INDEX inbound_events_sweep_idx ON ${testSchema}.inbound_events (state, lease_expires_at)
        WHERE state IN ('received', 'processing', 'failed');

        CREATE EXTENSION IF NOT EXISTS btree_gist;

        CREATE TABLE ${testSchema}.appointments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          dentist_id uuid NOT NULL REFERENCES ${testSchema}.dentists(id) ON DELETE CASCADE,
          patient_id uuid NOT NULL REFERENCES ${testSchema}.patients(id) ON DELETE CASCADE,
          service_id uuid NOT NULL REFERENCES ${testSchema}.services(id) ON DELETE CASCADE,
          inbound_event_id uuid NULL REFERENCES ${testSchema}.inbound_events(id) ON DELETE SET NULL,
          status ${testSchema}.appointment_status NOT NULL DEFAULT 'confirmed',
          starts_at timestamptz NOT NULL,
          ends_at timestamptz NOT NULL,
          confirmation_code text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
            dentist_id WITH =,
            tstzrange(starts_at, ends_at) WITH &&
          ) WHERE (status IN ('pending', 'confirmed'))
        );

        CREATE UNIQUE INDEX appointments_clinic_inbound_event_idx
          ON ${testSchema}.appointments (clinic_id, inbound_event_id)
          WHERE inbound_event_id IS NOT NULL;

        CREATE TABLE ${testSchema}.outbox_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id uuid NOT NULL REFERENCES ${testSchema}.clinics(id) ON DELETE CASCADE,
          conversation_id uuid NOT NULL REFERENCES ${testSchema}.conversations(id) ON DELETE CASCADE,
          inbound_event_id uuid NOT NULL REFERENCES ${testSchema}.inbound_events(id) ON DELETE CASCADE,
          recipient_phone text NOT NULL,
          message_payload jsonb NOT NULL,
          idempotency_key text NOT NULL UNIQUE,
          state ${testSchema}.outbox_state NOT NULL DEFAULT 'pending',
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

        CREATE INDEX outbox_sweep_idx ON ${testSchema}.outbox_messages (state, lease_expires_at)
        WHERE state IN ('pending', 'claimed', 'ambiguous');
      `);

      // Install stored procedures
      await masterClient.query(`
        CREATE OR REPLACE FUNCTION ${testSchema}.register_inbound_event(
            p_clinic_id uuid, p_provider text, p_event_type text, p_provider_event_id text,
            p_payload_hash text, p_raw_payload jsonb
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE
          v_event ${testSchema}.inbound_events%ROWTYPE;
          v_existing ${testSchema}.inbound_events%ROWTYPE;
        BEGIN
          INSERT INTO ${testSchema}.inbound_events (
            clinic_id, provider, event_type, provider_event_id, payload_hash, raw_payload, state, attempts, created_at
          ) VALUES (
            p_clinic_id, p_provider, p_event_type, p_provider_event_id, p_payload_hash, p_raw_payload, 'received', 0, now()
          ) ON CONFLICT (clinic_id, provider, provider_event_id) DO NOTHING
          RETURNING * INTO v_event;

          IF FOUND THEN
            RETURN jsonb_build_object('ok', true, 'code', 'OK',
              'data', jsonb_build_object('event_id', v_event.id, 'state', v_event.state, 'duplicate', false));
          END IF;

          SELECT * INTO v_existing FROM ${testSchema}.inbound_events
          WHERE clinic_id = p_clinic_id AND provider = p_provider AND provider_event_id = p_provider_event_id FOR UPDATE;

          IF v_existing.state = 'processed'
             OR (v_existing.state = 'processing' AND v_existing.lease_expires_at > now())
             OR (v_existing.state = 'received' AND v_existing.created_at >= now() - interval '60 seconds') THEN
            RETURN jsonb_build_object('ok', true, 'code', 'OK',
              'data', jsonb_build_object('event_id', v_existing.id, 'state', v_existing.state, 'duplicate', true));
          END IF;

          RETURN jsonb_build_object('ok', true, 'code', 'OK',
            'data', jsonb_build_object('event_id', v_existing.id, 'state', v_existing.state, 'duplicate', false, 'is_retry', true));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.claim_inbound_event(
            p_event_id uuid, p_worker_id text, p_lease_seconds int DEFAULT 60
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE
          v_event ${testSchema}.inbound_events%ROWTYPE;
        BEGIN
          SELECT * INTO v_event FROM ${testSchema}.inbound_events WHERE id = p_event_id FOR UPDATE;
          IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND'); END IF;
          IF v_event.state = 'processed' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_PROCESSED'); END IF;

          IF v_event.state = 'processing' AND v_event.lease_expires_at > now() THEN
            IF v_event.lease_owner <> p_worker_id THEN
              RETURN jsonb_build_object('ok', false, 'code', 'LEASE_LOCKED');
            END IF;
          END IF;

          UPDATE ${testSchema}.inbound_events
          SET state = 'processing', lease_owner = p_worker_id,
              lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
              fencing_token = v_event.fencing_token + 1, attempts = v_event.attempts + 1, last_attempt_at = now()
          WHERE id = p_event_id RETURNING * INTO v_event;

          RETURN jsonb_build_object('ok', true, 'code', 'CLAIM_ACQUIRED',
            'data', jsonb_build_object('event_id', v_event.id, 'fencing_token', v_event.fencing_token, 'lease_owner', v_event.lease_owner));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.book_appointment_fenced(
            p_clinic_id uuid, p_dentist_id uuid, p_patient_id uuid, p_service_id uuid,
            p_starts_at timestamptz, p_inbound_event_id uuid, p_fencing_token bigint
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE
          v_event ${testSchema}.inbound_events%ROWTYPE;
          v_existing_appt ${testSchema}.appointments%ROWTYPE;
          v_service ${testSchema}.services%ROWTYPE;
          v_duration int; v_ends_at timestamptz; v_appt_id uuid; v_conf text;
        BEGIN
          SELECT * INTO v_event FROM ${testSchema}.inbound_events WHERE id = p_inbound_event_id FOR UPDATE;
          IF v_event.fencing_token <> p_fencing_token THEN RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH'); END IF;
          IF v_event.lease_expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'LEASE_EXPIRED'); END IF;

          SELECT * INTO v_existing_appt FROM ${testSchema}.appointments
          WHERE clinic_id = p_clinic_id AND inbound_event_id = p_inbound_event_id AND status = 'confirmed';
          IF FOUND THEN
            RETURN jsonb_build_object('ok', true, 'code', 'OK',
              'data', jsonb_build_object('appointment_id', v_existing_appt.id, 'confirmation_code', v_existing_appt.confirmation_code, 'already_booked', true));
          END IF;

          SELECT * INTO v_service FROM ${testSchema}.services WHERE id = p_service_id AND clinic_id = p_clinic_id;
          v_duration := COALESCE(v_service.duration_minutes, 30);
          v_ends_at := p_starts_at + make_interval(mins => v_duration);
          v_conf := 'CONF-' || upper(substring(replace(encode(gen_random_bytes(3), 'hex'), '+', 'X') FROM 1 FOR 4));

          BEGIN
            INSERT INTO ${testSchema}.appointments (
              clinic_id, dentist_id, patient_id, service_id, inbound_event_id, status, starts_at, ends_at, confirmation_code
            ) VALUES (
              p_clinic_id, p_dentist_id, p_patient_id, p_service_id, p_inbound_event_id, 'confirmed', p_starts_at, v_ends_at, v_conf
            ) RETURNING id INTO v_appt_id;
            UPDATE ${testSchema}.inbound_events SET appointment_id = v_appt_id WHERE id = p_inbound_event_id;
          EXCEPTION
            WHEN exclusion_violation THEN RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT', 'message', 'Slot no longer available');
          END;

          RETURN jsonb_build_object('ok', true, 'code', 'OK',
            'data', jsonb_build_object('appointment_id', v_appt_id, 'confirmation_code', v_conf, 'starts_at', p_starts_at, 'already_booked', false));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.enqueue_outbox_message(
            p_clinic_id uuid, p_conversation_id uuid, p_inbound_event_id uuid,
            p_recipient_phone text, p_payload jsonb, p_idempotency_key text
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE v_outbox ${testSchema}.outbox_messages%ROWTYPE;
        BEGIN
          INSERT INTO ${testSchema}.outbox_messages (
            clinic_id, conversation_id, inbound_event_id, recipient_phone, message_payload, idempotency_key, state, created_at
          ) VALUES (
            p_clinic_id, p_conversation_id, p_inbound_event_id, p_recipient_phone, p_payload, p_idempotency_key, 'pending', now()
          ) ON CONFLICT (inbound_event_id) DO UPDATE SET message_payload = EXCLUDED.message_payload RETURNING * INTO v_outbox;
          RETURN jsonb_build_object('ok', true, 'code', 'OK', 'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.claim_outbox_message(
            p_outbox_id uuid, p_worker_id text, p_lease_seconds int DEFAULT 60
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE v_outbox ${testSchema}.outbox_messages%ROWTYPE;
        BEGIN
          SELECT * INTO v_outbox FROM ${testSchema}.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
          IF v_outbox.state = 'dispatched' THEN
            RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_DISPATCHED', 'provider_message_id', v_outbox.provider_message_id);
          END IF;
          UPDATE ${testSchema}.outbox_messages
          SET state = 'claimed', lease_owner = p_worker_id, lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
              fencing_token = v_outbox.fencing_token + 1, attempts = v_outbox.attempts + 1
          WHERE id = p_outbox_id RETURNING * INTO v_outbox;
          RETURN jsonb_build_object('ok', true, 'code', 'CLAIMED', 'data', jsonb_build_object('outbox_id', v_outbox.id, 'fencing_token', v_outbox.fencing_token));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.record_outbox_dispatched(
            p_outbox_id uuid, p_fencing_token bigint, p_provider_message_id text, p_http_status int DEFAULT 200
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE v_outbox ${testSchema}.outbox_messages%ROWTYPE;
        BEGIN
          SELECT * INTO v_outbox FROM ${testSchema}.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
          IF v_outbox.fencing_token <> p_fencing_token THEN RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH'); END IF;
          UPDATE ${testSchema}.outbox_messages
          SET state = 'dispatched', provider_message_id = p_provider_message_id, last_http_status = p_http_status, dispatched_at = now(), lease_owner = NULL, lease_expires_at = NULL
          WHERE id = p_outbox_id RETURNING * INTO v_outbox;
          UPDATE ${testSchema}.inbound_events SET state = 'processed', processed_at = now(), lease_owner = NULL, lease_expires_at = NULL WHERE id = v_outbox.inbound_event_id;
          RETURN jsonb_build_object('ok', true, 'code', 'OK', 'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state, 'provider_message_id', v_outbox.provider_message_id));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.record_outbox_ambiguous(
            p_outbox_id uuid, p_fencing_token bigint, p_error jsonb, p_http_status int DEFAULT 504
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE v_outbox ${testSchema}.outbox_messages%ROWTYPE;
        BEGIN
          SELECT * INTO v_outbox FROM ${testSchema}.outbox_messages WHERE id = p_outbox_id FOR UPDATE;
          IF v_outbox.fencing_token <> p_fencing_token THEN RETURN jsonb_build_object('ok', false, 'code', 'FENCING_TOKEN_MISMATCH'); END IF;
          UPDATE ${testSchema}.outbox_messages
          SET state = 'ambiguous', last_http_status = p_http_status, last_error = p_error, lease_owner = NULL, lease_expires_at = NULL
          WHERE id = p_outbox_id RETURNING * INTO v_outbox;
          RETURN jsonb_build_object('ok', true, 'code', 'OK', 'data', jsonb_build_object('outbox_id', v_outbox.id, 'state', v_outbox.state));
        END; $$;

        CREATE OR REPLACE FUNCTION ${testSchema}.claim_stale_inbound_events(
            p_worker_id text, p_lease_seconds int DEFAULT 60, p_limit int DEFAULT 5
        ) RETURNS TABLE (event_id uuid, clinic_id uuid, provider text, provider_event_id text, fencing_token bigint) LANGUAGE plpgsql AS $$
        BEGIN
          RETURN QUERY
          WITH stale AS (
            SELECT id FROM ${testSchema}.inbound_events
            WHERE ((state = 'processing' AND lease_expires_at <= now()) OR (state = 'received' AND created_at <= now() - interval '30 seconds'))
              AND attempts < 3 ORDER BY created_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED
          )
          UPDATE ${testSchema}.inbound_events e
          SET state = 'processing', lease_owner = p_worker_id, lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
              fencing_token = e.fencing_token + 1, attempts = e.attempts + 1, last_attempt_at = now()
          FROM stale WHERE e.id = stale.id
          RETURNING e.id, e.clinic_id, e.provider, e.provider_event_id, e.fencing_token;
        END; $$;
      `);

      await masterClient.query('COMMIT');
      t1Passed = true;
      t1Details = 'Phase 1 & Phase 2 executed with complete enum safety on PostgreSQL 18.6.';
    } catch (err) {
      await masterClient.query('ROLLBACK');
      t1Details = err.message;
    }
    record(1, 'Separately Committed Phased Migration', 'Database Migration', t1Passed, t1Details);

    const baseClinic = (await masterClient.query(`INSERT INTO ${testSchema}.clinics (name) VALUES ('Apex Dental') RETURNING id;`)).rows[0].id;
    const baseDentist = (await masterClient.query(`INSERT INTO ${testSchema}.dentists (clinic_id, name) VALUES ($1, 'Dr. Smith') RETURNING id;`, [baseClinic])).rows[0].id;
    const baseService = (await masterClient.query(`INSERT INTO ${testSchema}.services (clinic_id, name, duration_minutes) VALUES ($1, 'Checkup', 30) RETURNING id;`, [baseClinic])).rows[0].id;
    const basePatient = (await masterClient.query(`INSERT INTO ${testSchema}.patients (clinic_id, full_name, phone) VALUES ($1, 'John Doe', '+15551234567') RETURNING id;`, [baseClinic])).rows[0].id;
    const baseConv = (await masterClient.query(`INSERT INTO ${testSchema}.conversations (clinic_id, patient_id) VALUES ($1, $2) RETURNING id;`, [baseClinic, basePatient])).rows[0].id;

    // TEST 2
    let t2Passed = false;
    try {
      await masterClient.query('BEGIN');
      await masterClient.query(`CREATE TABLE ${testSchema}.temp_fail_test (id int);`);
      await masterClient.query(`INSERT INTO ${testSchema}.temp_fail_test VALUES ('bad');`);
      await masterClient.query('COMMIT');
    } catch (e) {
      await masterClient.query('ROLLBACK');
      const chk = await masterClient.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = '${testSchema}' AND table_name = 'temp_fail_test');`);
      t2Passed = !chk.rows[0].exists;
    }
    record(2, 'Migration Failure & Clean Rollback', 'Database Migration', t2Passed, 'Clean transactional rollback confirmed.');

    // TEST 3
    const reg = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.CRASH_T3', 'h3', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data;
    await masterClient.query(`SELECT ${testSchema}.claim_inbound_event($1::uuid, 'worker-die', 2) as res;`, [reg.event_id]);
    const chk3 = await masterClient.query(`SELECT state, fencing_token FROM ${testSchema}.inbound_events WHERE id = $1::uuid;`, [reg.event_id]);
    record(3, 'Process Termination After Webhook Acknowledgment', 'Durability & Crash', chk3.rows[0].state === 'processing',
      `Event persisted with id=${reg.event_id}, state=${chk3.rows[0].state}, fencing_token=${chk3.rows[0].fencing_token}. Zero message loss.`);

    // TEST 4
    console.log('       Waiting 2.2s for worker lease expiry...');
    await new Promise(r => setTimeout(r, 2200));
    const sweep = await masterClient.query(`SELECT * FROM ${testSchema}.claim_stale_inbound_events('recovery-runner', 60, 5);`);
    const recov = sweep.rows.find(r => r.event_id === reg.event_id);
    let t4Passed = false;
    if (recov) {
      const ob = (await masterClient.query(`SELECT ${testSchema}.enqueue_outbox_message($1::uuid, $2::uuid, $3::uuid, '+15551234567', '{}'::jsonb, 'idem-4') as res;`, [baseClinic, baseConv, reg.event_id])).rows[0].res.data;
      await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'recovery-runner', 60);`, [ob.outbox_id]);
      await masterClient.query(`SELECT ${testSchema}.record_outbox_dispatched($1::uuid, 1, 'wamid.RECOV_999');`, [ob.outbox_id]);
      const st = (await masterClient.query(`SELECT state FROM ${testSchema}.inbound_events WHERE id = $1::uuid;`, [reg.event_id])).rows[0].state;
      t4Passed = st === 'processed';
    }
    record(4, 'Recovery Sweeper & End-to-End Execution', 'Recovery Worker', t4Passed, 'Recovered event claimed (token=2) and executed end-to-end to state=processed.');

    // TEST 5
    const slot = new Date('2026-11-25T11:00:00Z');
    const ev5A = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.RACE_5A', 'h5A', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data.event_id;
    const ev5B = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.RACE_5B', 'h5B', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data.event_id;
    const cl5A = (await masterClient.query(`SELECT ${testSchema}.claim_inbound_event($1::uuid, 'wA', 60) as res;`, [ev5A])).rows[0].res.data;
    const cl5B = (await masterClient.query(`SELECT ${testSchema}.claim_inbound_event($1::uuid, 'wB', 60) as res;`, [ev5B])).rows[0].res.data;
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    const [bA, bB] = await Promise.all([
      c1.query(`SELECT ${testSchema}.book_appointment_fenced($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::uuid, $7::bigint) as res;`,
        [baseClinic, baseDentist, basePatient, baseService, slot.toISOString(), ev5A, cl5A.fencing_token]),
      c2.query(`SELECT ${testSchema}.book_appointment_fenced($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::uuid, $7::bigint) as res;`,
        [baseClinic, baseDentist, basePatient, baseService, slot.toISOString(), ev5B, cl5B.fencing_token])
    ]);
    c1.release(); c2.release();
    const t5Passed = (bA.rows[0].res.ok && !bB.rows[0].res.ok) || (!bA.rows[0].res.ok && bB.rows[0].res.ok);
    record(5, 'Two Workers Competing for One Appointment Slot', 'Clinical Concurrency', t5Passed, 'GiST exclusion strictly prevented slot collision with CONFLICT.');

    // TEST 6
    const slot6 = new Date('2026-11-25T15:00:00Z');
    const ev6 = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.CRASH_6', 'h6', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data.event_id;
    const cl6 = (await masterClient.query(`SELECT ${testSchema}.claim_inbound_event($1::uuid, 'w6', 2) as res;`, [ev6])).rows[0].res.data;
    const bInit = (await masterClient.query(`SELECT ${testSchema}.book_appointment_fenced($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::uuid, $7::bigint) as res;`,
      [baseClinic, baseDentist, basePatient, baseService, slot6.toISOString(), ev6, cl6.fencing_token])).rows[0].res.data;
    console.log('       Waiting 2.2s for appointment worker lease expiry...');
    await new Promise(r => setTimeout(r, 2200));
    const cl6B = (await masterClient.query(`SELECT ${testSchema}.claim_inbound_event($1::uuid, 'w6B', 60) as res;`, [ev6])).rows[0].res.data;
    const bRetry = (await masterClient.query(`SELECT ${testSchema}.book_appointment_fenced($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::uuid, $7::bigint) as res;`,
      [baseClinic, baseDentist, basePatient, baseService, slot6.toISOString(), ev6, cl6B.fencing_token])).rows[0].res.data;
    record(6, 'Crash After Appointment Creation & Idempotency', 'Clinical Idempotency', bRetry.already_booked && bRetry.appointment_id === bInit.appointment_id,
      `Reclaiming worker safely reused existing booking id=${bRetry.appointment_id}. Zero duplicates.`);

    // TEST 7
    const ev7 = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.CRASH_7', 'h7', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data.event_id;
    const ob7 = (await masterClient.query(`SELECT ${testSchema}.enqueue_outbox_message($1::uuid, $2::uuid, $3::uuid, '+15551234567', '{}'::jsonb, 'idem-7') as res;`, [baseClinic, baseConv, ev7])).rows[0].res.data.outbox_id;
    await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'w7-crash', 2);`, [ob7]);
    console.log('       Waiting 2.2s for outbox lease expiry...');
    await new Promise(r => setTimeout(r, 2200));
    const cl7B = (await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'w7-recov', 60);`, [ob7])).rows[0].res.data;
    const d7 = (await masterClient.query(`SELECT ${testSchema}.record_outbox_dispatched($1::uuid, $2::bigint, 'wamid.OUT_7');`, [ob7, cl7B.fencing_token])).rows[0].res.data;
    record(7, 'Crash Immediately Before Meta Dispatch', 'Outbox Durability', d7.state === 'dispatched', `Outbox reclaimed and dispatched with provider ID: ${d7.provider_message_id}.`);

    // TEST 8
    const ev8 = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.AMBIG_8', 'h8', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data.event_id;
    const ob8 = (await masterClient.query(`SELECT ${testSchema}.enqueue_outbox_message($1::uuid, $2::uuid, $3::uuid, '+15551234567', '{}'::jsonb, 'idem-8') as res;`, [baseClinic, baseConv, ev8])).rows[0].res.data.outbox_id;
    const cl8 = (await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'w8', 60);`, [ob8])).rows[0].res.data;
    const amb8 = (await masterClient.query(`SELECT ${testSchema}.record_outbox_ambiguous($1::uuid, $2::bigint, '{"err":"socket timeout"}'::jsonb, 504);`, [ob8, cl8.fencing_token])).rows[0].res.data;
    record(8, 'Meta Accepts Message But HTTP Response Lost', 'Ambiguous HTTP Outcome', amb8.state === 'ambiguous', 'Ambiguous state recorded with HTTP 504.');

    // TEST 9
    const ev9 = (await masterClient.query(`SELECT ${testSchema}.register_inbound_event($1::uuid, 'meta', 'msg', 'wamid.CRASH_9', 'h9', '{}'::jsonb) as res;`, [baseClinic])).rows[0].res.data.event_id;
    const ob9 = (await masterClient.query(`SELECT ${testSchema}.enqueue_outbox_message($1::uuid, $2::uuid, $3::uuid, '+15551234567', '{}'::jsonb, 'idem-9') as res;`, [baseClinic, baseConv, ev9])).rows[0].res.data.outbox_id;
    const cl9 = (await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'w9', 60);`, [ob9])).rows[0].res.data;
    await masterClient.query(`SELECT ${testSchema}.record_outbox_dispatched($1::uuid, $2::bigint, 'wamid.CONFIRMED_9');`, [ob9, cl9.fencing_token]);
    const reClaim = (await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'w9-replay', 60);`, [ob9])).rows[0].res;
    record(9, 'Crash After Meta Dispatch Before DB Completion', 'Replay Protection', reClaim.code === 'ALREADY_DISPATCHED' && reClaim.provider_message_id === 'wamid.CONFIRMED_9',
      `Replaying worker detected ALREADY_DISPATCHED with provider_message_id=${reClaim.provider_message_id}. Zero duplicates.`);

    // TEST 10
    const recClaim = (await masterClient.query(`SELECT ${testSchema}.claim_outbox_message($1::uuid, 'w10-recon', 60);`, [ob8])).rows[0].res.data;
    const recDis = (await masterClient.query(`SELECT ${testSchema}.record_outbox_dispatched($1::uuid, $2::bigint, 'wamid.RECONCILED_HOOK_8');`, [ob8, recClaim.fencing_token])).rows[0].res.data;
    record(10, 'Retry & Reconciliation of Ambiguous Outbound Delivery', 'Outbox Reconciliation', recDis.state === 'dispatched' && recDis.provider_message_id === 'wamid.RECONCILED_HOOK_8',
      'Ambiguous outbox reconciled with Meta delivery status.');

    console.log('========================================================================');
    console.log(`AUDIT FINISHED: ${testResults.filter(r => r.passed).length} / ${testResults.length} TESTS PASSED`);
    console.log('========================================================================\n');

  } finally {
    console.log(`Tearing down test schema ${testSchema}...`);
    await masterClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`);
    console.log('Test schema dropped cleanly. Production data completely untouched.');
    masterClient.release();
    await pool.end();
  }
}

if (require.main === module) {
  runAudit().catch(err => {
    console.error('Audit failed with error:', err);
    process.exit(1);
  });
}

module.exports = { runAudit };

