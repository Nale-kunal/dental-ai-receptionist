const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL=([^\r\n]+)/);
const connectionString = match[1].replace(/['"]/g, '').trim();

const client = new Client({ connectionString });

async function applyMigration() {
  await client.connect();
  console.log('Connected to PostgreSQL database. Applying conversation continuity schema updates...');

  await client.query('BEGIN;');

  try {
    // 1. Update uniqueness constraints on api.conversations
    // We want active conversations to be unique per (clinic_id, channel, channel_conversation_id)
    // while allowing historical closed conversations (closed_at IS NOT NULL) to be preserved.
    await client.query(`
      ALTER TABLE api.conversations DROP CONSTRAINT IF EXISTS conversations_clinic_id_channel_channel_conversation_id_key;
      DROP INDEX IF EXISTS api.conversations_clinic_id_channel_channel_conversation_id_key;
      DROP INDEX IF EXISTS api.conversations_active_uidx;

      CREATE UNIQUE INDEX conversations_active_uidx
        ON api.conversations (clinic_id, channel, channel_conversation_id)
        WHERE closed_at IS NULL;

      CREATE INDEX IF NOT EXISTS conversations_lookup_idx
        ON api.conversations (clinic_id, channel, channel_conversation_id, created_at DESC);
    `);
    console.log('1. Active conversation unique partial index created.');

    // 2. Ensure message unique constraint on (conversation_id, provider_message_id)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_provider_uidx
        ON api.messages (conversation_id, provider_message_id)
        WHERE provider_message_id IS NOT NULL;
    `);
    console.log('2. Message idempotency index verified.');

    // 3. Create or replace api.get_or_create_conversation with concurrency safety & lifecycle support
    await client.query(`
      DROP FUNCTION IF EXISTS api.get_or_create_conversation(uuid, api.channel_type, text, uuid);
      CREATE OR REPLACE FUNCTION api.get_or_create_conversation(
        p_clinic_id uuid,
        p_channel api.channel_type,
        p_channel_conversation_id text,
        p_patient_id uuid DEFAULT NULL::uuid,
        p_inactivity_interval interval DEFAULT NULL::interval,
        p_force_new boolean DEFAULT false
      ) RETURNS jsonb
      LANGUAGE plpgsql
      AS $func$
      DECLARE
        v_conv api.conversations%ROWTYPE;
        v_cleaned_channel_id text;
        v_effective_interval interval;
        v_timeout_hours text;
      BEGIN
        -- 1. Assert clinic active
        PERFORM api.assert_clinic_active(p_clinic_id);

        -- Normalize channel conversation ID
        v_cleaned_channel_id := trim(p_channel_conversation_id);
        IF v_cleaned_channel_id IS NULL OR length(v_cleaned_channel_id) = 0 THEN
          RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION', 'message', 'channel_conversation_id cannot be empty');
        END IF;

        -- 2. Determine effective inactivity interval if not explicitly passed
        IF p_inactivity_interval IS NOT NULL THEN
          v_effective_interval := p_inactivity_interval;
        ELSE
          SELECT settings->'receptionist'->>'inactivity_timeout_hours'
          INTO v_timeout_hours
          FROM api.clinics
          WHERE id = p_clinic_id;

          IF v_timeout_hours IS NOT NULL AND v_timeout_hours ~ '^[0-9]+$' AND v_timeout_hours::int > 0 THEN
            v_effective_interval := (v_timeout_hours || ' hours')::interval;
          END IF;
        END IF;

        -- 3. Check for existing active conversation (closed_at IS NULL)
        SELECT * INTO v_conv
        FROM api.conversations
        WHERE clinic_id = p_clinic_id
          AND channel = p_channel
          AND channel_conversation_id = v_cleaned_channel_id
          AND closed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
          -- Check if explicit new thread requested
          IF p_force_new THEN
            UPDATE api.conversations
            SET closed_at = NOW(),
                state = state || jsonb_build_object('close_reason', 'explicit_new_thread')
            WHERE id = v_conv.id;
          -- Check if conversation expired by inactivity policy
          ELSIF v_effective_interval IS NOT NULL AND v_conv.last_message_at IS NOT NULL AND v_conv.last_message_at < (NOW() - v_effective_interval) THEN
            UPDATE api.conversations
            SET closed_at = NOW(),
                state = state || jsonb_build_object('close_reason', 'inactivity_timeout', 'inactive_since', v_conv.last_message_at)
            WHERE id = v_conv.id;
          ELSE
            -- Active conversation continues! Update patient link if needed
            IF p_patient_id IS NOT NULL AND v_conv.patient_id IS NULL THEN
              UPDATE api.conversations
              SET patient_id = p_patient_id
              WHERE id = v_conv.id
              RETURNING * INTO v_conv;
            END IF;

            RETURN jsonb_build_object(
              'ok', true,
              'code', 'OK',
              'data', jsonb_build_object(
                'conversation_id', v_conv.id,
                'existing', true,
                'state', v_conv.state,
                'patient_id', v_conv.patient_id,
                'channel', v_conv.channel,
                'channel_conversation_id', v_conv.channel_conversation_id,
                'last_message_at', v_conv.last_message_at,
                'created_at', v_conv.created_at
              )
            );
          END IF;
        END IF;

        -- 4. Create new conversation (with concurrency exception handling)
        BEGIN
          INSERT INTO api.conversations (
            clinic_id,
            channel,
            channel_conversation_id,
            patient_id,
            last_message_at
          ) VALUES (
            p_clinic_id,
            p_channel,
            v_cleaned_channel_id,
            p_patient_id,
            NOW()
          ) RETURNING * INTO v_conv;

          RETURN jsonb_build_object(
            'ok', true,
            'code', 'OK',
            'data', jsonb_build_object(
              'conversation_id', v_conv.id,
              'existing', false,
              'state', v_conv.state,
              'patient_id', v_conv.patient_id,
              'channel', v_conv.channel,
              'channel_conversation_id', v_conv.channel_conversation_id,
              'last_message_at', v_conv.last_message_at,
              'created_at', v_conv.created_at
            )
          );
        EXCEPTION WHEN unique_violation THEN
          -- Concurrent message created an active conversation at the exact same moment
          SELECT * INTO v_conv
          FROM api.conversations
          WHERE clinic_id = p_clinic_id
            AND channel = p_channel
            AND channel_conversation_id = v_cleaned_channel_id
            AND closed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1;

          IF p_patient_id IS NOT NULL AND v_conv.patient_id IS NULL THEN
            UPDATE api.conversations
            SET patient_id = p_patient_id
            WHERE id = v_conv.id
            RETURNING * INTO v_conv;
          END IF;

          RETURN jsonb_build_object(
            'ok', true,
            'code', 'OK',
            'data', jsonb_build_object(
              'conversation_id', v_conv.id,
              'existing', true,
              'state', v_conv.state,
              'patient_id', v_conv.patient_id,
              'channel', v_conv.channel,
              'channel_conversation_id', v_conv.channel_conversation_id,
              'last_message_at', v_conv.last_message_at,
              'created_at', v_conv.created_at
            )
          );
        END;
      END;
      $func$;
    `);
    console.log('3. Enhanced api.get_or_create_conversation installed.');

    // 4. Create api.record_message for atomic inbound & outbound message persistence
    await client.query(`
      CREATE OR REPLACE FUNCTION api.record_message(
        p_clinic_id uuid,
        p_conversation_id uuid,
        p_direction api.message_direction,
        p_kind api.message_kind,
        p_body text,
        p_provider_message_id text DEFAULT NULL::text,
        p_provider_payload jsonb DEFAULT NULL::jsonb,
        p_media_url text DEFAULT NULL::text,
        p_media_mime_type text DEFAULT NULL::text
      ) RETURNS jsonb
      LANGUAGE plpgsql
      AS $func$
      DECLARE
        v_conv api.conversations%ROWTYPE;
        v_msg api.messages%ROWTYPE;
        v_now timestamptz := NOW();
      BEGIN
        -- Assert clinic active
        PERFORM api.assert_clinic_active(p_clinic_id);

        -- Verify conversation belongs to clinic
        SELECT * INTO v_conv
        FROM api.conversations
        WHERE id = p_conversation_id AND clinic_id = p_clinic_id;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'conversation not found for this clinic');
        END IF;

        -- Check message idempotency if provider_message_id provided
        IF p_provider_message_id IS NOT NULL AND length(trim(p_provider_message_id)) > 0 THEN
          SELECT * INTO v_msg
          FROM api.messages
          WHERE conversation_id = p_conversation_id
            AND provider_message_id = trim(p_provider_message_id);

          IF FOUND THEN
            RETURN jsonb_build_object(
              'ok', true,
              'code', 'OK',
              'data', jsonb_build_object(
                'message_id', v_msg.id,
                'conversation_id', v_msg.conversation_id,
                'direction', v_msg.direction,
                'duplicate', true,
                'created_at', v_msg.created_at
              )
            );
          END IF;
        END IF;

        -- Insert message
        INSERT INTO api.messages (
          clinic_id,
          conversation_id,
          direction,
          kind,
          body,
          media_url,
          media_mime_type,
          provider_message_id,
          provider_payload,
          created_at
        ) VALUES (
          p_clinic_id,
          p_conversation_id,
          p_direction,
          p_kind,
          p_body,
          p_media_url,
          p_media_mime_type,
          NULLIF(trim(p_provider_message_id), ''),
          p_provider_payload,
          v_now
        ) RETURNING * INTO v_msg;

        -- Update conversation last_message_at
        UPDATE api.conversations
        SET last_message_at = v_now
        WHERE id = p_conversation_id AND clinic_id = p_clinic_id;

        RETURN jsonb_build_object(
          'ok', true,
          'code', 'OK',
          'data', jsonb_build_object(
            'message_id', v_msg.id,
            'conversation_id', v_msg.conversation_id,
            'direction', v_msg.direction,
            'duplicate', false,
            'created_at', v_msg.created_at
          )
        );
      END;
      $func$;
    `);
    console.log('4. api.record_message installed.');

    // 5. Create api.get_conversation_context for AI Receptionist previous history access
    await client.query(`
      CREATE OR REPLACE FUNCTION api.get_conversation_context(
        p_clinic_id uuid,
        p_conversation_id uuid,
        p_limit integer DEFAULT 20
      ) RETURNS jsonb
      LANGUAGE plpgsql
      STABLE
      AS $func$
      DECLARE
        v_conv record;
        v_messages jsonb;
      BEGIN
        PERFORM api.assert_clinic_active(p_clinic_id);

        SELECT c.id, c.clinic_id, c.patient_id, c.channel, c.channel_conversation_id,
               c.state, c.last_message_at, c.closed_at, c.created_at,
               p.full_name as patient_name, p.phone as patient_phone, p.whatsapp_id as patient_whatsapp_id
        INTO v_conv
        FROM api.conversations c
        LEFT JOIN api.patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
        WHERE c.id = p_conversation_id AND c.clinic_id = p_clinic_id;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'conversation not found');
        END IF;

        SELECT COALESCE(jsonb_agg(m_row ORDER BY m_row.created_at ASC), '[]'::jsonb)
        INTO v_messages
        FROM (
          SELECT id, direction, kind, body, provider_message_id, provider_payload, created_at
          FROM api.messages
          WHERE conversation_id = p_conversation_id AND clinic_id = p_clinic_id
          ORDER BY created_at DESC
          LIMIT LEAST(p_limit, 100)
        ) m_row;

        RETURN jsonb_build_object(
          'ok', true,
          'code', 'OK',
          'data', jsonb_build_object(
            'conversation_id', v_conv.id,
            'clinic_id', v_conv.clinic_id,
            'patient_id', v_conv.patient_id,
            'patient_name', v_conv.patient_name,
            'patient_phone', v_conv.patient_phone,
            'channel', v_conv.channel,
            'channel_conversation_id', v_conv.channel_conversation_id,
            'state', v_conv.state,
            'last_message_at', v_conv.last_message_at,
            'closed_at', v_conv.closed_at,
            'messages', v_messages
          )
        );
      END;
      $func$;
    `);
    console.log('5. api.get_conversation_context installed.');

    await client.query('COMMIT;');
    console.log('Migration committed successfully!');
  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('Migration failed and rolled back:', err);
    throw err;
  } finally {
    await client.end();
  }
}

applyMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
